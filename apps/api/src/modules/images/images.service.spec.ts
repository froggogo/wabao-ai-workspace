import { PLAN_IMAGE_LIMITS, estimateImageCost } from '@wabao/shared';
import { ImagesService } from './images.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ImageAiService } from '../../ai/image.service';
import { StorageService } from './storage.service';
import { ImageQuotaService } from './image-quota.service';
import { ModerationService } from '../moderation/moderation.service';
import { UsageService } from '../users/usage.service';
import { AppException } from '../../common/errors';
import type { SseEvent } from '../../common/sse';

/** 收集异步生成器产出的全部 SSE 事件 */
async function collect(gen: AsyncGenerator<SseEvent>): Promise<SseEvent[]> {
  const out: SseEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const data = (e: SseEvent) => e.data as Record<string, unknown>;
const eventsOf = (list: SseEvent[]) => list.map((e) => e.event);

interface Deps {
  prisma: {
    mediaAsset: {
      create: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      delete: jest.Mock;
    };
    usageRecord: { create: jest.Mock };
    message: { create: jest.Mock };
    conversation: { findUnique: jest.Mock; update: jest.Mock };
    creation: { create: jest.Mock; update: jest.Mock };
  };
  imageAi: { isMock: boolean; generate: jest.Mock; variation: jest.Mock; analyzeStream: jest.Mock };
  storage: {
    save: jest.Mock;
    saveBase64: jest.Mock;
    remove: jest.Mock;
    signUrl: jest.Mock;
    toAbsoluteUrl: jest.Mock;
    toRelativeUrl: jest.Mock;
    rootDir: string;
  };
  quota: { info: jest.Mock; reserve: jest.Mock; release: jest.Mock };
  moderation: { check: jest.Mock };
  usage: { record: jest.Mock; assertQuota: jest.Mock };
}

/** 构造带默认桩件的服务，测试内可按需覆写 */
function setup(plan: keyof typeof PLAN_IMAGE_LIMITS = 'plus', used = 0) {
  const limits = PLAN_IMAGE_LIMITS[plan];
  const quotaInfo = {
    plan,
    limits,
    quota: limits.monthlyImages,
    used,
    remaining: limits.monthlyImages === 0 ? Number.MAX_SAFE_INTEGER : limits.monthlyImages - used,
  };

  let seq = 0;
  const deps: Deps = {
    prisma: {
      mediaAsset: {
        // 回显入参，模拟数据库返回带 id/时间的完整记录
        create: jest.fn(({ data: d }) =>
          Promise.resolve({
            id: `asset_${++seq}`,
            createdAt: new Date('2026-07-31T00:00:00Z'),
            flagged: false,
            revisedPrompt: null,
            sourceId: null,
            width: 0,
            height: 0,
            ...d,
          }),
        ),
        findUnique: jest.fn(),
        // 带 url.in 条件的查询来自图片归属校验：默认回显为「都属于当前用户」，
        // 越权场景由具体用例覆盖为 []。其余查询（作品列表）保持返回空列表。
        findMany: jest.fn((args?: { where?: { url?: { in?: string[] } } }) =>
          Promise.resolve(args?.where?.url?.in?.map((url) => ({ url })) ?? []),
        ),
        count: jest.fn().mockResolvedValue(0),
        delete: jest.fn().mockResolvedValue({}),
      },
      usageRecord: { create: jest.fn().mockResolvedValue({}) },
      message: {
        create: jest.fn(({ data: d }) =>
          Promise.resolve({ id: `msg_${++seq}`, createdAt: new Date(), ...d }),
        ),
      },
      conversation: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'c1', userId: 'u1', title: '新会话', model: 'gpt-5.6-terra' }),
        update: jest.fn().mockResolvedValue({}),
      },
      creation: {
        create: jest.fn(({ data: d }) =>
          Promise.resolve({ id: `cr_${++seq}`, createdAt: new Date(), ...d }),
        ),
        update: jest.fn().mockResolvedValue({}),
      },
    },
    imageAi: {
      isMock: true,
      generate: jest
        .fn()
        .mockResolvedValue([
          { b64: 'AAA', mimeType: 'image/svg+xml', revisedPrompt: 'revised prompt' },
        ]),
      variation: jest
        .fn()
        .mockResolvedValue([{ b64: 'BBB', mimeType: 'image/svg+xml', revisedPrompt: 'var' }]),
      analyzeStream: jest.fn(async function* () {
        yield '这是';
        yield '解读';
      }),
    },
    storage: {
      save: jest
        .fn()
        .mockResolvedValue({ url: '/uploads/up_1.png', bytes: 100, mimeType: 'image/png' }),
      saveBase64: jest.fn((_b64: string, mime: string) =>
        Promise.resolve({ url: `/uploads/img_${++seq}.svg`, bytes: 256, mimeType: mime }),
      ),
      remove: jest.fn().mockResolvedValue(undefined),
      signUrl: jest.fn((u: string) => u),
      toAbsoluteUrl: jest.fn((u: string) => `https://cdn.test${u}`),
      toRelativeUrl: jest.fn((u: string) =>
        u.replace(/^https:\/\/cdn\.test/, '').split('?')[0],
      ),
      rootDir: '/tmp/media',
    },
    quota: {
      info: jest.fn().mockResolvedValue(quotaInfo),
      reserve: jest.fn().mockResolvedValue(quotaInfo),
      release: jest.fn().mockResolvedValue(undefined),
    },
    moderation: {
      check: jest.fn().mockResolvedValue({ action: 'allow', flagged: false, categories: [] }),
    },
    usage: { record: jest.fn().mockResolvedValue(0.01), assertQuota: jest.fn().mockResolvedValue(undefined) },
  };

  const service = new ImagesService(
    deps.prisma as unknown as PrismaService,
    deps.imageAi as unknown as ImageAiService,
    deps.storage as unknown as StorageService,
    deps.quota as unknown as ImageQuotaService,
    deps.moderation as unknown as ModerationService,
    deps.usage as unknown as UsageService,
  );
  return { service, deps, quotaInfo };
}

