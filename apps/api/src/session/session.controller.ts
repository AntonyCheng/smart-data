import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { SessionService } from './session.service';
import { SseHub, FrontendEvent } from './sse-hub';
import { CreateSessionDto, UpdateSessionDto, SessionView } from './session.types';

@Controller('sessions')
export class SessionController {
  constructor(
    private readonly sessions: SessionService,
    private readonly sse: SseHub,
  ) {}

  @Post()
  create(@Body() dto: CreateSessionDto): Promise<SessionView> {
    return this.sessions.create(dto?.title, dto?.mode);
  }

  @Get()
  list(): Promise<SessionView[]> {
    return this.sessions.list();
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<SessionView> {
    return this.sessions.get(id);
  }

  @Patch(':id')
  patch(@Param('id') id: string, @Body() dto: UpdateSessionDto): Promise<SessionView> {
    return this.sessions.patch(id, dto?.title, dto?.mode);
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ deleted: boolean }> {
    await this.sessions.remove(id);
    return { deleted: true };
  }

  /** SSE stream (design §11): unified event protocol, per business session. */
  @Get(':id/events')
  events(@Param('id') id: string, @Res() res: Response): void {
    void this.streamEvents(id, res);
  }

  private async streamEvents(id: string, res: Response): Promise<void> {
    let exists = false;
    try {
      await this.sessions.get(id);
      exists = true;
    } catch {
      exists = false;
    }
    if (!exists) {
      res.status(404).json({ code: 'SESSION_NOT_FOUND', message: '会话不存在', requestId: randomUUID() });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');

    // Replay agent.started if an execution is already in flight (§13 replay support)
    const active = this.sse.activeExecution(id);
    if (active) {
      this.writeEvent(res, {
        type: 'agent.started',
        sessionId: id,
        executionId: active,
        timestamp: Date.now(),
        data: {},
      });
    }

    const handler = (ev: FrontendEvent): void => this.writeEvent(res, ev);
    this.sse.on(`session:${id}`, handler);
    const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
    res.on('close', () => {
      clearInterval(ping);
      this.sse.off(`session:${id}`, handler);
    });
  }

  private writeEvent(res: Response, ev: FrontendEvent): void {
    res.write(`event: message\ndata: ${JSON.stringify(ev)}\n\n`); // §12 unified protocol
  }
}
