import { Injectable } from '@nestjs/common';

export interface OpenCodeClientOptions {
  baseUrl: string;
  username: string;
  password: string;
  /** Default timeout (ms) for normal queries. Design §29: connect 5s / query 30s. */
  defaultTimeoutMs?: number;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  timeoutMs?: number;
  /** Skip JSON parsing (e.g. 204 No Content). */
  raw?: boolean;
}

/** Structured failure from the OpenCode HTTP API so callers can recover safely. */
export class OpenCodeApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly path: string,
    public readonly responseBody: string,
  ) {
    super(message);
    this.name = 'OpenCodeApiError';
  }
}

/**
 * Low-level HTTP client for the OpenCode Server.
 *
 * - HTTP Basic Auth (design §27: OPENCODE_SERVER_USERNAME/PASSWORD)
 * - Internal network only (design §26): opencode-runtime is never exposed to the internet;
 *   Node's undici fetch does not honor proxy env vars, which is exactly what we want here.
 * - Timeouts per design §29 (connect 5s for health, 30s for normal queries, overridable).
 */
@Injectable()
export class OpenCodeClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly defaultTimeoutMs: number;

  constructor(opts: OpenCodeClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.authHeader =
      'Basic ' + Buffer.from(`${opts.username}:${opts.password}`).toString('base64');
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 30_000;
  }

  async request<T>(path: string, init: RequestOptions = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? this.defaultTimeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          Authorization: this.authHeader,
          ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new OpenCodeApiError(
          `OpenCode API ${init.method ?? 'GET'} ${path} failed: HTTP ${res.status} ${text.slice(0, 300)}`,
          res.status,
          path,
          text.slice(0, 1000),
        );
      }

      if (res.status === 204 || init.raw) return undefined as T;

      const json = (await res.json()) as unknown;
      // OpenCode wraps most payloads in { data: ... }; unwrap when that is the whole body.
      if (
        json !== null &&
        typeof json === 'object' &&
        !Array.isArray(json) &&
        Object.keys(json).length === 1 &&
        'data' in (json as Record<string, unknown>)
      ) {
        return (json as { data: T }).data;
      }
      return json as T;
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new Error(
          `OpenCode API ${init.method ?? 'GET'} ${path} timed out after ${init.timeoutMs ?? this.defaultTimeoutMs}ms`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Open the SSE stream on GET /event. Frames arrive as JSON objects
   * (first one is `server.connected`). Returns a cancel function.
   */
  openEventStream(
    onEvent: (event: unknown) => void,
    onEnd?: (err?: Error) => void,
  ): () => void {
    const controller = new AbortController();
    let stopped = false;

    void (async () => {
      try {
        const res = await fetch(`${this.baseUrl}/event`, {
          headers: { Authorization: this.authHeader, Accept: 'text/event-stream' },
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          throw new Error(`OpenCode /event failed: HTTP ${res.status}`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const dataLines = frame
              .split('\n')
              .filter((l) => l.startsWith('data:'))
              .map((l) => l.slice(5).trimStart());
            if (dataLines.length === 0) continue;
            try {
              onEvent(JSON.parse(dataLines.join('\n')));
            } catch {
              // Ignore malformed frames.
            }
          }
        }
        onEnd?.();
      } catch (err) {
        if (!stopped) onEnd?.(err as Error);
      }
    })();

    return () => {
      stopped = true;
      controller.abort();
    };
  }
}
