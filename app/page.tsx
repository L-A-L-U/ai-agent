"use client";

import { useEffect, useRef, useState } from "react";
import type { StreamEvent, ToolName } from "@/lib/types";

type UiMessageRole = "user" | "assistant";

interface UiToolCall {
  id: string;
  name: ToolName;
  input: unknown;
  result?: unknown;
  resultIsError?: boolean;
  expanded: boolean;
}

interface UiMessage {
  role: UiMessageRole;
  text: string;
  toolCalls: UiToolCall[];
  streaming?: boolean;
}

const SUGGESTIONS = [
  "¿Cómo está el servidor ahora?",
  "Show me the most recent SSH attacks",
  "¿De dónde vienen los ataques?",
  "How many people visited the portfolio today?",
];

export default function ChatPage() {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function send(content: string) {
    const trimmed = content.trim();
    if (!trimmed || busy) return;

    const nextHistory: UiMessage[] = [
      ...messages,
      { role: "user", text: trimmed, toolCalls: [] },
      { role: "assistant", text: "", toolCalls: [], streaming: true },
    ];
    setMessages(nextHistory);
    setInput("");
    setBusy(true);

    const apiMessages = nextHistory
      .filter((m) => !m.streaming)
      .map((m) => ({ role: m.role, content: m.text }));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: apiMessages }),
      });

      if (!res.ok || !res.body) {
        const errText = await safeText(res);
        appendErrorToLastAssistant(errText || `error ${res.status}`);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as StreamEvent;
            applyEvent(event);
          } catch {
            // ignore malformed line
          }
        }
      }
    } catch (err) {
      appendErrorToLastAssistant(err instanceof Error ? err.message : "network error");
    } finally {
      setBusy(false);
      setMessages((prev) =>
        prev.map((m, i) => (i === prev.length - 1 ? { ...m, streaming: false } : m)),
      );
    }
  }

  async function safeText(res: Response): Promise<string> {
    try {
      const j = (await res.json()) as { error?: string; retry_after_seconds?: number };
      if (j.error === "rate_limited") {
        return `Rate limited. Try again in ${j.retry_after_seconds ?? 60}s.`;
      }
      if (j.error === "daily_budget_exceeded") {
        return "Token budget for today is exhausted. The agent is paused until UTC midnight.";
      }
      return j.error ?? "";
    } catch {
      return "";
    }
  }

  function appendErrorToLastAssistant(msg: string) {
    setMessages((prev) =>
      prev.map((m, i) =>
        i === prev.length - 1 && m.role === "assistant"
          ? { ...m, text: (m.text ? m.text + "\n\n" : "") + `[error: ${msg}]`, streaming: false }
          : m,
      ),
    );
  }

  function applyEvent(event: StreamEvent) {
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (!last || last.role !== "assistant") return prev;

      switch (event.type) {
        case "text_delta":
          next[next.length - 1] = { ...last, text: last.text + event.text };
          return next;
        case "tool_use":
          next[next.length - 1] = {
            ...last,
            toolCalls: [
              ...last.toolCalls,
              { id: event.id, name: event.name, input: event.input, expanded: false },
            ],
          };
          return next;
        case "tool_result": {
          const toolCalls = last.toolCalls.map((tc) =>
            tc.id === event.toolUseId
              ? {
                  ...tc,
                  result: event.result.ok ? event.result.data : event.result.error,
                  resultIsError: !event.result.ok,
                }
              : tc,
          );
          next[next.length - 1] = { ...last, toolCalls };
          return next;
        }
        case "error":
          next[next.length - 1] = {
            ...last,
            text: last.text + `\n\n[error: ${event.message}]`,
          };
          return next;
        case "done":
          return next;
        default:
          return next;
      }
    });
  }

  function toggleToolExpanded(messageIdx: number, toolId: string) {
    setMessages((prev) =>
      prev.map((m, i) =>
        i === messageIdx
          ? {
              ...m,
              toolCalls: m.toolCalls.map((tc) =>
                tc.id === toolId ? { ...tc, expanded: !tc.expanded } : tc,
              ),
            }
          : m,
      ),
    );
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  }

  return (
    <main className="min-h-dvh flex flex-col items-stretch">
      <header className="border-b border-[var(--line)] px-5 py-4 flex items-baseline justify-between">
        <div>
          <div className="font-serif italic text-[22px] leading-none text-[var(--ink)]">
            ai.<span className="not-italic font-normal">lalu</span>.dev
          </div>
          <div className="font-mono text-[10px] tracking-[0.18em] text-[var(--mid)] mt-1 uppercase">
            ai ops agent · read-only · live homelab
          </div>
        </div>
        <a
          href="https://lalu.dev"
          className="font-mono text-[10px] tracking-[0.15em] uppercase text-[var(--mid)] hover:text-[var(--accent)] transition-colors"
        >
          ← lalu.dev
        </a>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-8 max-w-3xl w-full mx-auto">
        {messages.length === 0 ? (
          <Welcome onPick={(s) => void send(s)} />
        ) : (
          <div className="flex flex-col gap-6">
            {messages.map((m, idx) => (
              <MessageBubble
                key={idx}
                message={m}
                onToggleTool={(toolId) => toggleToolExpanded(idx, toolId)}
              />
            ))}
          </div>
        )}
      </div>

      <footer className="border-t border-[var(--line)] bg-[var(--panel)] px-5 py-4">
        <div className="max-w-3xl mx-auto flex items-end gap-3">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={busy ? "..." : "Pregunta al agente — server, ataques, visitas..."}
            rows={1}
            disabled={busy}
            className="flex-1 resize-none bg-transparent border-b border-[var(--line)] focus:border-[var(--accent)] outline-none font-serif text-[18px] py-2 placeholder:text-[var(--dim)] transition-colors"
          />
          <button
            type="button"
            onClick={() => void send(input)}
            disabled={busy || !input.trim()}
            className="font-mono text-[11px] tracking-[0.15em] uppercase border border-[var(--ink)] hover:bg-[var(--ink)] hover:text-[var(--bg)] disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[var(--ink)] px-4 py-2 transition-colors"
          >
            send →
          </button>
        </div>
        <div className="max-w-3xl mx-auto mt-2 flex items-center justify-between font-mono text-[9px] tracking-[0.12em] text-[var(--dim)] uppercase">
          <span>shift+enter = newline</span>
          <span>10 req/min · daily budget capped</span>
        </div>
      </footer>
    </main>
  );
}

