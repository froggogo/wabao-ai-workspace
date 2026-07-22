import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * 成功响应统一包装为 { data: ... }。
 * 约定：当 handler 返回 undefined（如 SSE 已手动写入 res）时不做包装。
 * 已带有 data / pagination 结构的返回值原样透传。
 */
@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((payload) => {
        if (payload === undefined || payload === null) {
          return payload;
        }
        if (typeof payload === 'object' && ('data' in payload || 'error' in payload)) {
          return payload;
        }
        return { data: payload };
      }),
    );
  }
}
