import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { MessageService } from './message.service';
import { SendMessageDto, SendMessageResponse, AbortResponse, ExecutionStatusView } from './message.types';
import { MessageView } from '../session/session.types';

@Controller('sessions/:id')
export class MessageController {
  constructor(private readonly messages: MessageService) {}

  /** Design §8/§29: POST → 202 Accepted {executionId, status}. Supports fileIds (§18). */
  @Post('messages')
  @HttpCode(202)
  send(@Param('id') id: string, @Body() dto: SendMessageDto): Promise<SendMessageResponse> {
    return this.messages.send(id, dto?.content, dto?.fileIds, dto?.mode, dto?.context, dto?.metricProfileId);
  }

  /** Design §15: history from ai_message. */
  @Get('messages')
  list(@Param('id') id: string): Promise<MessageView[]> {
    return this.messages.list(id);
  }

  /** Public integration endpoint: read one persisted execution and its answer. */
  @Get('executions/:executionId')
  execution(@Param('id') id: string, @Param('executionId') executionId: string): Promise<ExecutionStatusView> {
    return this.messages.execution(id, executionId);
  }

  /** Design §16: abort a running execution. */
  @Post('abort')
  abort(@Param('id') id: string): Promise<AbortResponse> {
    return this.messages.abort(id);
  }
}
