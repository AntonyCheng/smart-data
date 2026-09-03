import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'node:events';

/** Unified frontend event envelope (design §12). */
export interface FrontendEvent {
  type: string;
  sessionId: string; // business session id — never the OpenCode id (§14)
  executionId: string | null;
  timestamp: number;
  data: Record<string, unknown>;
}

/** Per-session fanout of frontend events + active-execution registry. */
@Injectable()
export class SseHub extends EventEmitter {
  private readonly logger = new Logger(SseHub.name);
  /** businessSessionId -> active executionId (for replay on SSE connect) */
  private readonly active = new Map<string, string>();

  registerExecution(businessSessionId: string, executionId: string): void {
    this.active.set(businessSessionId, executionId);
  }
  clearExecution(businessSessionId: string): void {
    this.active.delete(businessSessionId);
  }
  activeExecution(businessSessionId: string): string | undefined {
    return this.active.get(businessSessionId);
  }

  publish(businessSessionId: string, type: string, data: Record<string, unknown>): void {
    const ev: FrontendEvent = {
      type,
      sessionId: businessSessionId,
      executionId: this.active.get(businessSessionId) ?? null,
      timestamp: Date.now(),
      data,
    };
    this.emit(`session:${businessSessionId}`, ev);
  }
}
