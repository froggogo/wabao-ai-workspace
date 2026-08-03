import { Module } from '@nestjs/common';
import { ImagesController } from './images.controller';
import { ImagesService } from './images.service';
import { StorageService } from './storage.service';
import { ImageQuotaService } from './image-quota.service';

/**
 * M5 图像与多模态（P2）。
 * 图像编排能力（ImageAiService）由全局 AiModule 提供，此处聚合业务层：
 * 存储、配额、作品管理、生成/变体/上传/看图问答。
 */
@Module({
  controllers: [ImagesController],
  providers: [ImagesService, StorageService, ImageQuotaService],
  exports: [ImagesService, StorageService, ImageQuotaService],
})
export class ImagesModule {}
