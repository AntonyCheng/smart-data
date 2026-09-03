/** Minimal typed view of the OpenCode Server API (v1.18.x). */

export interface OpenCodeHealth {
  healthy: boolean;
  version: string;
}

export interface OpenCodeSession {
  id: string;
  title?: string | null;
  [key: string]: unknown;
}

export interface OpenCodeAgent {
  name: string;
  mode?: string;
  description?: string;
  model?: string;
  [key: string]: unknown;
}

export interface OpenCodeTokens {
  total?: number;
  input?: number;
  output?: number;
  reasoning?: number;
  [key: string]: unknown;
}

export interface OpenCodeMessageInfo {
  id: string;
  role: 'user' | 'assistant';
  modelID?: string;
  error?: unknown;
  tokens?: OpenCodeTokens;
  [key: string]: unknown;
}

export type OpenCodePart =
  | { type: 'text'; text: string }
  | {
      type: 'tool';
      tool: string;
      state?: { status?: string; input?: Record<string, unknown>; output?: unknown };
    }
  | { type: string; [key: string]: unknown };

export interface OpenCodeMessage {
  info: OpenCodeMessageInfo;
  parts: OpenCodePart[];
}

/** One SSE frame from GET /event. */
export interface OpenCodeEvent {
  id?: string;
  type: string;
  properties?: Record<string, unknown>;
}

export interface OpenCodeTextPart {
  type: 'text';
  text: string;
}

export interface OpenCodePromptPayload {
  agent?: string;
  model?: string;
  parts: Array<OpenCodeTextPart | Record<string, unknown>>;
}

/** MCP server config sent to OpenCode POST /mcp (design §20). */
export type OpenCodeMcpConfig =
  | {
      type: 'local';
      command: string[]; // e.g. ['npx', '-y', '...']
      cwd?: string;
      environment?: Record<string, string>;
      enabled?: boolean;
      timeout?: number;
    }
  | {
      type: 'remote';
      url: string;
      enabled?: boolean;
      headers?: Record<string, string>;
      timeout?: number;
    };

export interface OpenCodeMcpAddPayload {
  name: string;
  config: OpenCodeMcpConfig;
}

/** MCP server status entry from GET /mcp (design §20). */
export interface OpenCodeMcpStatus {
  type?: string;
  status?: string;
  enabled?: boolean;
  error?: string;
  [key: string]: unknown;
}
