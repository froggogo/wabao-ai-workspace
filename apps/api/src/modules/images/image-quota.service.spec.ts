import { PLAN_IMAGE_LIMITS } from '@wabao/shared';
import { ImageQuotaService } from './image-quota.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AppException } from '../../common/errors';

type PrismaMock = {
  user: { findUnique: jest.Mock };
  mediaAsset: { count: jest.Mock };
};

function make(plan = 'free', used = 0) {
  const prisma: PrismaMock = {
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', plan }) },
    mediaAsset: { count: jest.fn().mockResolvedValue(used) },
  };
  const service = new ImageQuotaService(prisma as unknown as PrismaService);
  return { prisma, service };
}

describe('ImageQuotaService（P2 图像配额）', () => {
  describe('info', () => {
    it('返回套餐对应的额度与余量', async () => {
      const { service } = make('free', 5);
      const info = await service.info('u1');
      expect(info.plan).toBe('free');
      expect(info.quota).toBe(PLAN_IMAGE_LIMITS.free.monthlyImages);
      expect(info.used).toBe(5);
      expect(info.remaining).toBe(PLAN_IMAGE_LIMITS.free.monthlyImages - 5);
      expect(info.limits.vision).toBe(false);
    });

    it('用尽额度时余量为 0，且不出现负数', async () => {
      const over = PLAN_IMAGE_LIMITS.free.monthlyImages + 10;
      const { service } = make('free', over);
      const info = await service.info('u1');
      expect(info.remaining).toBe(0);
    });

    it('企业版（quota=0）视为不限量', async () => {
      const { service } = make('enterprise', 99999);
      const info = await service.info('u1');
      expect(info.quota).toBe(0);
      expect(info.remaining).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('Plus 套餐可用 Vision 与批量出图', async () => {
      const { service } = make('plus', 0);
      const info = await service.info('u1');
      expect(info.limits.vision).toBe(true);
      expect(info.limits.maxBatch).toBeGreaterThan(1);
    });

    it('用户不存在时抛 not_found', async () => {
      const { prisma, service } = make();
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.info('missing')).rejects.toBeInstanceOf(AppException);
      await expect(service.info('missing')).rejects.toMatchObject({ code: 'not_found' });
    });
  });

  describe('monthlyGeneratedCount', () => {
    it('只统计当月的生成与变体，不含用户上传', async () => {
      const { prisma, service } = make('free', 7);
      const at = new Date('2026-07-15T08:00:00Z');
      const count = await service.monthlyGeneratedCount('u1', at);

      expect(count).toBe(7);
      const where = prisma.mediaAsset.count.mock.calls[0][0].where;
      expect(where.userId).toBe('u1');
      expect(where.source).toEqual({ in: ['generation', 'variation'] });
      // 时间窗必须是「当月 1 日 ~ 次月 1 日」的 UTC 区间
      expect(where.createdAt.gte.toISOString()).toBe('2026-07-01T00:00:00.000Z');
      expect(where.createdAt.lt.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    });

    it('跨年月份的时间窗正确（12 月 → 次年 1 月）', async () => {
      const { prisma, service } = make('free', 0);
      await service.monthlyGeneratedCount('u1', new Date('2026-12-20T00:00:00Z'));
      const where = prisma.mediaAsset.count.mock.calls[0][0].where;
      expect(where.createdAt.gte.toISOString()).toBe('2026-12-01T00:00:00.000Z');
      expect(where.createdAt.lt.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    });
  });

  describe('assertQuota', () => {
    it('额度充足时通过并返回配额信息', async () => {
      const { service } = make('free', 5);
      const info = await service.assertQuota('u1', 1);
      expect(info.used).toBe(5);
    });

    it('刚好用满额度时允许通过（边界值）', async () => {
      const quota = PLAN_IMAGE_LIMITS.free.monthlyImages;
      const { service } = make('free', quota - 1);
      await expect(service.assertQuota('u1', 1)).resolves.toBeDefined();
    });

    it('超出额度抛 rate_limited 并携带配额详情', async () => {
      const quota = PLAN_IMAGE_LIMITS.free.monthlyImages;
      const { service } = make('free', quota);
      await expect(service.assertQuota('u1', 1)).rejects.toMatchObject({
        code: 'rate_limited',
        details: { quota: { quota, used: quota, remaining: 0 } },
      });
    });

    it('批量请求会整体校验（剩余 1 张时请求 3 张应被拒绝）', async () => {
      const quota = PLAN_IMAGE_LIMITS.plus.monthlyImages;
      const { service } = make('plus', quota - 1);
      await expect(service.assertQuota('u1', 3)).rejects.toMatchObject({
        code: 'rate_limited',
      });
    });

    it('企业版不限量，任意张数均通过', async () => {
      const { service } = make('enterprise', 1_000_000);
      await expect(service.assertQuota('u1', 4)).resolves.toBeDefined();
    });
  });

  describe('planOf', () => {
    it('返回用户套餐', async () => {
      const { prisma, service } = make();
      prisma.user.findUnique.mockResolvedValue({ plan: 'pro' });
      expect(await service.planOf('u1')).toBe('pro');
    });

    it('用户不存在时回退为 free（安全默认）', async () => {
      const { prisma, service } = make();
      prisma.user.findUnique.mockResolvedValue(null);
      expect(await service.planOf('missing')).toBe('free');
    });
  });
});
