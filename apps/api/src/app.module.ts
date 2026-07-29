import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppThrottlerGuard } from './common/guards/app-throttler.guard';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { AbortRegistryModule } from './common/abort-registry.service';
import { AiModule } from './ai/ai.module';
import { ModerationModule } from './modules/moderation/moderation.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { AssistantsModule } from './modules/assistants/assistants.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { CreationsModule } from './modules/creations/creations.module';
import { BillingModule } from './modules/billing/billing.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.register({ global: true }),
    // 全局请求限流：默认每 IP 每分钟 300 次（宽松，防刷/防误用）；
    // 敏感端点（登录/注册）在控制器上用 @Throttle 单独收紧。
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    PrismaModule,
    CommonModule,
    AbortRegistryModule,
    AiModule,
    ModerationModule,
    AuthModule,
    UsersModule,
    AssistantsModule,
    ConversationsModule,
    CreationsModule,
    BillingModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: AppThrottlerGuard }],
})
export class AppModule {}
