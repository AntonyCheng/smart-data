import { Injectable, Logger } from '@nestjs/common';
import { OpenCodeClient } from './opencode.client';
import {
  OpenCodeAgent,
  OpenCodeEvent,
  OpenCodeHealth,
  OpenCodeMcpAddPayload,
  OpenCodeMcpStatus,
  OpenCodeMessage,
  OpenCodePromptPayload,
  OpenCodeSession,
} from './opencode.types';

/**
 * Unified OpenCode access layer (design §5).
 * Nothing outside this module talks to the OpenCode runtime directly.
 */
@Injectable()
export class OpenCodeService {
  private readonly logger = new Logger(OpenCodeService.name);

  constructor(private readonly client: OpenCodeClient) {}

  /** GET /global/health — 5s budget (design §29). */
  healthCheck(): Promise<OpenCodeHealth> {
    return this.client.request<OpenCodeHealth>('/global/health', { timeoutMs: 5_000 });
  }

  /** GET /agent */
  listAgents(): Promise<OpenCodeAgent[]> {
    return this.client.request<OpenCodeAgent[]>('/agent');
  }

  /** GET /mcp — status of all configured MCP servers (design §20). */
  listMcp(): Promise<Record<string, OpenCodeMcpStatus>> {
    return this.client.request<Record<string, OpenCodeMcpStatus>>('/mcp');
  }

  /** POST /mcp — dynamically add an MCP server (design §20). */
  addMcp(payload: OpenCodeMcpAddPayload): Promise<Record<string, OpenCodeMcpStatus>> {
    return this.client.request<Record<string, OpenCodeMcpStatus>>('/mcp', {
      method: 'POST',
      body: payload,
      timeoutMs: 30_000,
    });
  }

  /** POST /session */
  createSession(title?: string): Promise<OpenCodeSession> {
    return this.client.request<OpenCodeSession>('/session', {
      method: 'POST',
      body: title ? { title } : {},
    });
  }

  /** GET /session/:id */
  getSession(id: string): Promise<OpenCodeSession> {
    return this.client.request<OpenCodeSession>(`/session/${encodeURIComponent(id)}`);
  }

  /** DELETE /session/:id */
  deleteSession(id: string): Promise<boolean> {
    return this.client.request<boolean>(`/session/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  /** PATCH /session/:id — update session properties (e.g. title). */
  patchSession(id: string, title: string): Promise<OpenCodeSession> {
    return this.client.request<OpenCodeSession>(`/session/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { title },
    });
  }

  /**
   * POST /session/:id/message — synchronous, blocks until the agent finishes.
   * NOT the default chat path (design §9); kept for debugging / one-shot use.
   */
  sendPrompt(sessionId: string, payload: OpenCodePromptPayload): Promise<OpenCodeMessage> {
    return this.client.request<OpenCodeMessage>(`/session/${encodeURIComponent(sessionId)}/message`, {
      method: 'POST',
      body: payload,
      timeoutMs: 10 * 60_000,
    });
  }

  /**
   * POST /session/:id/prompt_async — the default chat path (design §9).
   * Returns after 204 No Content; results arrive via the SSE event stream.
   */
  async sendPromptAsync(sessionId: string, payload: OpenCodePromptPayload): Promise<void> {
    await this.client.request<void>(`/session/${encodeURIComponent(sessionId)}/prompt_async`, {
      method: 'POST',
      body: payload,
      raw: true,
    });
  }

  /** POST /session/:id/abort */
  abortSession(sessionId: string): Promise<boolean> {
    return this.client.request<boolean>(`/session/${encodeURIComponent(sessionId)}/abort`, {
      method: 'POST',
    });
  }

  /** GET /session/:id/message */
  getMessages(sessionId: string): Promise<OpenCodeMessage[]> {
    return this.client.request<OpenCodeMessage[]>(
      `/session/${encodeURIComponent(sessionId)}/message`,
    );
  }

  /**
   * Subscribe to the OpenCode SSE stream (GET /event).
   * Returns a cancel function. P2 will filter/transform these events per session
   * before exposing them to the frontend (design §10–§13).
   */
  subscribeEvents(
    onEvent: (event: OpenCodeEvent) => void,
    onEnd?: (err?: Error) => void,
  ): () => void {
    return this.client.openEventStream((e) => onEvent(e as OpenCodeEvent), onEnd);
  }
}
