import type OpenAI from "openai";
import type { ToolName, ToolResultPayload } from "../types";

const SECURITY_API = process.env.SECURITY_API_BASE ?? "https://security.lalu.dev/api";
const PROM_BASE = process.env.PROM_BASE ?? "http://obs-prometheus:9090";
const LOKI_BASE = process.env.LOKI_BASE ?? "http://obs-loki:3100";
const TOOL_TIMEOUT_MS = 8000;

export const TOOL_DEFINITIONS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_server_metrics",
      description:
        "Live system metrics from the homelab server: CPU %, RAM %, disk %, network bytes, and uptime in days+hours. Quick snapshot — for deeper analysis use query_prometheus.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_recent_ssh_attempts",
      description:
        "Most recent SSH brute-force attempts detected in auth.log. Returns entries with timestamp, source IP (anonymized), and attempted username. Use for active threats / recent attacks.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_threat_geography",
      description:
        "Geographic distribution of SSH attackers as {country, count} entries. Use when asked where attacks come from.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_visitor_stats",
      description:
        "Read-only visitor counter for lalu.dev: total visits ever and visits today. Does NOT increment.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "query_prometheus",
      description:
        "Run a PromQL query for host metrics (CPU, RAM, disk, network). See the system prompt for ready-to-use PromQL snippets.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "A valid PromQL expression." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_logs",
      description: "Search recent Docker container logs via Loki.",
      parameters: {
        type: "object",
        properties: {
          contains: {
            type: "string",
            description: "Text to filter log lines, e.g. 'error'. Optional.",
          },
          minutes: {
            type: "number",
            description: "Lookback minutes, default 60.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_active_alerts",
      description:
        "List Prometheus alerts currently firing or pending (target down, high CPU/RAM, low disk). Use when the user asks if anything is wrong or wants a health summary.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

async function fetchJson(url: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// --- AIOps helpers ---

async function queryPrometheus(query: string): Promise<ToolResultPayload> {
  const url = `${PROM_BASE}/api/v1/query?query=${encodeURIComponent(query)}`;
  const json = await fetchJson(url);
  if (json.status !== "success") {
    return { ok: false, error: `prometheus: ${json.error ?? "query failed"}` };
  }
  const result = json.data?.result ?? [];
  if (result.length === 0) return { ok: true, data: { note: "no series matched", query } };
  const series = result.slice(0, 25).map((r: any) => ({
    ...r.metric,
    value: Array.isArray(r.value) ? r.value[1] : undefined,
  }));
  return { ok: true, data: { count: result.length, series } };
}

async function getActiveAlerts(): Promise<ToolResultPayload> {
  const json = await fetchJson(`${PROM_BASE}/api/v1/alerts`);
  const alerts = (json.data?.alerts ?? [])
    .filter((a: any) => a.state === "firing" || a.state === "pending")
    .map((a: any) => ({
      alert: a.labels?.alertname,
      severity: a.labels?.severity,
      state: a.state,
      instance: a.labels?.instance ?? a.labels?.job,
      summary: a.annotations?.summary,
      description: a.annotations?.description,
    }));
  return { ok: true, data: { firing: alerts.length, alerts } };
}

async function searchLogs(input: Record<string, unknown>): Promise<ToolResultPayload> {
  const minutes = Math.min(Math.max(Number(input.minutes) || 60, 1), 1440);
  const now = Date.now();
  const end = `${now}000000`;
  const start = `${now - minutes * 60_000}000000`;
  let selector = '{job="docker"}';
  const contains = typeof input.contains === "string" ? input.contains : "";
  if (contains) {
    // sanitize: strip quotes/backticks/backslashes to keep the LogQL well-formed
    const clean = contains.replace(/["`\\]/g, "").slice(0, 100);
    selector += ` |~ "(?i)${clean}"`;
  }
  const url =
    `${LOKI_BASE}/loki/api/v1/query_range?query=${encodeURIComponent(selector)}` +
    `&start=${start}&end=${end}&limit=40&direction=backward`;
  const json = await fetchJson(url);
  const streams = json.data?.result ?? [];
  const lines: Array<{ t: string; line: string }> = [];
  for (const s of streams) {
    for (const v of s.values ?? []) {
      lines.push({
        t: new Date(Number(v[0]) / 1e6).toISOString(),
        line: String(v[1]).slice(0, 220),
      });
    }
  }
  lines.sort((a, b) => (a.t < b.t ? 1 : -1));
  return { ok: true, data: { window_minutes: minutes, matched: lines.length, lines: lines.slice(0, 40) } };
}

export async function dispatchTool(name: ToolName, input?: unknown): Promise<ToolResultPayload> {
  const args = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  try {
    switch (name) {
      case "get_server_metrics":
        return { ok: true, data: await fetchJson(`${SECURITY_API}/metrics`) };
      case "get_recent_ssh_attempts":
        return { ok: true, data: await fetchJson(`${SECURITY_API}/threats`) };
      case "get_threat_geography":
        return { ok: true, data: await fetchJson(`${SECURITY_API}/geo`) };
      case "get_visitor_stats":
        return { ok: true, data: await fetchJson(`${SECURITY_API}/visitor_stats`) };
      case "query_prometheus":
        return await queryPrometheus(String(args.query ?? ""));
      case "search_logs":
        return await searchLogs(args);
      case "get_active_alerts":
        return await getActiveAlerts();
      default:
        return { ok: false, error: `unhandled tool: ${name}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return { ok: false, error: message };
  }
}

export function isToolName(name: string): name is ToolName {
  return TOOL_DEFINITIONS.some((t) => t.function.name === name);
}
