export class CreateSessionDto {
  title?: string;
  mode?: 'operate' | 'report';
}

export class UpdateSessionDto {
  title?: string;
  mode?: 'operate' | 'report';
}

/** View exposed to the frontend — NEVER includes the OpenCode session id. */
export interface SessionView {
  id: string;
  title: string;
  status: string;
  running: boolean;
  mode: 'operate' | 'report';
  metricProfileId: string | null;
  categoryPrimary: string;
  categorySecondary: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageView {
  id: string;
  role: string;
  content: string;
  status: string;
  createdAt: Date;
  attachments: FileView[];
  metrics?: {
    durationMs?: number;
    tokenCount: number;
    tokenEstimated: boolean;
    inputTokens?: number;
    outputTokens?: number;
    model?: string;
  };
}
import type { FileView } from '../file/file.view';