describe('ImagesService（P2 · M5 图像编排）', () => {
  // ---------------- options ----------------

  describe('options', () => {
    it('免费版：Mini 可用、旗舰模型不可用，且标记 mock', async () => {
      const { service } = setup('free');
      const res = await service.options('u1');

      expect(res.models.find((m) => m.id === 'gpt-image-2-mini')!.allowed).toBe(true);
      expect(res.models.find((m) => m.id === 'gpt-image-2')!.allowed).toBe(false);
      expect(res.limits.vision).toBe(false);
      expect(res.limits.max_batch).toBe(1);
      expect(res.mock).toBe(true);
    });

    it('免费版仅开放基础风格', async () => {
      const { service } = setup('free');
      const res = await service.options('u1');
      expect(res.styles.filter((s) => s.allowed).map((s) => s.id)).toEqual([
        'auto',
        'photo',
        'illustration',
        'flat',
      ]);
    });

    it('Plus 版全部模型与风格可用', async () => {
      const { service } = setup('plus');
      const res = await service.options('u1');
      expect(res.models.every((m) => m.allowed)).toBe(true);
      expect(res.styles.every((s) => s.allowed)).toBe(true);
      expect(res.limits.vision).toBe(true);
    });

    it('企业版不限量时 remaining_images 返回 null', async () => {
      const { service } = setup('enterprise');
      const res = await service.options('u1');
      expect(res.limits.monthly_images).toBe(0);
      expect(res.limits.remaining_images).toBeNull();
    });

    it('返回余量供前端渲染额度条', async () => {
      const { service } = setup('plus', 26);
      const res = await service.options('u1');
      expect(res.limits.used_images).toBe(26);
      expect(res.limits.remaining_images).toBe(PLAN_IMAGE_LIMITS.plus.monthlyImages - 26);
    });
  });

  // ---------------- generate ----------------

  describe('generate · 权益校验', () => {
    it('免费版使用旗舰模型抛 forbidden', async () => {
      const { service } = setup('free');
      await expect(
        collect(service.generate('u1', { prompt: 'x', model: 'gpt-image-2' })),
      ).rejects.toMatchObject({ code: 'forbidden' });
    });

    it('免费版使用进阶风格抛 forbidden', async () => {
      const { service } = setup('free');
      await expect(
        collect(service.generate('u1', { prompt: 'x', style: 'render3d' })),
      ).rejects.toMatchObject({ code: 'forbidden' });
    });

    it('批量张数超过套餐上限抛 forbidden 并回传上限', async () => {
      const { service } = setup('free');
      await expect(
        collect(service.generate('u1', { prompt: 'x', n: 4 })),
      ).rejects.toMatchObject({
        code: 'forbidden',
        details: { max_batch: 1 },
      });
    });

    it('配额校验按请求张数传入（批量整体校验）', async () => {
      const { service, deps } = setup('plus');
      await collect(service.generate('u1', { prompt: 'x', n: 3 }));
      expect(deps.quota.reserve).toHaveBeenCalledWith('u1', 3);
    });

    it('配额不足时向上抛出 rate_limited（不产生任何图片）', async () => {
      const { service, deps } = setup('plus');
      deps.quota.reserve.mockRejectedValue(
        new AppException('rate_limited', '额度不足', { quota: {} }),
      );
      await expect(collect(service.generate('u1', { prompt: 'x' }))).rejects.toMatchObject({
        code: 'rate_limited',
      });
      expect(deps.imageAi.generate).not.toHaveBeenCalled();
      expect(deps.prisma.mediaAsset.create).not.toHaveBeenCalled();
    });

    // 预留一旦泄漏就会长期占用用户额度，各失败分支都必须归还
    it('上游生成失败时归还全部预留', async () => {
      const { service, deps } = setup('plus');
      deps.imageAi.generate.mockRejectedValue(new Error('服务超时'));

      const events = await collect(service.generate('u1', { prompt: 'x', n: 2 }));

      expect(eventsOf(events)).toContain('error');
      expect(deps.quota.release).toHaveBeenCalledWith('u1', 2);
    });

    it('输入审核拦截时归还全部预留', async () => {
      const { service, deps } = setup('plus');
      deps.moderation.check.mockResolvedValue({
        action: 'block',
        flagged: true,
        categories: ['violence'],
      });

      await collect(service.generate('u1', { prompt: '违规', n: 2 }));

      expect(deps.quota.release).toHaveBeenCalledWith('u1', 2);
      expect(deps.prisma.mediaAsset.create).not.toHaveBeenCalled();
    });

    it('实际产出少于请求张数时归还差额', async () => {
      const { service, deps } = setup('plus');
      // 请求 3 张但上游只返回 1 张
      deps.imageAi.generate.mockResolvedValue([{ b64: 'A', mimeType: 'image/svg+xml' }]);

      await collect(service.generate('u1', { prompt: 'x', n: 3 }));

      expect(deps.quota.release).toHaveBeenCalledWith('u1', 2);
    });

    it('全部成功时不归还任何额度', async () => {
      const { service, deps } = setup('plus');
      deps.imageAi.generate.mockResolvedValue([
        { b64: 'A', mimeType: 'image/svg+xml' },
        { b64: 'B', mimeType: 'image/svg+xml' },
      ]);

      await collect(service.generate('u1', { prompt: 'x', n: 2 }));

      expect(deps.quota.release).not.toHaveBeenCalled();
    });
  });

  describe('generate · 正常流程', () => {
    it('SSE 事件顺序为 start → item… → done', async () => {
      const { service, deps } = setup('plus');
      deps.imageAi.generate.mockResolvedValue([
        { b64: 'A', mimeType: 'image/svg+xml' },
        { b64: 'B', mimeType: 'image/svg+xml' },
      ]);

      const events = await collect(service.generate('u1', { prompt: '青蛙', n: 2 }));
      expect(eventsOf(events)).toEqual(['image.start', 'image.item', 'image.item', 'image.done']);
      expect(data(events[0]).count).toBe(2);
      expect(data(events[0]).mock).toBe(true);
    });

    it('未指定参数时使用默认模型 / 尺寸 / 风格', async () => {
      const { service, deps } = setup('plus');
      await collect(service.generate('u1', { prompt: '默认参数' }));
      expect(deps.imageAi.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-image-2-mini',
          size: '1024x1024',
          style: 'auto',
          count: 1,
        }),
      );
    });

    it('落库字段完整：来源、尺寸、成本与 revisedPrompt', async () => {
      const { service, deps } = setup('plus');
      await collect(
        service.generate('u1', {
          prompt: '横版插画',
          model: 'gpt-image-2',
          size: '1536x1024',
          style: 'illustration',
        }),
      );

      const created = deps.prisma.mediaAsset.create.mock.calls[0][0].data;
      expect(created).toMatchObject({
        userId: 'u1',
        type: 'image',
        source: 'generation',
        prompt: '横版插画',
        model: 'gpt-image-2',
        size: '1536x1024',
        style: 'illustration',
        // 尺寸由 size 解析写入，供前端按真实宽高比占位
        width: 1536,
        height: 1024,
        revisedPrompt: 'revised prompt',
        cost: estimateImageCost('gpt-image-2', 1),
      });
    });

    it('item 事件返回 snake_case DTO（与接口契约一致）', async () => {
      const { service } = setup('plus');
      const events = await collect(service.generate('u1', { prompt: 'x' }));
      const item = data(events[1]);
      expect(item).toHaveProperty('mime_type');
      expect(item).toHaveProperty('revised_prompt');
      expect(item).toHaveProperty('source_id');
      expect(item).toHaveProperty('created_at');
      expect(item.url).toMatch(/^\/uploads\//);
    });

    it('每张图片各记一条用量（feature=image，token 记 0）', async () => {
      const { service, deps } = setup('plus');
      deps.imageAi.generate.mockResolvedValue([
        { b64: 'A', mimeType: 'image/svg+xml' },
        { b64: 'B', mimeType: 'image/svg+xml' },
      ]);
      await collect(service.generate('u1', { prompt: 'x', n: 2 }));

      expect(deps.usage.record).toHaveBeenCalledTimes(2);
      const rec = deps.usage.record.mock.calls[0][0];
      expect(rec).toMatchObject({
        userId: 'u1',
        feature: 'image',
        inputTokens: 0,
        outputTokens: 0,
      });
      expect(rec.mediaAssetId).toBeTruthy();
      expect(rec.idempotencyKey).toMatch(/^image:/);
      expect(rec.cost).toBeGreaterThan(0);
    });

    it('done 事件回传最新配额与本次成本', async () => {
      const { service, deps } = setup('plus', 10);
      deps.quota.info
        .mockResolvedValueOnce({
          plan: 'plus',
          limits: PLAN_IMAGE_LIMITS.plus,
          quota: 500,
          used: 10,
          remaining: 490,
        })
        .mockResolvedValueOnce({
          plan: 'plus',
          limits: PLAN_IMAGE_LIMITS.plus,
          quota: 500,
          used: 11,
          remaining: 489,
        });

      const events = await collect(service.generate('u1', { prompt: 'x' }));
      const done = data(events[events.length - 1]);
      expect(done.quota).toEqual({ quota: 500, used: 11, remaining: 489 });
      expect((done.usage as Record<string, number>).images).toBe(1);
    });
  });

  describe('generate · 审核与异常', () => {
    it('prompt 命中审核：先发 start 再发 error，且不调用模型', async () => {
      const { service, deps } = setup('plus');
      deps.moderation.check.mockResolvedValue({
        action: 'block',
        flagged: true,
        categories: ['violence'],
      });

      const events = await collect(service.generate('u1', { prompt: '违规内容' }));
      expect(eventsOf(events)).toEqual(['image.start', 'error']);
      expect(data(events[1]).code).toBe('content_flagged');
      expect(deps.imageAi.generate).not.toHaveBeenCalled();
      expect(deps.prisma.mediaAsset.create).not.toHaveBeenCalled();
    });

    it('模型调用失败时下发 upstream_error 而非崩溃', async () => {
      const { service, deps } = setup('plus');
      deps.imageAi.generate.mockRejectedValue(new Error('服务超时'));

      const events = await collect(service.generate('u1', { prompt: 'x' }));
      expect(eventsOf(events)).toEqual(['image.start', 'error']);
      expect(data(events[1]).code).toBe('upstream_error');
      expect(String(data(events[1]).message)).toContain('服务超时');
      // 失败不应计量
      expect(deps.usage.record).not.toHaveBeenCalled();
    });
  });

  // ---------------- variation ----------------

  describe('variation', () => {
    const source = {
      id: 'a1',
      userId: 'u1',
      url: '/uploads/img_1.svg',
      prompt: '源图描述',
      model: 'gpt-image-2-mini',
      size: '1024x1024',
      style: 'illustration',
      mimeType: 'image/svg+xml',
      createdAt: new Date(),
    };

    it('免费版不支持变体，抛 forbidden', async () => {
      const { service, deps } = setup('free');
      deps.prisma.mediaAsset.findUnique.mockResolvedValue(source);
      await expect(collect(service.variation('u1', 'a1', {}))).rejects.toMatchObject({
        code: 'forbidden',
      });
    });

    it('源图不存在抛 not_found', async () => {
      const { service, deps } = setup('plus');
      deps.prisma.mediaAsset.findUnique.mockResolvedValue(null);
      await expect(collect(service.variation('u1', 'nope', {}))).rejects.toMatchObject({
        code: 'not_found',
      });
    });

    it('访问他人图片抛 forbidden（越权保护）', async () => {
      const { service, deps } = setup('plus');
      deps.prisma.mediaAsset.findUnique.mockResolvedValue({ ...source, userId: 'other' });
      await expect(collect(service.variation('u1', 'a1', {}))).rejects.toMatchObject({
        code: 'forbidden',
      });
    });

    it('生成变体并记录 sourceId 形成重绘链', async () => {
      const { service, deps } = setup('plus');
      deps.prisma.mediaAsset.findUnique.mockResolvedValue(source);
      // 变体需要读取源图字节，这里直接桩掉文件读取
      jest
        .spyOn(
          service as unknown as { readAssetBuffer: (a: unknown) => Promise<Buffer> },
          'readAssetBuffer',
        )
        .mockResolvedValue(Buffer.from('src'));

      const events = await collect(service.variation('u1', 'a1', {}));
      expect(eventsOf(events)).toEqual(['image.start', 'image.item', 'image.done']);

      const created = deps.prisma.mediaAsset.create.mock.calls[0][0].data;
      expect(created).toMatchObject({
        source: 'variation',
        sourceId: 'a1',
        prompt: '源图描述',
        // 未指定时沿用源图风格
        style: 'illustration',
      });
    });

    it('未传 prompt 时不重复审核（沿用源图已审核过的描述）', async () => {
      const { service, deps } = setup('plus');
      deps.prisma.mediaAsset.findUnique.mockResolvedValue(source);
      jest
        .spyOn(
          service as unknown as { readAssetBuffer: (a: unknown) => Promise<Buffer> },
          'readAssetBuffer',
        )
        .mockResolvedValue(Buffer.from('src'));

      await collect(service.variation('u1', 'a1', {}));
      expect(deps.moderation.check).not.toHaveBeenCalled();
    });

    it('传入新 prompt 时会审核，命中则拦截', async () => {
      const { service, deps } = setup('plus');
      deps.prisma.mediaAsset.findUnique.mockResolvedValue(source);
      deps.moderation.check.mockResolvedValue({
        action: 'block',
        flagged: true,
        categories: ['hate'],
      });

      const events = await collect(service.variation('u1', 'a1', { prompt: '违规改写' }));
      expect(eventsOf(events)).toEqual(['error']);
      expect(data(events[0]).code).toBe('content_flagged');
      expect(deps.imageAi.variation).not.toHaveBeenCalled();
    });
  });

  // ---------------- upload ----------------

  describe('upload', () => {
    const file = (over: Partial<{ buffer: Buffer; mimetype: string; size: number }> = {}) => ({
      buffer: Buffer.from('img'),
      mimetype: 'image/png',
      size: 1024,
      ...over,
    });

    it('保存上传文件并落库为 upload 来源', async () => {
      const { service, deps } = setup('plus');
      const dto = await service.upload('u1', file());

      expect(deps.storage.save).toHaveBeenCalledWith(expect.any(Buffer), 'image/png', 'up');
      expect(deps.prisma.mediaAsset.create.mock.calls[0][0].data).toMatchObject({
        source: 'upload',
        userId: 'u1',
      });
      expect(dto.url).toBe('/uploads/up_1.png');
    });

    it('拒绝空文件', async () => {
      const { service } = setup('plus');
      await expect(
        service.upload('u1', file({ buffer: Buffer.alloc(0) })),
      ).rejects.toMatchObject({ code: 'invalid_request' });
    });

    it('拒绝不支持的格式（含 SVG，避免 XSS）', async () => {
      const { service } = setup('plus');
      for (const mimetype of ['image/svg+xml', 'application/pdf', 'text/html']) {
        await expect(service.upload('u1', file({ mimetype }))).rejects.toMatchObject({
          code: 'invalid_request',
        });
      }
    });

    it('拒绝超过 10MB 的文件', async () => {
      const { service } = setup('plus');
      await expect(
        service.upload('u1', file({ size: 11 * 1024 * 1024 })),
      ).rejects.toMatchObject({ code: 'invalid_request' });
    });

    it('上传不消耗绘图额度（不计入 media 生成计量）', async () => {
      const { service, deps } = setup('plus');
      await service.upload('u1', file());
      expect(deps.usage.record).not.toHaveBeenCalled();
      expect(deps.quota.reserve).not.toHaveBeenCalled();
    });
  });

  // ---------------- analyze（看图问答） ----------------

  describe('analyze', () => {
    it('免费版无 Vision 权益，抛 forbidden', async () => {
      const { service } = setup('free');
      await expect(
        collect(service.analyze('u1', { image_urls: ['/uploads/a.png'], question: 'q' })),
      ).rejects.toMatchObject({ code: 'forbidden' });
    });

    it('未提供图片抛 invalid_request', async () => {
      const { service } = setup('plus');
      await expect(
        collect(service.analyze('u1', { image_urls: [], question: 'q' })),
      ).rejects.toMatchObject({ code: 'invalid_request' });
    });

    it('图片不属于当前用户时拒绝，且不调用视觉模型、不落消息', async () => {
      const { service, deps } = setup('plus');
      deps.prisma.mediaAsset.findMany.mockResolvedValueOnce([]);

      await expect(
        collect(
          service.analyze('u1', {
            image_urls: ['/uploads/someone-else.png'],
            question: 'q',
            conversation_id: 'c1',
          }),
        ),
      ).rejects.toMatchObject({
        code: 'invalid_request',
        details: { invalid_urls: ['/uploads/someone-else.png'] },
      });

      expect(deps.imageAi.analyzeStream).not.toHaveBeenCalled();
      expect(deps.prisma.message.create).not.toHaveBeenCalled();
      expect(deps.usage.record).not.toHaveBeenCalled();
    });

    it('外链图片一律拒绝（不给上游模型拉取任意地址的机会）', async () => {
      const { service, deps } = setup('plus');
      deps.prisma.mediaAsset.findMany.mockResolvedValueOnce([]);

      await expect(
        collect(
          service.analyze('u1', { image_urls: ['http://evil.internal/secret.png'], question: 'q' }),
        ),
      ).rejects.toMatchObject({ code: 'invalid_request' });
      expect(deps.imageAi.analyzeStream).not.toHaveBeenCalled();
    });

    it('归属校验按 userId + url 精确查询', async () => {
      const { service, deps } = setup('plus');
      await collect(service.analyze('u1', { image_urls: ['/uploads/a.png'], question: 'q' }));

      expect(deps.prisma.mediaAsset.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1', url: { in: ['/uploads/a.png'] } },
        }),
      );
    });

    it('配置了公网前缀时，绝对地址会先归一化再校验归属', async () => {
      const { service, deps } = setup('plus');
      await collect(
        service.analyze('u1', {
          image_urls: ['https://cdn.test/uploads/a.png'],
          question: 'q',
        }),
      );

      expect(deps.prisma.mediaAsset.findMany.mock.calls[0][0].where.url.in).toEqual([
        '/uploads/a.png',
      ]);
      expect(deps.imageAi.analyzeStream).toHaveBeenCalled();
    });

    it('SSE 事件复用对话契约 message.start/delta/done', async () => {
      const { service } = setup('plus');
      const events = await collect(
        service.analyze('u1', { image_urls: ['/uploads/a.png'], question: '这是什么' }),
      );
      expect(eventsOf(events)).toEqual([
        'message.start',
        'message.delta',
        'message.delta',
        'message.done',
      ]);
      expect(data(events[1]).text).toBe('这是');
    });

    it('图片 URL 转为绝对地址后再传给视觉模型', async () => {
      const { service, deps } = setup('plus');
      await collect(
        service.analyze('u1', { image_urls: ['/uploads/a.png'], question: 'q' }),
      );
      expect(deps.storage.toAbsoluteUrl).toHaveBeenCalledWith('/uploads/a.png');
      expect(deps.imageAi.analyzeStream).toHaveBeenCalledWith(
        expect.objectContaining({ imageUrls: ['https://cdn.test/uploads/a.png'] }),
      );
    });

    it('按 feature=vision 计量，且图片折算等效 token', async () => {
      const { service, deps } = setup('plus');
      await collect(
        service.analyze('u1', {
          image_urls: ['/uploads/a.png', '/uploads/b.png'],
          question: 'q',
        }),
      );

      const rec = deps.usage.record.mock.calls[0][0];
      expect(rec.feature).toBe('vision');
      // 2 张图 × 1000 token 基准，故输入 token 必然大于 2000
      expect(rec.inputTokens).toBeGreaterThan(2000);
      expect(rec.outputTokens).toBeGreaterThan(0);
    });

    it('提问命中审核则拦截，不调用视觉模型', async () => {
      const { service, deps } = setup('plus');
      deps.moderation.check.mockResolvedValue({
        action: 'block',
        flagged: true,
        categories: ['sexual'],
      });

      const events = await collect(
        service.analyze('u1', { image_urls: ['/uploads/a.png'], question: '违规' }),
      );
      expect(eventsOf(events)).toEqual(['error']);
      expect(deps.imageAi.analyzeStream).not.toHaveBeenCalled();
    });

    it('对输出内容也执行审核（输入 + 输出双向）', async () => {
      const { service, deps } = setup('plus');
      await collect(service.analyze('u1', { image_urls: ['/uploads/a.png'], question: 'q' }));
      const kinds = deps.moderation.check.mock.calls.map((c) => c[1]);
      expect(kinds).toContain('input');
      expect(kinds).toContain('output');
    });

    it('Token 配额不足时向上抛出（复用文本配额）', async () => {
      const { service, deps } = setup('plus');
      deps.usage.assertQuota.mockRejectedValue(new AppException('rate_limited', 'token 不足'));
      await expect(
        collect(service.analyze('u1', { image_urls: ['/uploads/a.png'], question: 'q' })),
      ).rejects.toMatchObject({ code: 'rate_limited' });
    });

    it('视觉模型异常时下发 upstream_error', async () => {
      const { service, deps } = setup('plus');
      deps.imageAi.analyzeStream.mockImplementation(async function* () {
        yield '开始';
        throw new Error('视觉服务中断');
      });

      const events = await collect(
        service.analyze('u1', { image_urls: ['/uploads/a.png'], question: 'q' }),
      );
      expect(eventsOf(events)).toContain('error');
      expect(data(events[events.length - 1]).code).toBe('upstream_error');
    });
  });

  // ---------------- list / remove ----------------

  describe('list', () => {
    it('默认仅返回生成与变体（排除用户上传）', async () => {
      const { service, deps } = setup('plus');
      await service.list('u1');
      expect(deps.prisma.mediaAsset.findMany.mock.calls[0][0].where.source).toEqual({
        in: ['generation', 'variation'],
      });
    });

    it('可按来源筛选', async () => {
      const { service, deps } = setup('plus');
      await service.list('u1', { source: 'variation' });
      expect(deps.prisma.mediaAsset.findMany.mock.calls[0][0].where.source).toBe('variation');
    });

    it('分页参数被规范化（页码下限 1、每页上限 100）', async () => {
      const { service, deps } = setup('plus');
      await service.list('u1', { page: 0, pageSize: 999 });
      const args = deps.prisma.mediaAsset.findMany.mock.calls[0][0];
      expect(args.skip).toBe(0);
      expect(args.take).toBe(100);
    });

    it('按创建时间倒序返回并附带分页信息', async () => {
      const { service, deps } = setup('plus');
      deps.prisma.mediaAsset.count.mockResolvedValue(42);
      const res = await service.list('u1', { page: 2, pageSize: 10 });

      expect(deps.prisma.mediaAsset.findMany.mock.calls[0][0].orderBy).toEqual({
        createdAt: 'desc',
      });
      expect(res.pagination).toEqual({ page: 2, page_size: 10, total: 42 });
    });
  });

  describe('remove', () => {
    it('删除记录并清理磁盘文件', async () => {
      const { service, deps } = setup('plus');
      deps.prisma.mediaAsset.findUnique.mockResolvedValue({
        id: 'a1',
        userId: 'u1',
        url: '/uploads/img_1.svg',
      });

      await service.remove('u1', 'a1');
      expect(deps.prisma.mediaAsset.delete).toHaveBeenCalledWith({ where: { id: 'a1' } });
      expect(deps.storage.remove).toHaveBeenCalledWith('/uploads/img_1.svg');
    });

    it('不能删除他人图片', async () => {
      const { service, deps } = setup('plus');
      deps.prisma.mediaAsset.findUnique.mockResolvedValue({ id: 'a1', userId: 'other' });
      await expect(service.remove('u1', 'a1')).rejects.toMatchObject({ code: 'forbidden' });
      expect(deps.prisma.mediaAsset.delete).not.toHaveBeenCalled();
    });
  });

  // ---------------- 看图问答落库（修复：此前贴图对话刷新即丢失） ----------------

  describe('analyze · 会话落库', () => {
    it('不传 conversation_id 时不写消息表（保持无状态问答）', async () => {
      const { service, deps } = setup('plus');
      await collect(service.analyze('u1', { image_urls: ['/uploads/a.png'], question: 'q' }));
      expect(deps.prisma.message.create).not.toHaveBeenCalled();
    });

    it('传 conversation_id 时把带图提问与回复一并落库', async () => {
      const { service, deps } = setup('plus');
      await collect(
        service.analyze('u1', {
          image_urls: ['/uploads/a.png', '/uploads/b.png'],
          question: '这两张图有什么区别',
          conversation_id: 'c1',
        }),
      );

      expect(deps.prisma.message.create).toHaveBeenCalledTimes(2);
      // 用户消息：内容 + 图片附件
      expect(deps.prisma.message.create.mock.calls[0][0].data).toMatchObject({
        conversationId: 'c1',
        role: 'user',
        content: '这两张图有什么区别',
        attachments: ['/uploads/a.png', '/uploads/b.png'],
      });
      // AI 回复：带 token 计量
      const ai = deps.prisma.message.create.mock.calls[1][0].data;
      expect(ai).toMatchObject({ conversationId: 'c1', role: 'assistant', flagged: false });
      expect(ai.content.length).toBeGreaterThan(0);
      expect(ai.inputTokens).toBeGreaterThan(0);
    });

    it('start 事件回传会话 id 与用户消息 id，done 事件回传 AI 消息 id', async () => {
      const { service } = setup('plus');
      const events = await collect(
        service.analyze('u1', {
          image_urls: ['/uploads/a.png'],
          question: 'q',
          conversation_id: 'c1',
        }),
      );
      expect(data(events[0])).toMatchObject({ conversation_id: 'c1' });
      expect(data(events[0]).user_message_id).toBeDefined();
      expect(data(events[events.length - 1]).message_id).toBeDefined();
    });

    it('首轮贴图提问会用问题更新会话标题', async () => {
      const { service, deps } = setup('plus');
      await collect(
        service.analyze('u1', {
          image_urls: ['/uploads/a.png'],
          question: '帮我解读这张销售图表',
          conversation_id: 'c1',
        }),
      );
      expect(deps.prisma.conversation.update.mock.calls[0][0].data.title).toBe('帮我解读这张销售图表');
    });

    it('已有标题的会话不会被覆盖', async () => {
      const { service, deps } = setup('plus');
      deps.prisma.conversation.findUnique.mockResolvedValue({
        id: 'c1',
        userId: 'u1',
        title: '我的图表分析',
      });
      await collect(
        service.analyze('u1', {
          image_urls: ['/uploads/a.png'],
          question: '再看一张',
          conversation_id: 'c1',
        }),
      );
      expect(deps.prisma.conversation.update.mock.calls[0][0].data.title).toBeUndefined();
    });

    it('会话不存在抛 not_found', async () => {
      const { service, deps } = setup('plus');
      deps.prisma.conversation.findUnique.mockResolvedValue(null);
      await expect(
        collect(
          service.analyze('u1', {
            image_urls: ['/uploads/a.png'],
            question: 'q',
            conversation_id: 'nope',
          }),
        ),
      ).rejects.toMatchObject({ code: 'not_found' });
    });

    it('不能把消息写入他人会话（越权保护）', async () => {
      const { service, deps } = setup('plus');
      deps.prisma.conversation.findUnique.mockResolvedValue({
        id: 'c1',
        userId: 'other',
        title: '新会话',
      });
      await expect(
        collect(
          service.analyze('u1', {
            image_urls: ['/uploads/a.png'],
            question: 'q',
            conversation_id: 'c1',
          }),
        ),
      ).rejects.toMatchObject({ code: 'forbidden' });
      expect(deps.prisma.message.create).not.toHaveBeenCalled();
    });

    it('输出审核命中时以提示文案落库并标记 flagged', async () => {
      const { service, deps } = setup('plus');
      deps.moderation.check.mockImplementation((_t: string, kind: string) =>
        Promise.resolve(
          kind === 'output'
            ? { action: 'block', flagged: true, categories: ['violence'] }
            : { action: 'allow', flagged: false, categories: [] },
        ),
      );

      const events = await collect(
        service.analyze('u1', {
          image_urls: ['/uploads/a.png'],
          question: 'q',
          conversation_id: 'c1',
        }),
      );

      const ai = deps.prisma.message.create.mock.calls[1][0].data;
      expect(ai.flagged).toBe(true);
      expect(ai.content).toContain('已被拦截');
      const done = data(events[events.length - 1]);
      expect(done.flagged).toBe(true);
      expect(done.filtered_content).toContain('已被拦截');
    });

    it('生成失败时用户消息已落库（提问不丢失）', async () => {
      const { service, deps } = setup('plus');
      deps.imageAi.analyzeStream.mockImplementation(async function* () {
        throw new Error('视觉服务中断');
      });

      await collect(
        service.analyze('u1', {
          image_urls: ['/uploads/a.png'],
          question: '别丢了我的提问',
          conversation_id: 'c1',
        }),
      );
      // 只写入用户消息，AI 消息因失败未写
      expect(deps.prisma.message.create).toHaveBeenCalledTimes(1);
      expect(deps.prisma.message.create.mock.calls[0][0].data.role).toBe('user');
    });
  });

  // ---------------- 图 → 文案 ----------------

  describe('caption · 图生文案', () => {
    const base = { image_urls: ['/uploads/a.png'] };

    it('免费版无权益，抛 forbidden', async () => {
      const { service } = setup('free');
      await expect(collect(service.caption('u1', base))).rejects.toMatchObject({
        code: 'forbidden',
      });
    });

    it('未提供图片抛 invalid_request', async () => {
      const { service } = setup('plus');
      await expect(collect(service.caption('u1', { image_urls: [] }))).rejects.toMatchObject({
        code: 'invalid_request',
      });
    });

    it('参考图不属于当前用户时拒绝，且不建创作记录', async () => {
      const { service, deps } = setup('plus');
      deps.prisma.mediaAsset.findMany.mockResolvedValueOnce([]);

      await expect(
        collect(service.caption('u1', { image_urls: ['/uploads/someone-else.png'] })),
      ).rejects.toMatchObject({
        code: 'invalid_request',
        details: { invalid_urls: ['/uploads/someone-else.png'] },
      });

      expect(deps.prisma.creation.create).not.toHaveBeenCalled();
      expect(deps.imageAi.analyzeStream).not.toHaveBeenCalled();
    });

    it('多张参考图中只要有一张越权就整体拒绝', async () => {
      const { service, deps } = setup('plus');
      deps.prisma.mediaAsset.findMany.mockResolvedValueOnce([{ url: '/uploads/mine.png' }]);

      await expect(
        collect(
          service.caption('u1', { image_urls: ['/uploads/mine.png', '/uploads/others.png'] }),
        ),
      ).rejects.toMatchObject({
        code: 'invalid_request',
        details: { invalid_urls: ['/uploads/others.png'] },
      });
    });

    it('SSE 事件复用创作契约，并回传 creation_id', async () => {
      const { service } = setup('plus');
      const events = await collect(service.caption('u1', base));
      expect(eventsOf(events)[0]).toBe('message.start');
      expect(eventsOf(events)[events.length - 1]).toBe('message.done');
      expect(data(events[0]).creation_id).toBeDefined();
      expect(data(events[events.length - 1]).creation_id).toBeDefined();
    });

    it('落库为 Creation，便于在「我的创作」中回看', async () => {
      const { service, deps } = setup('plus');
      await collect(
        service.caption('u1', {
          ...base,
          purpose: 'marketing',
          tone: 'professional',
          brief: '主打保温 12 小时',
        }),
      );

      const created = deps.prisma.creation.create.mock.calls[0][0].data;
      expect(created).toMatchObject({ userId: 'u1', templateId: 'image-caption' });
      expect(created.templateName).toContain('营销推广');
      expect(created.inputs).toMatchObject({
        purpose: 'marketing',
        tone: 'professional',
        brief: '主打保温 12 小时',
        image_urls: ['/uploads/a.png'],
      });
      // 生成结束后回填输出与成本
      const updated = deps.prisma.creation.update.mock.calls[0][0].data;
      expect(updated.output.length).toBeGreaterThan(0);
      expect(updated.cost).toBeGreaterThan(0);
    });

    it('用途与语气会写入 systemPrompt 约束体裁', async () => {
      const { service, deps } = setup('plus');
      await collect(service.caption('u1', { ...base, purpose: 'alt_text', tone: 'professional' }));

      const arg = deps.imageAi.analyzeStream.mock.calls[0][0];
      expect(arg.systemPrompt).toContain('无障碍');
      expect(arg.systemPrompt).toContain('专业严谨');
      // 图片需转为绝对地址供上游模型访问
      expect(arg.imageUrls).toEqual(['https://cdn.test/uploads/a.png']);
    });

    it('未指定时使用默认用途与语气', async () => {
      const { service, deps } = setup('plus');
      const events = await collect(service.caption('u1', base));
      expect(data(events[0])).toMatchObject({ purpose: 'xiaohongshu', tone: 'friendly' });
      expect(deps.imageAi.analyzeStream.mock.calls[0][0].systemPrompt).toContain('小红书');
    });

    it('补充要求命中审核则拦截，不调用模型', async () => {
      const { service, deps } = setup('plus');
      deps.moderation.check.mockResolvedValue({
        action: 'block',
        flagged: true,
        categories: ['hate'],
      });

      const events = await collect(service.caption('u1', { ...base, brief: '违规要求' }));
      expect(eventsOf(events)).toEqual(['error']);
      expect(data(events[0]).code).toBe('content_flagged');
      expect(deps.imageAi.analyzeStream).not.toHaveBeenCalled();
    });

    it('按 feature=vision 计量', async () => {
      const { service, deps } = setup('plus');
      await collect(service.caption('u1', base));
      expect(deps.usage.record.mock.calls[0][0].feature).toBe('vision');
    });

    it('模型异常时下发 upstream_error', async () => {
      const { service, deps } = setup('plus');
      deps.imageAi.analyzeStream.mockImplementation(async function* () {
        throw new Error('视觉服务中断');
      });
      const events = await collect(service.caption('u1', base));
      expect(data(events[events.length - 1]).code).toBe('upstream_error');
    });
  });

  describe('captionOptions', () => {
    it('返回用途 / 语气目录与权益标记', async () => {
      const { service } = setup('plus');
      const res = await service.captionOptions('u1');
      expect(res.purposes.length).toBeGreaterThan(0);
      expect(res.tones.length).toBeGreaterThan(0);
      expect(res.defaults.purpose).toBe('xiaohongshu');
      expect(res.limits.vision).toBe(true);
      expect(res.limits.max_images).toBeGreaterThan(0);
    });

    it('免费版标记 vision=false（前端据此显示升级引导）', async () => {
      const { service } = setup('free');
      expect((await service.captionOptions('u1')).limits.vision).toBe(false);
    });
  });

  // ---------------- 生图输出审核闭环 ----------------

  describe('generate · 输出审核落 flagged', () => {
    it('模型改写后的 prompt 命中审核时标记 flagged', async () => {
      const { service, deps } = setup('plus');
      deps.imageAi.generate.mockResolvedValue([
        { b64: 'A', mimeType: 'image/svg+xml', revisedPrompt: '被改写的违规描述' },
      ]);
      deps.moderation.check.mockImplementation((_t: string, kind: string) =>
        Promise.resolve(
          kind === 'output'
            ? { action: 'block', flagged: true, categories: ['sexual'] }
            : { action: 'allow', flagged: false, categories: [] },
        ),
      );

      await collect(service.generate('u1', { prompt: '正常描述' }));
      expect(deps.prisma.mediaAsset.create.mock.calls[0][0].data.flagged).toBe(true);
    });

    it('正常内容 flagged 为 false', async () => {
      const { service, deps } = setup('plus');
      await collect(service.generate('u1', { prompt: '正常描述' }));
      expect(deps.prisma.mediaAsset.create.mock.calls[0][0].data.flagged).toBe(false);
    });
  });

  describe('generate · 额度响应头数据', () => {
    it('start 事件携带扣减后的剩余张数（供 X-Quota-Remaining）', async () => {
      const { service } = setup('plus', 10);
      const events = await collect(service.generate('u1', { prompt: 'x', n: 2 }));
      const expected = PLAN_IMAGE_LIMITS.plus.monthlyImages - 10 - 2;
      expect(data(events[0]).remaining_images).toBe(expected);
    });

    it('不限量套餐以 -1 表示（控制器转为 unlimited）', async () => {
      const { service } = setup('enterprise', 100);
      const events = await collect(service.generate('u1', { prompt: 'x' }));
      expect(data(events[0]).remaining_images).toBe(-1);
    });
  });
});
