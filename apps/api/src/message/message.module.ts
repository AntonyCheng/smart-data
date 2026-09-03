import { Module } from '@nestjs/common';
import { OpenCodeModule } from '../opencode/opencode.module';
import { SessionModule } from '../session/session.module';
import { FileModule } from '../file/file.module';
import { MessageController } from './message.controller';
import { MessageService } from './message.service';

@Module({
  imports: [SessionModule, OpenCodeModule, FileModule],
  controllers: [MessageController],
  providers: [MessageService],
})
export class MessageModule {}