function Welcome({ onPick }: { onPick: (s: string) => void }) {
  return (
    <div className="flex flex-col items-start gap-6 mt-8">
      <div className="font-serif text-[28px] leading-tight text-[var(--ink)]">
        Habla con un agente que <em>consulta en vivo</em> el homelab de Luis.
      </div>
      <p className="font-serif text-[17px] text-[var(--mid)] max-w-xl leading-relaxed">
        Métricas reales del servidor, intentos de intrusión SSH, geografía de
        ataques, tráfico del portfolio. Read-only. Llama 3.3 70B vía Groq con tool-use.
      </p>
      <div className="flex flex-wrap gap-2 mt-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="font-mono text-[11px] tracking-[0.05em] border border-[var(--line)] hover:border-[var(--accent)] hover:text-[var(--accent)] px-3 py-2 transition-colors text-left"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  onToggleTool,
}: {
  message: UiMessage;
  onToggleTool: (toolId: string) => void;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="font-serif text-[17px] text-[var(--ink)] bg-[var(--panel)] border-l-2 border-[var(--accent)] px-4 py-2 max-w-[85%] whitespace-pre-wrap">
          {message.text}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {message.toolCalls.map((tc) => (
        <ToolCallCard key={tc.id} tool={tc} onToggle={() => onToggleTool(tc.id)} />
      ))}
      <div
        className={`font-serif text-[17px] leading-relaxed text-[var(--ink)] whitespace-pre-wrap ${
          message.streaming && !message.text ? "" : message.streaming ? "stream-cursor" : ""
        }`}
      >
        {message.text || (message.streaming ? <span className="text-[var(--dim)]">thinking...</span> : null)}
      </div>
    </div>
  );
}

function ToolCallCard({
  tool,
  onToggle,
}: {
  tool: UiToolCall;
  onToggle: () => void;
}) {
  const status = tool.result === undefined ? "running" : tool.resultIsError ? "error" : "ok";
  const statusGlyph = status === "running" ? "..." : status === "error" ? "×" : "✓";
  const statusColor =
    status === "running"
      ? "text-[var(--mid)]"
      : status === "error"
        ? "text-red-700"
        : "text-[var(--accent)]";

  return (
    <div className="tool-card">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-3 w-full text-left hover:text-[var(--ink)]"
      >
        <span className={statusColor}>[{statusGlyph}]</span>
        <span className="text-[var(--ink)]">{tool.name}</span>
        <span className="ml-auto text-[var(--dim)]">{tool.expanded ? "−" : "+"}</span>
      </button>
      {tool.expanded ? (
        <div className="mt-2 pt-2 border-t border-[var(--line)] text-[10px] overflow-x-auto">
          {Object.keys((tool.input as object) ?? {}).length > 0 ? (
            <pre className="mb-2">input: {JSON.stringify(tool.input, null, 2)}</pre>
          ) : null}
          {tool.result !== undefined ? (
            <pre>{typeof tool.result === "string" ? tool.result : JSON.stringify(tool.result, null, 2)}</pre>
          ) : (
            <span className="text-[var(--dim)]">awaiting response from homelab...</span>
          )}
        </div>
      ) : null}
    </div>
  );
}
