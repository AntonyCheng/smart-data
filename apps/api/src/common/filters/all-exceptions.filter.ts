import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Response } from 'express';
import { ApiError, ApiErrorCode } from '../errors';

/**
 * Global error filter — unified error body (design §28):
 *   { "code": "...", "message": "...", "requestId": "..." }
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const requestId = randomUUID();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: ApiErrorCode | string = ApiErrorCode.AGENT_EXECUTION_ERROR;
    let message = '服务内部错误';

    if (exception instanceof ApiError) {
      status = exception.httpStatus;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse() as { message?: string | string[] };
      message = Array.isArray(body.message) ? body.message.join('; ') : body.message ?? exception.message;
      code = status === HttpStatus.NOT_FOUND ? ApiErrorCode.SESSION_NOT_FOUND : ApiErrorCode.BAD_REQUEST;
    } else if (exception instanceof Error) {
      this.logger.error(exception.stack ?? exception.message);
      message = '服务内部错误';
      code = ApiErrorCode.AGENT_EXECUTION_ERROR;
    }

    if (status >= 500) this.logger.error(`[${requestId}] ${code} -> ${message}`);

    res.status(status).json({ code, message, requestId });
  }
}
