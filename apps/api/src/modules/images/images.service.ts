import { Injectable, Logger } from '@nestjs/common';
import { MediaAsset, MediaSource, Prisma } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import {
  CAPTION_PURPOSES,
  CAPTION_TEMPLATE_ID,
  CAPTION_TONES,
  DEFAULT_CAPTION_PURPOSE,
  DEFAULT_CAPTION_TONE,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_IMAGE_SIZE,
  DEFAULT_IMAGE_STYLE,
  IMAGE_MODELS,
  IMAGE_SIZES,
  IMAGE_STYLES,
  IMAGE_UPLOAD_MAX_BYTES,
  IMAGE_UPLOAD_MIME_TYPES,
  ImageModelId,
  ImageSizeId,
  MAX_CAPTION_IMAGES,
  captionPurposeHint,
  captionToneHint,
  estimateImageCost,
  isImageModelAllowed,
  isImageStyleAllowed,
} from '@wabao/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AppException } from '../../common/errors';
import { SseEvent } from '../../common/sse';
import { estimateCost, estimateTokens } from '../../ai/models';
import { ImageAiService } from '../../ai/image.service';
import { ModerationService } from '../moderation/moderation.service';
import { UsageService } from '../users/usage.service';
import { StorageService } from './storage.service';
import { ImageQuotaService } from './image-quota.service';
import {
  AnalyzeImageDto,
  CaptionImageDto,
  CreateVariationDto,
  GenerateImageDto,
} from './dto/images.dto';

/** 图像理解按等效 token 计量时的单张图片基准（OpenAI 视觉输入约 700~1500 token/张） */
const VISION_TOKENS_PER_IMAGE = 1000;

@Injectable()
export class ImagesService {
  private readonly logger = new Logger('ImagesService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly imageAi: ImageAiService,
    private readonly storage: StorageService,
    private readonly quota: ImageQuotaService,
    private readonly moderation: ModerationService,
    private readonly usage: UsageService,
  ) {}

  // ---------- 选项目录 ----------

  /** GET /images/options：模型 / 尺寸 / 风格目录 + 当前用户权益与余量 */
  async options(userId: string) {
    const info = await this.quota.info(userId);
    return {
      models: IMAGE_MODELS.map((m) => ({
        ...m,
        allowed: info.limits.allowedModels.includes(m.id),
      })),
      sizes: IMAGE_SIZES,
      styles: IMAGE_STYLES.map((s) => ({
        ...s,
        allowed: isImageStyleAllowed(info.plan, s.id),
      })),
      defaults: {
        model: DEFAULT_IMAGE_MODEL,
        size: DEFAULT_IMAGE_SIZE,
        style: DEFAULT_IMAGE_STYLE,
      },
      limits: {
        plan: info.plan,
        monthly_images: info.quota,
        used_images: info.used,
        remaining_images: info.quota === 0 ? null : info.remaining,
        max_batch: info.limits.maxBatch,
        vision: info.limits.vision,
      },
      mock: this.imageAi.isMock,
    };
  }

  // ---------- 作品列表 ----------

