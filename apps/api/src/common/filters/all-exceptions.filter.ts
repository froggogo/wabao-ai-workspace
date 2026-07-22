import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

/** 统一异常出口，保证响应体恒为 { error: { code, message, details? } } */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    // 流式响应（SSE）已开始发送，无法再改 header，交给 stream 层处理
    if (res.headersSent) {
      return;
    }

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ErrorBody = {
      error: { code: 'internal_error', message: '服务内部错误' },
    };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse();
      if (typeof resp === 'object' && resp !== null && 'error' in resp) {
        body = resp as ErrorBody;
      } else {
        const message =
          typeof resp === 'string'
            ? resp
            : ((resp as { message?: string | string[] }).message ?? exception.message);
        body = {
          error: {
            code: this.statusToCode(status),
            message: Array.isArray(message) ? message.join('; ') : message,
          },
        };
      }
    } else if (exception instanceof Error) {
      this.logger.error(`${req.method} ${req.url} - ${exception.message}`, exception.stack);
    }

    res.status(status).json(body);
  }

  private statusToCode(status: number): string {
    const map: Record<number, string> = {
      400: 'invalid_request',
      401: 'unauthorized',
      403: 'forbidden',
      404: 'not_found',
      409: 'conflict',
      422: 'content_flagged',
      429: 'rate_limited',
      502: 'upstream_error',
    };
    return map[status] ?? 'internal_error';
  }
}
