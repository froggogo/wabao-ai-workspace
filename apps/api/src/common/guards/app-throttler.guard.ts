import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AppException } from '../errors';

/**
 * 在触发限流时抛出统一业务错误（{ error: { code: 'rate_limited', ... } }），
 * 与全局错误响应约定保持一致，而非默认的 ThrottlerException 文案。
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async throwThrottlingException(_context: ExecutionContext): Promise<void> {
    throw new AppException('rate_limited', '请求过于频繁，请稍后再试');
  }
}
