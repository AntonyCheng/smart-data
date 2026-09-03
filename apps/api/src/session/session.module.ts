import { Module } from '@nestjs/common';
import { OpenCodeModule } from '../opencode/opencode.module';
import { ArtifactModule } from '../artifact/artifact.module';
import { SessionController } from './session.controller';
import { SessionService } from './session.service';
import { SseHub } from './sse-hub';
import { SessionEventWatcher } from './session-event-watcher';

@Module({
  imports: [OpenCodeModule, ArtifactModule],
  controllers: [SessionController],
  providers: [SessionService, SseHub, SessionEventWatcher],
  exports: [SseHub, SessionEventWatcher, SessionService],
})
export class SessionModule {}
