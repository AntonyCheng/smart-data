import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenCodeClient } from './opencode.client';
import { OpenCodeService } from './opencode.service';
import { OpenCodeEventService } from './opencode-event.service';

@Module({
  providers: [
    {
      provide: OpenCodeClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new OpenCodeClient({
          baseUrl: config.get<string>('OPENCODE_BASE_URL') ?? 'http://127.0.0.1:4096',
          username: config.get<string>('OPENCODE_USERNAME') ?? 'opencode',
          password: config.get<string>('OPENCODE_PASSWORD') ?? '',
        }),
    },
    OpenCodeService,
    OpenCodeEventService,
  ],
  exports: [OpenCodeService, OpenCodeEventService],
})
export class OpenCodeModule {}