  async list(
    userId: string,
    opts: { page?: number; pageSize?: number; source?: MediaSource } = {},
  ) {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 24));
    const where: Prisma.MediaAssetWhereInput = {
      userId,
      ...(opts.source ? { source: opts.source } : { source: { in: ['generation', 'variation'] } }),
    };
    const [items, total] = await Promise.all([
      this.prisma.mediaAsset.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.mediaAsset.count({ where }),
    ]);
    return {
      data: items.map((a) => this.toDto(a)),
      pagination: { page, page_size: pageSize, total },
    };
  }

  async get(userId: string, id: string) {
    return this.toDto(await this.findOwned(userId, id));
  }

  async remove(userId: string, id: string): Promise<void> {
    const asset = await this.findOwned(userId, id);
    await this.prisma.mediaAsset.delete({ where: { id } });
    await this.storage.remove(asset.url);
  }

  // ---------- 文生图（流式） ----------

  /**
   * 生成图片。以 SSE 逐张下发结果，前端可边生成边展示：
   *   image.start → image.item(每张) → image.done / error
   */
  async *generate(userId: string, dto: GenerateImageDto): AsyncGenerator<SseEvent> {
    const model = dto.model ?? DEFAULT_IMAGE_MODEL;
    const size = dto.size ?? DEFAULT_IMAGE_SIZE;
    const style = dto.style ?? DEFAULT_IMAGE_STYLE;
    const requested = dto.n ?? 1;

    // ⓪ 权益校验：套餐 → 模型 / 风格 / 批量张数 / 月度余量
    const info = await this.quota.info(userId);
    if (!isImageModelAllowed(info.plan, model)) {
      throw new AppException('forbidden', '当前套餐不可使用该图像模型，请升级后重试', {
        plan: info.plan,
        model,
      });
    }
    if (!isImageStyleAllowed(info.plan, style)) {
      throw new AppException('forbidden', '当前套餐不可使用该画面风格，请升级后重试', {
        plan: info.plan,
        style,
      });
    }
    if (requested > info.limits.maxBatch) {
      throw new AppException(
        'forbidden',
        `当前套餐单次最多生成 ${info.limits.maxBatch} 张，请升级后重试`,
        { plan: info.plan, max_batch: info.limits.maxBatch },
      );
    }
    // 先把额度占住再调模型，避免并发超发；后续任一步失败都要归还
    await this.quota.reserve(userId, requested);

    // ① 输入审核（prompt）
    const inMod = await this.moderation.check(dto.prompt, 'input', { userId });

    yield {
      event: 'image.start',
      data: {
        count: requested,
        model,
        size,
        style,
        mock: this.imageAi.isMock,
        // 供控制器写入 X-Quota-Remaining 响应头
        remaining_images: info.quota === 0 ? -1 : Math.max(0, info.remaining - requested),
      },
    };

    if (inMod.action === 'block') {
      await this.quota.release(userId, requested);
      yield {
        event: 'error',
        data: {
          code: 'content_flagged',
          message: '绘图描述包含不符合规范的内容，已被拦截',
          details: { categories: inMod.categories },
        },
      };
      return;
    }

    // ② 调用图像模型
    let results;
    try {
      results = await this.imageAi.generate({
        prompt: dto.prompt,
        model,
        size,
        style,
        count: requested,
      });
    } catch (err) {
      await this.quota.release(userId, requested);
      this.logger.warn(`图像生成失败：${(err as Error).message}`);
      yield {
        event: 'error',
        data: { code: 'upstream_error', message: `图像服务异常：${(err as Error).message}` },
      };
      return;
    }

    // 实际产出可能少于请求张数，多占的额度立即归还
    if (results.length < requested) {
      await this.quota.release(userId, requested - results.length);
    }

    // ③ 落盘 + 落库 + 逐张下发
    const dim = IMAGE_SIZES.find((s) => s.id === size) ?? IMAGE_SIZES[0];
    const assets: MediaAsset[] = [];
    for (const r of results) {
      const stored = await this.storage.saveBase64(r.b64, r.mimeType);
      // 输出审核：模型可能改写 prompt，对改写结果复审并落 flagged，
      // 使「生成内容需过审核」这一要求在数据上可追溯。
      const outMod = r.revisedPrompt
        ? await this.moderation.check(r.revisedPrompt, 'output', { userId })
        : null;
      const asset = await this.prisma.mediaAsset.create({
        data: {
          userId,
          type: 'image',
          source: 'generation',
          url: stored.url,
          prompt: dto.prompt,
          revisedPrompt: r.revisedPrompt,
          model,
          size,
          style,
          width: dim.width,
          height: dim.height,
          bytes: stored.bytes,
          mimeType: stored.mimeType,
          flagged: outMod?.flagged ?? false,
          cost: estimateImageCost(model, 1),
        },
      });
      assets.push(asset);
      yield { event: 'image.item', data: this.toDto(asset) };
    }

    // ④ 计量（图像按张数记录，token 字段记 0，成本按张计价）
    await this.recordImageUsage(userId, model, assets);

    const after = await this.quota.info(userId);
    yield {
      event: 'image.done',
      data: {
        count: assets.length,
        images: assets.map((a) => this.toDto(a)),
        usage: {
          images: assets.length,
          cost: estimateImageCost(model, assets.length),
        },
        quota: {
          quota: after.quota,
          used: after.used,
          remaining: after.quota === 0 ? null : after.remaining,
        },
      },
    };
  }

  // ---------- 变体重绘 ----------

  async *variation(
    userId: string,
    id: string,
    dto: CreateVariationDto,
  ): AsyncGenerator<SseEvent> {
    const source = await this.findOwned(userId, id);
    const info = await this.quota.info(userId);
    // 变体重绘与图像理解同属进阶权益（见定价页权益矩阵），免费版不开放
    if (!info.limits.vision) {
      throw new AppException('forbidden', '当前套餐不支持变体重绘，请升级后重试', {
        plan: info.plan,
      });
    }
    const model = (source.model || DEFAULT_IMAGE_MODEL) as ImageModelId;
    if (!isImageModelAllowed(info.plan, model)) {
      throw new AppException('forbidden', '当前套餐不可使用该图像模型，请升级后重试');
    }
    await this.quota.reserve(userId, 1);

    const size = (dto.size ?? source.size ?? DEFAULT_IMAGE_SIZE) as ImageSizeId;
    const prompt = dto.prompt?.trim() || source.prompt;

    if (dto.prompt?.trim()) {
      const mod = await this.moderation.check(dto.prompt, 'input', { userId });
      if (mod.action === 'block') {
        await this.quota.release(userId, 1);
        yield {
          event: 'error',
          data: {
            code: 'content_flagged',
            message: '变体描述包含不符合规范的内容，已被拦截',
            details: { categories: mod.categories },
          },
        };
        return;
      }
    }

    yield { event: 'image.start', data: { count: 1, model, size, source_id: source.id } };

    let results;
    try {
      const buf = await this.readAssetBuffer(source);
      results = await this.imageAi.variation({
        image: buf,
        mimeType: source.mimeType,
        prompt,
        model,
        size,
      });
    } catch (err) {
      await this.quota.release(userId, 1);
      yield {
        event: 'error',
        data: { code: 'upstream_error', message: `变体生成失败：${(err as Error).message}` },
      };
      return;
    }

    if (results.length < 1) {
      await this.quota.release(userId, 1);
    }

    const dim = IMAGE_SIZES.find((s) => s.id === size) ?? IMAGE_SIZES[0];
    const created: MediaAsset[] = [];
    for (const r of results) {
      const stored = await this.storage.saveBase64(r.b64, r.mimeType, 'var');
      const asset = await this.prisma.mediaAsset.create({
        data: {
          userId,
          type: 'image',
          source: 'variation',
          url: stored.url,
          prompt,
          revisedPrompt: r.revisedPrompt,
          model,
          size,
          style: source.style,
          width: dim.width,
          height: dim.height,
          bytes: stored.bytes,
          mimeType: stored.mimeType,
          sourceId: source.id,
          cost: estimateImageCost(model, 1),
        },
      });
      created.push(asset);
      yield { event: 'image.item', data: this.toDto(asset) };
    }

    await this.recordImageUsage(userId, model, created);

    const after = await this.quota.info(userId);
    yield {
      event: 'image.done',
      data: {
        count: created.length,
        images: created.map((a) => this.toDto(a)),
        quota: {
          quota: after.quota,
          used: after.used,
          remaining: after.quota === 0 ? null : after.remaining,
        },
      },
    };
  }

  // ---------- 上传（供图像理解 / 变体输入） ----------

  async upload(
    userId: string,
    file: { buffer: Buffer; mimetype: string; size: number; originalname?: string },
  ) {
    if (!file?.buffer?.length) {
      throw new AppException('invalid_request', '未收到文件内容');
    }
    if (!(IMAGE_UPLOAD_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
      throw new AppException(
        'invalid_request',
        `不支持的图片格式：${file.mimetype}，仅支持 PNG / JPEG / WebP / GIF`,
      );
    }
    if (file.size > IMAGE_UPLOAD_MAX_BYTES) {
      throw new AppException(
        'invalid_request',
        `图片体积超过上限（${Math.round(IMAGE_UPLOAD_MAX_BYTES / 1024 / 1024)}MB）`,
      );
    }

    const stored = await this.storage.save(file.buffer, file.mimetype, 'up');
    const asset = await this.prisma.mediaAsset.create({
      data: {
        userId,
        type: 'image',
        source: 'upload',
        url: stored.url,
        prompt: '',
        model: '',
        size: '',
        style: '',
        bytes: stored.bytes,
        mimeType: stored.mimeType,
      },
    });
    return this.toDto(asset);
  }

  // ---------- 图像理解（看图问答，流式） ----------

  /**
   * 看图问答。传入 conversation_id 时会把「带图的用户提问」与「AI 回复」
   * 一并落库到该会话，使贴图对话与普通文字对话一样可在刷新后回看。
   */
  async *analyze(userId: string, dto: AnalyzeImageDto): AsyncGenerator<SseEvent> {
    const info = await this.quota.info(userId);
    if (!info.limits.vision) {
      throw new AppException('forbidden', '当前套餐不支持图像理解（看图问答），请升级后重试', {
        plan: info.plan,
      });
    }
    if (dto.image_urls.length === 0) {
      throw new AppException('invalid_request', '请至少提供一张图片');
    }
    await this.assertOwnedImageUrls(userId, dto.image_urls);
    await this.usage.assertQuota(userId);

    // 校验会话归属（越权直接拒绝，避免把消息写进别人的会话）
    const conversation = dto.conversation_id
      ? await this.findOwnedConversation(userId, dto.conversation_id)
      : null;

    const mod = await this.moderation.check(dto.question, 'input', { userId });
    if (mod.action === 'block') {
      yield {
        event: 'error',
        data: {
          code: 'content_flagged',
          message: '提问内容不符合规范，已被拦截',
          details: { categories: mod.categories },
        },
      };
      return;
    }

    // 用户消息先落库，保证即使后续生成失败，用户的提问与图片也不会丢。
    // 附件一律存无签名相对路径，避免签名过期后历史消息里的链接失效。
    let userMessageId: string | undefined;
    if (conversation) {
      const attachmentUrls = dto.image_urls.map((u) => this.storage.toRelativeUrl(u));
      const userMsg = await this.prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: 'user',
          content: dto.question,
          attachments: attachmentUrls as Prisma.InputJsonValue,
        },
      });
      userMessageId = userMsg.id;
    }

    yield {
      event: 'message.start',
      data: {
        role: 'assistant',
        ...(conversation ? { conversation_id: conversation.id } : {}),
        ...(userMessageId ? { user_message_id: userMessageId } : {}),
      },
    };

    const urls = dto.image_urls.map((u) => this.storage.toAbsoluteUrl(u));
    let acc = '';
    try {
      for await (const delta of this.imageAi.analyzeStream({
        imageUrls: urls,
        question: dto.question,
      })) {
        acc += delta;
        yield { event: 'message.delta', data: { text: delta } };
      }
    } catch (err) {
      yield {
        event: 'error',
        data: { code: 'upstream_error', message: `视觉模型异常：${(err as Error).message}` },
      };
      return;
    }

    // 输出审核：命中则以提示文案替换，并标记 flagged（此前未使用返回值，属审核闭环缺口）
    const outMod = await this.moderation.check(acc, 'output', { userId });
    const blocked = outMod.action === 'block';
    const finalContent = blocked ? '⚠️ 该回复包含不符合规范的内容，已被拦截。' : acc;

    const inputTokens =
      estimateTokens(dto.question) + dto.image_urls.length * VISION_TOKENS_PER_IMAGE;
    const outputTokens = estimateTokens(acc);

    let assistantMessageId: string | undefined;
    if (conversation) {
      const aiMsg = await this.prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: 'assistant',
          content: finalContent,
          model: 'gpt-5.6-terra',
          flagged: blocked,
          inputTokens,
          outputTokens,
        },
      });
      assistantMessageId = aiMsg.id;
      // 会话时间戳与标题（首轮贴图提问时用问题作为标题）
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          updatedAt: new Date(),
          ...(conversation.title === '新会话'
            ? { title: dto.question.slice(0, 18) || '图片对话' }
            : {}),
        },
      });
    }

    await this.usage.record({
      userId,
      feature: 'vision',
      model: 'gpt-5.6-terra',
      inputTokens,
      outputTokens,
      messageId: assistantMessageId,
      idempotencyKey: assistantMessageId ? `vision:msg:${assistantMessageId}` : undefined,
    });

    yield {
      event: 'message.done',
      data: {
        finish_reason: 'stop',
        flagged: blocked,
        ...(blocked ? { filtered_content: finalContent } : {}),
        ...(assistantMessageId ? { message_id: assistantMessageId } : {}),
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
      },
    };
  }

  // ---------- 图 → 文案（M5 × M3 联动，流式） ----------

  /**
   * 依据图片生成营销文案 / 小红书笔记 / alt text 等。
   * 复用 Vision 能力，但以 systemPrompt 约束体裁，并把结果落为 Creation
   * 记录，使其与创作工作室的历史打通（可在「我的创作」中回看）。
   */
  async *caption(userId: string, dto: CaptionImageDto): AsyncGenerator<SseEvent> {
    const info = await this.quota.info(userId);
    if (!info.limits.vision) {
      throw new AppException('forbidden', '当前套餐不支持图生文案，请升级后重试', {
        plan: info.plan,
      });
    }
    if (dto.image_urls.length === 0) {
      throw new AppException('invalid_request', '请至少提供一张参考图');
    }
    await this.assertOwnedImageUrls(userId, dto.image_urls);
    await this.usage.assertQuota(userId);

    const purpose = dto.purpose ?? DEFAULT_CAPTION_PURPOSE;
    const tone = dto.tone ?? DEFAULT_CAPTION_TONE;
    const purposeInfo = CAPTION_PURPOSES.find((p) => p.id === purpose)!;

    if (dto.brief?.trim()) {
      const mod = await this.moderation.check(dto.brief, 'input', { userId });
      if (mod.action === 'block') {
        yield {
          event: 'error',
          data: {
            code: 'content_flagged',
            message: '补充要求包含不符合规范的内容，已被拦截',
            details: { categories: mod.categories },
          },
        };
        return;
      }
    }

    // 预建创作记录，便于前端立即拿到 id 并在「我的创作」中定位
    const inputs = {
      purpose,
      purpose_label: purposeInfo.label,
      tone,
      brief: dto.brief ?? '',
      image_urls: dto.image_urls,
    };
    const creation = await this.prisma.creation.create({
      data: {
        userId,
        templateId: CAPTION_TEMPLATE_ID,
        templateName: `图生文案 · ${purposeInfo.label}`,
        inputs: inputs as Prisma.InputJsonValue,
        output: '',
      },
    });

    yield {
      event: 'message.start',
      data: { creation_id: creation.id, role: 'assistant', purpose, tone },
    };

    const systemPrompt = [
      '你是资深内容营销文案专家，擅长依据图片撰写各渠道文案。',
      captionPurposeHint(purpose),
      captionToneHint(tone),
      '只输出文案正文，不要解释你的创作思路，不要出现"这张图片"之类的旁白。',
    ]
      .filter(Boolean)
      .join('\n');

    const question = [
      '请根据我提供的图片撰写文案。',
      dto.brief?.trim() ? `补充要求：${dto.brief.trim()}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const urls = dto.image_urls.map((u) => this.storage.toAbsoluteUrl(u));
    let acc = '';
    try {
      for await (const delta of this.imageAi.analyzeStream({
        imageUrls: urls,
        question,
        systemPrompt,
      })) {
        acc += delta;
        yield { event: 'message.delta', data: { text: delta } };
      }
    } catch (err) {
      yield {
        event: 'error',
        data: { code: 'upstream_error', message: `视觉模型异常：${(err as Error).message}` },
      };
      return;
    }

    const outMod = await this.moderation.check(acc, 'output', { userId, refId: creation.id });
    const blocked = outMod.action === 'block';
    const finalContent = blocked ? '⚠️ 生成的文案包含不符合规范的内容，已被拦截。' : acc;

    const inputTokens =
      estimateTokens(systemPrompt + question) +
      dto.image_urls.length * VISION_TOKENS_PER_IMAGE;
    const outputTokens = estimateTokens(acc);

    await this.prisma.creation.update({
      where: { id: creation.id },
      data: {
        output: finalContent,
        inputTokens,
        outputTokens,
        cost: estimateCost('gpt-5.6-terra', inputTokens, outputTokens),
      },
    });

    await this.usage.record({
      userId,
      feature: 'vision',
      model: 'gpt-5.6-terra',
      inputTokens,
      outputTokens,
      creationId: creation.id,
      idempotencyKey: `vision:creation:${creation.id}`,
    });

    yield {
      event: 'message.done',
      data: {
        finish_reason: 'stop',
        creation_id: creation.id,
        flagged: blocked,
        ...(blocked ? { filtered_content: finalContent } : {}),
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
      },
    };
  }

  /** 图 → 文案的可选项目录（供前端渲染用途与语气选择器） */
  async captionOptions(userId: string) {
    const info = await this.quota.info(userId);
    return {
      purposes: CAPTION_PURPOSES,
      tones: CAPTION_TONES,
      defaults: { purpose: DEFAULT_CAPTION_PURPOSE, tone: DEFAULT_CAPTION_TONE },
      limits: {
        plan: info.plan,
        vision: info.limits.vision,
        max_images: MAX_CAPTION_IMAGES,
      },
      mock: this.imageAi.isMock,
    };
  }

  // ---------- 内部辅助 ----------

  /** 图像用量落 usage_records：按资产逐条记，带幂等键避免重试双计 */
  private async recordImageUsage(userId: string, model: ImageModelId, assets: MediaAsset[]) {
    for (const asset of assets) {
      await this.usage.record({
        userId,
        feature: 'image',
        model,
        inputTokens: 0,
        outputTokens: 0,
        cost: estimateImageCost(model, 1),
        mediaAssetId: asset.id,
        idempotencyKey: `image:${asset.id}`,
      });
    }
  }

  private async readAssetBuffer(asset: MediaAsset): Promise<Buffer> {
    if (/^https?:\/\//i.test(asset.url)) {
      const res = await fetch(asset.url);
      return Buffer.from(await res.arrayBuffer());
    }
    return readFile(join(this.storage.rootDir, basename(asset.url)));
  }

  private async findOwned(userId: string, id: string): Promise<MediaAsset> {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset) {
      throw new AppException('not_found', '图片不存在');
    }
    if (asset.userId !== userId) {
      throw new AppException('forbidden', '无权访问该图片');
    }
    return asset;
  }

  /**
   * 校验多模态输入的图片归属。每个 URL 都必须是当前用户名下的媒体资产
   * （生成 / 变体 / 上传均可），否则拒绝。
   *
   * 少了这道校验，调用方可以传任意外链让服务端连带上游模型去拉取（SSRF），
   * 也能拿他人的图片地址来做看图问答。
   */
  private async assertOwnedImageUrls(userId: string, urls: string[]): Promise<void> {
    const normalized = urls.map((u) => this.storage.toRelativeUrl(u));
    const owned = await this.prisma.mediaAsset.findMany({
      where: { userId, url: { in: normalized } },
      select: { url: true },
    });
    const ownedUrls = new Set(owned.map((a) => a.url));
    const invalid = [...new Set(normalized.filter((u) => !ownedUrls.has(u)))];
    if (invalid.length > 0) {
      throw new AppException(
        'invalid_request',
        '参考图必须是你在蛙宝生成或上传的图片，请先上传后再试',
        { invalid_urls: invalid },
      );
    }
  }

  /** 校验会话存在且属于当前用户，避免把消息写入他人会话 */
  private async findOwnedConversation(userId: string, id: string) {
    const conv = await this.prisma.conversation.findUnique({ where: { id } });
    if (!conv) {
      throw new AppException('not_found', '会话不存在');
    }
    if (conv.userId !== userId) {
      throw new AppException('forbidden', '无权访问该会话');
    }
    return conv;
  }

  private toDto(a: MediaAsset) {
    return {
      id: a.id,
      type: a.type,
      source: a.source,
      // 对外返回签名 URL；库内仍存无签名相对路径
      url: this.storage.signUrl(a.url),
      prompt: a.prompt,
      revised_prompt: a.revisedPrompt,
      model: a.model,
      size: a.size,
      style: a.style,
      width: a.width,
      height: a.height,
      bytes: a.bytes,
      mime_type: a.mimeType,
      source_id: a.sourceId,
      flagged: a.flagged,
      created_at: a.createdAt,
    };
  }
}
