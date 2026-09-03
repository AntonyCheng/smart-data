import { MessageView } from '../session/session.types';

export interface ChatContextDto {
  file?: string;
  sheet?: string;
  selection?: string;
}

export class SendMessageDto {
  content?: string;
  fileIds?: string[];
  mode?: 'operate' | 'report';
  context?: ChatContextDto;
}

export interface SendMessageResponse {
  executionId: string;
  status: 'accepted';
}

export interface AbortResponse {
  status: 'aborted' | 'idle';
}

export interface ExecutionStatusView {
  executionId: string;
  sessionId: string;
  status: string;
  question?: string;
  answer?: string;
  errorCode?: string;
  errorMessage?: string;
  startedAt?: Date;
  completedAt?: Date;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export type { MessageView };
