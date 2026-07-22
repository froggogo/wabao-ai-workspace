import { Global, Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { RouterService } from './router.service';
import { PromptService } from './prompt.service';

@Global()
@Module({
  providers: [AiService, RouterService, PromptService],
  exports: [AiService, RouterService, PromptService],
})
export class AiModule {}
