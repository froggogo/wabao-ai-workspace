import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
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
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.register({ global: true }),
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
  ],
  controllers: [HealthController],
})
export class AppModule {}
