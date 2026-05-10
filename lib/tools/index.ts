import type OpenAI from "openai";
import type { ToolName, ToolResultPayload } from "../types";

const SECURITY_API = process.env.SECURITY_API_BASE ?? "https://security.lalu.dev/api";
const TOOL_TIMEOUT_MS = 5000;

export const TOOL_DEFINITIONS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_server_metrics",
      description:
        "Live system metrics from the homelab server: CPU %, RAM %, disk %, network bytes, and uptime in days+hours. Use when the user asks how the server is doing, current load, uptime, or resource usage.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_recent_ssh_attempts",
      description:
        "Most recent SSH brute-force attempts blocked by fail2ban. Returns up to ~50 entries with timestamp, source IP (anonymized), and attempted username. Use when the user asks about active threats, recent attacks, or who is hitting the server.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_threat_history",
      description:
        "Aggregated historical SSH threat data: total attempts over time, top attempted usernames, top source IPs. Use for questions about trends, totals, or 'how many attacks have you seen'.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_threat_geography",
      description:
        "Geographic distribution of SSH attackers as a list of {country, count} entries. Use when the user asks where attacks come from, which countries hit the server most, or wants a geographic breakdown.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_visitor_stats",
      description:
        "Read-only visitor counter for lalu.dev: total visits ever and visits today. Does NOT increment the counter. Use when the user asks about portfolio traffic.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

async function fetchWithTimeout(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`upstream ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function dispatchTool(name: ToolName): Promise<ToolResultPayload> {
  const endpoint: Record<ToolName, string> = {
    get_server_metrics: `${SECURITY_API}/metrics`,
    get_recent_ssh_attempts: `${SECURITY_API}/recent_threats`,
    get_threat_history: `${SECURITY_API}/history_threats`,
    get_threat_geography: `${SECURITY_API}/geo`,
    get_visitor_stats: `${SECURITY_API}/visitor_stats`,
  };
  try {
    const data = await fetchWithTimeout(endpoint[name]);
    return { ok: true, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return { ok: false, error: message };
  }
}

export function isToolName(name: string): name is ToolName {
  return TOOL_DEFINITIONS.some((t) => t.function.name === name);
}
