import { Controller, Get } from '@nestjs/common';
import { AiService } from './ai/ai.service';

@Controller()
export class HealthController {
  constructor(private readonly ai: AiService) {}

  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'wabao-api',
      ai_mode: this.ai.isMock ? 'mock' : 'openai',
      time: new Date().toISOString(),
    };
  }
}
