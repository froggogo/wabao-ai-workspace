import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { Request } from 'express';
import { AppThrottlerGuard } from './app-throttler.guard';

const ACCESS_SECRET = 'test_access_secret';

/** 暴露 protected getTracker 供断言 */
type TrackerProbe = { getTracker(req: Record<string, unknown>): Promise<string> };

describe('AppThrottlerGuard', () => {
  let guard: AppThrottlerGuard;
  let jwt: JwtService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ JWT_ACCESS_SECRET: ACCESS_SECRET })],
        }),
        JwtModule.register({ global: true }),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
      ],
      providers: [AppThrottlerGuard],
    }).compile();

    guard = moduleRef.get(AppThrottlerGuard);
    jwt = moduleRef.get(JwtService);
  });

  const track = (req: Partial<Request>): Promise<string> =>
    (guard as unknown as TrackerProbe).getTracker(req as unknown as Record<string, unknown>);

  const bearer = async (payload: Record<string, unknown>, secret = ACCESS_SECRET) =>
    `Bearer ${await jwt.signAsync(payload, { secret, expiresIn: 60 })}`;

  it('能被 Nest 容器解析（父类的参数装饰器已在子类重新声明）', () => {
    expect(guard).toBeInstanceOf(AppThrottlerGuard);
  });

  it('已登录请求按 userId 计数', async () => {
    const authorization = await bearer({ sub: 'u1', email: 'a@b.c', type: 'access' });
    await expect(track({ headers: { authorization }, ips: ['1.1.1.1'] })).resolves.toBe('user:u1');
  });

  it('同一 IP 的不同用户彼此独立（BFF 转发下的关键行为）', async () => {
    const ips = ['10.0.0.1'];
    const a = await bearer({ sub: 'u1', email: 'a@b.c', type: 'access' });
    const b = await bearer({ sub: 'u2', email: 'x@y.z', type: 'access' });
    const [ka, kb] = await Promise.all([
      track({ headers: { authorization: a }, ips }),
      track({ headers: { authorization: b }, ips }),
    ]);
    expect(ka).not.toBe(kb);
  });

  it('匿名请求回落到 X-Forwarded-For 还原出的客户端 IP', async () => {
    await expect(track({ headers: {}, ips: ['203.0.113.9', '10.0.0.1'], ip: '10.0.0.1' })).resolves.toBe(
      'ip:203.0.113.9',
    );
  });

  it('无代理头时回落到 socket 地址', async () => {
    await expect(track({ headers: {}, ips: [], ip: '127.0.0.1' })).resolves.toBe('ip:127.0.0.1');
  });

  it('伪造签名的令牌不被采信，按 IP 计数', async () => {
    const authorization = await bearer({ sub: 'victim', type: 'access' }, 'wrong_secret');
    await expect(track({ headers: { authorization }, ips: ['1.2.3.4'] })).resolves.toBe('ip:1.2.3.4');
  });

  it('refresh 令牌不能当作 access 身份用于限流', async () => {
    const authorization = await bearer({ sub: 'u1', email: 'a@b.c', type: 'refresh' });
    await expect(track({ headers: { authorization }, ips: ['1.2.3.4'] })).resolves.toBe('ip:1.2.3.4');
  });
});
