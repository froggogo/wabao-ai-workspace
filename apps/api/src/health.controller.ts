import { Controller, Get } from '@nestjs/common';
import { AiService } from './ai/ai.service';
import { PrismaService } from './prisma/prisma.service';

@Controller()
export class HealthController {
  constructor(
    private readonly ai: AiService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('health')
  async health() {
    let db: 'up' | 'down' = 'down';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = 'up';
    } catch {
      db = 'down';
    }
    return {
      status: db === 'up' ? 'ok' : 'degraded',
      service: 'wabao-api',
      db,
      ai_mode: this.ai.isMock ? 'mock' : 'openai',
      time: new Date().toISOString(),
    };
  }
}
