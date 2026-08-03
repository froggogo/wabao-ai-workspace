import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { AppException } from './common/errors';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api/v1');

  // 媒体静态托管（P2 图像）：/uploads/** 直接读磁盘，不走 API 前缀与鉴权，
  // 便于 <img> 直接引用；生产环境建议改由 CDN / 对象存储承载。
  const mediaRoot = resolve(process.cwd(), config.get<string>('MEDIA_ROOT') ?? 'uploads');
  mkdirSync(mediaRoot, { recursive: true });
  app.useStaticAssets(mediaRoot, {
    prefix: '/uploads/',
    maxAge: '7d',
    immutable: true,
  });

  const origins = (config.get<string>('CORS_ORIGIN') ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim());
  app.enableCors({
    origin: origins,
    credentials: true,
    exposedHeaders: ['X-Quota-Remaining'],
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
