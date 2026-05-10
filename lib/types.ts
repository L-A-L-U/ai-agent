export type ToolName =
  | "get_server_metrics"
  | "get_recent_ssh_attempts"
  | "get_threat_history"
  | "get_threat_geography"
  | "get_visitor_stats";

export type ToolResultPayload =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

export interface ChatRequestBody {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; id: string; name: ToolName; input: unknown }
  | { type: "tool_result"; toolUseId: string; result: ToolResultPayload }
  | { type: "error"; message: string }
  | { type: "done"; usage: { promptTokens: number; completionTokens: number } };
