import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { OpenCodeClient } from './opencode.client';
import { OpenCodeEvent } from './opencode.types';

/**
 * Keeps one persistent SSE connection to OpenCode /event and re-emits parsed
 * events on the 'event' channel. Auto-reconnects with capped backoff.
 *
 * P1: infrastructure only (exercised by the smoke script).
 * P2: per-session filtering + transformation into the frontend event protocol (design §10–§13).
 */
@Injectable()
export class OpenCodeEventService extends EventEmitter implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OpenCodeEventService.name);
  private cancel?: () => void;
  private stopped = false;
  private reconnectDelayMs = 1_000;

  constructor(private readonly client: OpenCodeClient) {
    super();
  }

  onModuleInit(): void {
    this.connect();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    this.cancel?.();
  }

  private connect(): void {
    this.cancel = this.client.openEventStream(
      (event) => {
        const e = event as OpenCodeEvent;
        if (e.type === 'server.connected') this.reconnectDelayMs = 1_000;
        this.emit('event', e);
      },
      (err) => {
        if (this.stopped) return;
        this.logger.warn(
          `OpenCode event stream closed (${err?.message ?? 'unknown'}), reconnecting in ${this.reconnectDelayMs}ms`,
        );
        const delay = this.reconnectDelayMs;
        this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 15_000);
        setTimeout(() => {
          if (!this.stopped) this.connect();
        }, delay);
      },
    );
  }

  /** Async iterator over events (used by the P1 smoke script). */
  async *events(): AsyncGenerator<OpenCodeEvent> {
    const queue: OpenCodeEvent[] = [];
    let wake: (() => void) | null = null;
    const handler = (e: OpenCodeEvent): void => {
      queue.push(e);
      wake?.();
    };
    this.on('event', handler);
    try {
      for (;;) {
        while (queue.length > 0) yield queue.shift() as OpenCodeEvent;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    } finally {
      this.off('event', handler);
    }
  }
}
