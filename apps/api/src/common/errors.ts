import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * 统一业务错误码，对应《P1 原型与接口设计》第七节。
 * 错误响应体：{ "error": { "code", "message", "details?" } }
 */
export type AppErrorCode =
  | 'invalid_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'content_flagged'
  | 'rate_limited'
  | 'internal_error'
  | 'upstream_error';

const CODE_STATUS: Record<AppErrorCode, HttpStatus> = {
  invalid_request: HttpStatus.BAD_REQUEST,
  unauthorized: HttpStatus.UNAUTHORIZED,
  forbidden: HttpStatus.FORBIDDEN,
  not_found: HttpStatus.NOT_FOUND,
  conflict: HttpStatus.CONFLICT,
  content_flagged: HttpStatus.UNPROCESSABLE_ENTITY,
  rate_limited: HttpStatus.TOO_MANY_REQUESTS,
  internal_error: HttpStatus.INTERNAL_SERVER_ERROR,
  upstream_error: HttpStatus.BAD_GATEWAY,
};

export class AppException extends HttpException {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super({ error: { code, message, details } }, CODE_STATUS[code]);
  }
}
