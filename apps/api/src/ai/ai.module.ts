import { Global, Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { RouterService } from './router.service';
import { PromptService } from './prompt.service';
import { ImageAiService } from './image.service';

@Global()
@Module({
  providers: [AiService, RouterService, PromptService, ImageAiService],
  exports: [AiService, RouterService, PromptService, ImageAiService],
})
export class AiModule {}
