import type OpenAI from "openai";
import { NextRequest } from "next/server";
import { getGroq, MODEL_DEFAULT } from "@/lib/llm";
import { SYSTEM_PROMPT } from "@/lib/system-prompt";
import { TOOL_DEFINITIONS, dispatchTool, isToolName } from "@/lib/tools";
import { checkRateLimit } from "@/lib/rate-limit";
import { isBudgetExceeded, recordUsage } from "@/lib/budget";
import type { ChatRequestBody, StreamEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHAT_RATE_LIMIT = 10;
const CHAT_RATE_WINDOW_MS = 60_000;
const MAX_LOOP_ITERATIONS = 6;
const MAX_USER_MESSAGE_LEN = 4_000;
const MAX_HISTORY_TURNS = 20;

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "unknown";
}

function encodeEvent(event: StreamEvent): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(event) + "\n");
}

function buildMessages(body: ChatRequestBody): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
  ];
  for (const m of body.messages.slice(-MAX_HISTORY_TURNS)) {
    messages.push({
      role: m.role,
      content: m.content.slice(0, MAX_USER_MESSAGE_LEN),
    });
  }
  return messages;
}

interface AccumulatedToolCall {
  id: string;
  name: string;
  argsJson: string;
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const limit = checkRateLimit(`chat:${ip}`, CHAT_RATE_LIMIT, CHAT_RATE_WINDOW_MS);
  if (!limit.allowed) {
    return new Response(
      JSON.stringify({ error: "rate_limited", retry_after_seconds: limit.resetSeconds }),
      { status: 429, headers: { "content-type": "application/json", "retry-after": String(limit.resetSeconds) } },
    );
  }

  if (isBudgetExceeded()) {
    return new Response(
      JSON.stringify({ error: "daily_budget_exceeded" }),
      { status: 503, headers: { "content-type": "application/json" } },
    );
  }

  let body: ChatRequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400 });
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return new Response(JSON.stringify({ error: "messages_required" }), { status: 400 });
  }

  const messages = buildMessages(body);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) => controller.enqueue(encodeEvent(event));
      let totalPromptTokens = 0;
      let totalCompletionTokens = 0;

      try {
        const groq = getGroq();
        for (let iter = 0; iter < MAX_LOOP_ITERATIONS; iter++) {
          const completion = await groq.chat.completions.create({
            model: MODEL_DEFAULT,
            messages,
            tools: TOOL_DEFINITIONS,
            tool_choice: "auto",
            stream: true,
            stream_options: { include_usage: true },
            max_tokens: 1024,
          });

          let assistantText = "";
          const toolCalls = new Map<number, AccumulatedToolCall>();
          let finishReason: string | null = null;
          let iterPromptTokens = 0;
          let iterCompletionTokens = 0;

          for await (const chunk of completion) {
            // include_usage may emit usage on multiple chunks (cumulative).
            // Replace, don't accumulate — we'll add to the running total once per iteration.
            if (chunk.usage) {
              iterPromptTokens = chunk.usage.prompt_tokens ?? iterPromptTokens;
              iterCompletionTokens = chunk.usage.completion_tokens ?? iterCompletionTokens;
            }
            const choice = chunk.choices[0];
            if (!choice) continue;

            if (choice.finish_reason) {
              finishReason = choice.finish_reason;
            }

            const delta = choice.delta;
            if (!delta) continue;

            if (typeof delta.content === "string" && delta.content.length > 0) {
              assistantText += delta.content;
              send({ type: "text_delta", text: delta.content });
            }

            if (delta.tool_calls) {
              for (const tcDelta of delta.tool_calls) {
                const idx = tcDelta.index ?? 0;
                let acc = toolCalls.get(idx);
                if (!acc) {
                  acc = { id: tcDelta.id ?? "", name: "", argsJson: "" };
                  toolCalls.set(idx, acc);
                }
                if (tcDelta.id && !acc.id) acc.id = tcDelta.id;
                if (tcDelta.function?.name) acc.name += tcDelta.function.name;
                if (tcDelta.function?.arguments) acc.argsJson += tcDelta.function.arguments;
              }
            }
          }

          totalPromptTokens += iterPromptTokens;
          totalCompletionTokens += iterCompletionTokens;

          // Reconstruct the assistant turn for history
          const assistantToolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = [];
          for (const acc of toolCalls.values()) {
            if (!acc.id || !acc.name) continue;
            assistantToolCalls.push({
              id: acc.id,
              type: "function",
              function: { name: acc.name, arguments: acc.argsJson || "{}" },
            });
          }

          messages.push({
            role: "assistant",
            content: assistantText || null,
            ...(assistantToolCalls.length > 0 ? { tool_calls: assistantToolCalls } : {}),
          });

          if (finishReason === "stop" || assistantToolCalls.length === 0) {
            break;
          }

          // Execute each tool call and append a tool-role message per call
          for (const tc of assistantToolCalls) {
            let parsedInput: unknown = {};
            try {
              parsedInput = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
            } catch {
              // ignore — empty params is fine for our zero-arg tools
            }
            send({ type: "tool_use", id: tc.id, name: tc.function.name as never, input: parsedInput });

            if (!isToolName(tc.function.name)) {
              const errorPayload = { ok: false as const, error: `unknown tool: ${tc.function.name}` };
              send({ type: "tool_result", toolUseId: tc.id, result: errorPayload });
              messages.push({
                role: "tool",
                tool_call_id: tc.id,
                content: JSON.stringify(errorPayload),
              });
              continue;
            }

            const result = await dispatchTool(tc.function.name);
            send({ type: "tool_result", toolUseId: tc.id, result });
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: JSON.stringify(result),
            });
          }
        }

        recordUsage(totalPromptTokens, totalCompletionTokens);
        send({
          type: "done",
          usage: { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "internal_error";
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  const origin = req.headers.get("origin") || "";
  const ALLOWED_ORIGINS = ["https://lalu.dev", "https://www.lalu.dev", "https://ai.lalu.dev"];
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : "";

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
      ...(allowOrigin ? {
        "access-control-allow-origin": allowOrigin,
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        "vary": "origin",
      } : {}),
    },
  });
}

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get("origin") || "";
  const ALLOWED_ORIGINS = ["https://lalu.dev", "https://www.lalu.dev", "https://ai.lalu.dev"];
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : "";
  return new Response(null, {
    status: 204,
    headers: allowOrigin ? {
      "access-control-allow-origin": allowOrigin,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
      "vary": "origin",
    } : {},
  });
}
