import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

const logger = new Logger('HTTP');

/**
 * 为每个请求挂上 `x-request-id`（客户端可自带，否则生成），
 * 并在结束后打一行结构化访问日志，便于按 requestId 串起排查。
 */
export function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const requestId =
    incoming && /^[\w-]{8,128}$/.test(incoming) ? incoming : randomUUID();
  req.headers['x-request-id'] = requestId;
  res.setHeader('x-request-id', requestId);

  const started = Date.now();
  res.on('finish', () => {
    const line = {
      requestId,
      method: req.method,
      path: req.originalUrl?.split('?')[0] ?? req.url,
      status: res.statusCode,
      ms: Date.now() - started,
      ip: req.ips?.[0] ?? req.ip,
    };
    // 5xx 用 error 级别，其余 info；不打印 query/body，避免泄密
    if (res.statusCode >= 500) {
      logger.error(JSON.stringify(line));
    } else {
      logger.log(JSON.stringify(line));
    }
  });

  next();
}
