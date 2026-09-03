/** Unified error codes (design §28). API key stays out of commits; see errors filter. */
export const ApiErrorCode = {
  AUTH_ERROR: 'AUTH_ERROR',
  FORBIDDEN: 'FORBIDDEN',
  BAD_REQUEST: 'BAD_REQUEST',
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  SESSION_BUSY: 'SESSION_BUSY',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  FILE_TYPE_NOT_SUPPORTED: 'FILE_TYPE_NOT_SUPPORTED',
  FILE_PROCESSING: 'FILE_PROCESSING',
  FILE_EXTRACTION_FAILED: 'FILE_EXTRACTION_FAILED',
  AGENT_RUNTIME_UNAVAILABLE: 'AGENT_RUNTIME_UNAVAILABLE',
  AGENT_EXECUTION_ERROR: 'AGENT_EXECUTION_ERROR',
  AGENT_ABORTED: 'AGENT_ABORTED',
  AGENT_INTERRUPTED: 'AGENT_INTERRUPTED',
  MODEL_ERROR: 'MODEL_ERROR',
  MCP_ERROR: 'MCP_ERROR',
} as const;

export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly httpStatus = 400,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Status codes for ai_execution (design §22). */
export const ExecutionStatus = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  ABORTED: 'ABORTED',
} as const;
export type ExecutionStatus = (typeof ExecutionStatus)[keyof typeof ExecutionStatus];
