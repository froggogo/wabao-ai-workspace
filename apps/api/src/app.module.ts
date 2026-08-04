import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppThrottlerGuard } from './common/guards/app-throttler.guard';
import { RedisThrottlerStorage } from './common/throttler-redis.storage';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { AbortRegistryModule } from './common/abort-registry.service';
import { QuotaModule } from './common/quota.service';
import { AiModule } from './ai/ai.module';
import { ModerationModule } from './modules/moderation/moderation.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { AssistantsModule } from './modules/assistants/assistants.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { CreationsModule } from './modules/creations/creations.module';
import { BillingModule } from './modules/billing/billing.module';
import { ImagesModule } from './modules/images/images.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.register({ global: true }),
    // 全局请求限流：默认每 tracker 每分钟 300 次。
    // 配置了 REDIS_URL 时用 Redis 共享计数（多副本安全），否则回退内存。
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const redisUrl = config.get<string>('REDIS_URL')?.trim();
        let storage: RedisThrottlerStorage | undefined;
        if (redisUrl) {
          try {
            storage = await RedisThrottlerStorage.connect(redisUrl);
          } catch (err) {
            // Redis 不可达时回退内存，避免整站起不来；生产应配好 Redis 或留空
            console.warn(
              `[Throttler] Redis 连接失败，回退内存限流：${err instanceof Error ? err.message : err}`,
            );
          }
        }
        return {
          throttlers: [{ ttl: 60_000, limit: 300 }],
          ...(storage ? { storage } : {}),
        };
      },
    }),
    PrismaModule,
    CommonModule,
    AbortRegistryModule,
    QuotaModule,
    AiModule,
    ModerationModule,
    AuthModule,
    UsersModule,
    AssistantsModule,
    ConversationsModule,
    CreationsModule,
    BillingModule,
    ImagesModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: AppThrottlerGuard }],
})
export class AppModule {}
