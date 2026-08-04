import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { MediaSource } from '@prisma/client';
import { IMAGE_UPLOAD_MAX_BYTES } from '@wabao/shared';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { AppException } from '../../common/errors';
import { initSse, SseEvent, writeSse } from '../../common/sse';
import { ImagesService } from './images.service';
import {
  AnalyzeImageDto,
  CaptionImageDto,
  CreateVariationDto,
  GenerateImageDto,
} from './dto/images.dto';

/** 上传字段名与体积上限（multer 内存存储，随后交由 StorageService 落盘） */
const UPLOAD_FIELD = 'file';

@Controller()
@UseGuards(JwtAuthGuard)
export class ImagesController {
  constructor(private readonly images: ImagesService) {}

  /** 生图参数目录 + 当前套餐权益与余量 */
  @Get('images/options')
  async options(@CurrentUser() user: CurrentUserData, @Res({ passthrough: true }) res: Response) {
    const out = await this.images.options(user.id);
    this.setQuotaHeader(res, out.limits.remaining_images);
    return out;
  }

  /** 图 → 文案的用途与语气目录 */
  @Get('images/caption-options')
  captionOptions(@CurrentUser() user: CurrentUserData) {
    return this.images.captionOptions(user.id);
  }

  /** 我的作品（默认仅生成与变体，不含上传） */
  @Get('images')
  list(
    @CurrentUser() user: CurrentUserData,
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
    @Query('source') source?: MediaSource,
  ) {
    return this.images.list(user.id, {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      source,
    });
  }

  @Get('images/:id')
  detail(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.images.get(user.id, id);
  }

  @Delete('images/:id')
  async remove(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    await this.images.remove(user.id, id);
    return { success: true };
  }

  /** 文生图（默认 SSE 流式，逐张下发） */
  @Post('images/generations')
  async generate(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: GenerateImageDto,
    @Res() res: Response,
  ): Promise<void> {
    await this.pipeImages(this.images.generate(user.id, dto), dto.stream !== false, res);
  }

  /** 变体重绘 */
  @Post('images/:id/variations')
  async variation(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: CreateVariationDto,
    @Res() res: Response,
  ): Promise<void> {
    await this.pipeImages(this.images.variation(user.id, id, dto), dto.stream !== false, res);
  }

  /** 上传图片（供看图问答 / 变体输入） */
  @Post('images/uploads')
  @UseInterceptors(
    FileInterceptor(UPLOAD_FIELD, {
      limits: { fileSize: IMAGE_UPLOAD_MAX_BYTES, files: 1 },
    }),
  )
  upload(
    @CurrentUser() user: CurrentUserData,
    @UploadedFile()
    file?: { buffer: Buffer; mimetype: string; size: number; originalname?: string },
  ) {
    if (!file) {
      throw new AppException('invalid_request', `请以 multipart/form-data 的 ${UPLOAD_FIELD} 字段上传图片`);
    }
    return this.images.upload(user.id, file);
  }

  /** 图像理解：看图问答（SSE 文本流，与对话一致的事件结构） */
  @Post('images/analyses')
  async analyze(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: AnalyzeImageDto,
    @Res() res: Response,
  ): Promise<void> {
    await this.pipeText(this.images.analyze(user.id, dto), dto.stream !== false, res);
  }

  /** 图 → 文案：依据图片生成营销文案 / 小红书笔记 / alt text */
  @Post('images/captions')
  async caption(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CaptionImageDto,
    @Res() res: Response,
  ): Promise<void> {
    await this.pipeText(this.images.caption(user.id, dto), dto.stream !== false, res);
  }

  // ---------- SSE / 非流式 归一 ----------

  /**
   * 设置 X-Quota-Remaining 响应头（P1 约定的额度预警通道）。
   * 图像额度按张数计；null 或负数表示不限量，统一下发 unlimited。
   */
  private setQuotaHeader(res: Response, remaining: number | null | undefined): void {
    if (res.headersSent) return;
    if (remaining === undefined) return;
    const value = remaining === null || remaining < 0 ? 'unlimited' : String(remaining);
    res.setHeader('X-Quota-Remaining', value);
  }

  /** 图像类事件：非流式时聚合为 { data: { images, quota } } */
  private async pipeImages(
    gen: AsyncGenerator<SseEvent>,
    stream: boolean,
    res: Response,
  ): Promise<void> {
    if (stream) {
      await this.pipeSse(gen, res);
      return;
    }
    const images: unknown[] = [];
    let quota: { remaining?: number | null } | null = null;
    let usage: unknown = null;
    for await (const evt of gen) {
      const data = evt.data as Record<string, unknown>;
      switch (evt.event) {
        case 'image.done':
          quota = (data.quota as { remaining?: number | null }) ?? null;
          usage = data.usage ?? null;
          break;
        case 'image.item':
          images.push(data);
          break;
        case 'error':
          throw new AppException(
            (data.code as 'content_flagged' | 'upstream_error') ?? 'internal_error',
            (data.message as string) ?? '生成失败',
            data.details,
          );
      }
    }
    this.setQuotaHeader(res, quota?.remaining);
    res.status(HttpStatus.OK).json({ data: { images, usage, quota } });
  }

  /** 文本类事件：非流式时聚合完整文本 */
  private async pipeText(
    gen: AsyncGenerator<SseEvent>,
    stream: boolean,
    res: Response,
  ): Promise<void> {
    if (stream) {
      await this.pipeSse(gen, res);
      return;
    }
    let content = '';
    let usage: unknown = null;
    for await (const evt of gen) {
      const data = evt.data as Record<string, unknown>;
      switch (evt.event) {
        case 'message.delta':
          content += (data.text as string) ?? '';
          break;
        case 'message.done':
          usage = data.usage;
          break;
        case 'error':
          throw new AppException(
            (data.code as 'content_flagged' | 'upstream_error') ?? 'internal_error',
            (data.message as string) ?? '分析失败',
            data.details,
          );
      }
    }
    res.status(HttpStatus.OK).json({ data: { content, usage } });
  }

  /**
   * 统一 SSE 输出：首个事件前发生的异常（如配额/权限）走标准 JSON 错误，
   * 已开始流式后再出错则以 error 事件下发，避免响应头已发出导致的崩溃。
   */
  private async pipeSse(gen: AsyncGenerator<SseEvent>, res: Response): Promise<void> {
    let started = false;
    try {
      for await (const evt of gen) {
        if (!started) {
          // 首个事件多为 image.start / message.start，此时尚未 flush 响应头，
          // 可借机带上当前剩余额度供前端预警。
          const info = evt.data as Record<string, unknown>;
          if (typeof info?.remaining_images === 'number') {
            this.setQuotaHeader(res, info.remaining_images as number);
          }
          initSse(res);
          started = true;
        }
        writeSse(res, evt);
      }
    } catch (err) {
      if (!started) throw err;
      writeSse(res, {
        event: 'error',
        data: { code: 'internal_error', message: (err as Error).message },
      });
    } finally {
      if (started) res.end();
    }
  }
}
