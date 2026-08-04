import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { AppException } from './common/errors';
import { requestLoggingMiddleware } from './common/middleware/request-logging.middleware';
import { createSignedMediaMiddleware } from './common/middleware/signed-media.middleware';
import { StorageService } from './modules/images/storage.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();

  // 信任前置代理的跳数（BFF / 网关）。用具体跳数而非 true：Express 会从右往左
  // 数这么多跳来取客户端地址，客户端自行伪造的 X-Forwarded-For 无法越过代理追加的部分。
  // 直连部署（无任何反向代理）应设为 0。
  app.set('trust proxy', Number(config.get('TRUST_PROXY_HOPS') ?? 1));

  // 安全响应头。API 不做页面嵌入，CSP 保持默认即可；
  // crossOriginResourcePolicy 放宽为 cross-origin，否则 <img crossorigin> / 跨域拉取媒体会被拦。
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: false,
    }),
  );
  app.use(requestLoggingMiddleware);

  // 媒体托管：签名校验（默认）或本地开放读取，替代裸 static
  const mediaRoot = resolve(process.cwd(), config.get<string>('MEDIA_ROOT') ?? 'uploads');
  mkdirSync(mediaRoot, { recursive: true });
  const storage = app.get(StorageService);
  app.use(createSignedMediaMiddleware(storage));

  const origins = (config.get<string>('CORS_ORIGIN') ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim());
  app.enableCors({
    origin: origins,
    credentials: true,
    exposedHeaders: ['X-Quota-Remaining', 'x-request-id'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      exceptionFactory: (errors) => {
        const details = errors.map((e) => ({
          field: e.property,
          messages: Object.values(e.constraints ?? {}),
        }));
        return new AppException('invalid_request', '参数校验失败', details);
      },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new TransformInterceptor());

  const port = Number(config.get('PORT') ?? 3001);
  await app.listen(port);
  Logger.log(`🐸 蛙宝 API 已启动：http://localhost:${port}/api/v1`, 'Bootstrap');
}

void bootstrap();
