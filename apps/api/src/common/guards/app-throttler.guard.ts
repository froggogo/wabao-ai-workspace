import { ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AppException } from '../errors';
import { JwtPayload } from './jwt-auth.guard';

/**
 * 限流键与统一错误响应。
 *
 * 浏览器流量全部经由 Next 的 /bff 服务端转发，后端看到的来源 IP 恒为 BFF 自身，
 * 纯 IP 维度会把所有用户算作同一个调用方（全站共享一份额度）。因此：
 * - 已登录请求按 userId 计数（access token 需通过签名校验，避免伪造 sub 占用他人额度）；
 * - 未登录请求（注册/登录/刷新）回落到客户端 IP，依赖 trust proxy 从
 *   X-Forwarded-For 还原真实地址，见 main.ts。
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  // 父类以参数装饰器注入 options / storage，参数装饰器不随继承传递，需在此重新声明
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {
    super(options, storageService, reflector);
  }

  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const request = req as unknown as Request;
    const userId = await this.resolveUserId(request);
    if (userId) {
      return `user:${userId}`;
    }
    return `ip:${this.clientIp(request)}`;
  }

  protected async throwThrottlingException(_context: ExecutionContext): Promise<void> {
    throw new AppException('rate_limited', '请求过于频繁，请稍后再试');
  }

  /** 校验通过才采信 sub；令牌缺失/过期/伪造一律按匿名处理 */
  private async resolveUserId(req: Request): Promise<string | null> {
    const header = req.headers?.authorization;
    if (!header?.startsWith('Bearer ')) {
      return null;
    }
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(header.slice(7), {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      });
      return payload.type === 'access' ? payload.sub : null;
    } catch {
      return null;
    }
  }

  /**
   * Express 在 trust proxy 生效时会把 X-Forwarded-For 解析进 req.ips，
   * 其中 ips[0] 为最左侧（最接近客户端）的地址。
   */
  private clientIp(req: Request): string {
    return req.ips?.[0] ?? req.ip ?? 'unknown';
  }
}
