import { PLAN_IMAGE_LIMITS, quotaForPlan, PlanId } from '@wabao/shared';
import { QuotaKind, Subscription } from '@prisma/client';
import { ImageQuotaService } from './image-quota.service';
import { PrismaService } from '../../prisma/prisma.service';
import { QuotaService } from '../../common/quota.service';
import { SubscriptionService } from '../billing/subscription.service';
import { AppException } from '../../common/errors';

type PrismaMock = {
  user: { findUnique: jest.Mock };
  mediaAsset: { count: jest.Mock };
};

const PERIOD_START = new Date('2026-08-04T00:00:00.000Z');
const PERIOD_END = new Date('2026-09-03T00:00:00.000Z');

/**
 * QuotaService 的内存实现，复刻真实 SQL 的语义：
 * 条件自增，超出上限则整体失败。用真实语义而非纯 mock，才能验证配额判断本身。
 * period 计入 key，可验证周期切换后额度确实重置。
 */
function fakeQuota() {
  const store = new Map<string, number>();
  const key = (userId: string, period: string, kind: QuotaKind) => `${userId}:${period}:${kind}`;

  return {
    store,
    used: jest.fn(
      async (userId: string, period: string, kind: QuotaKind) =>
        store.get(key(userId, period, kind)) ?? null,
    ),
    reserve: jest.fn(
      async (p: {
        userId: string;
        period: string;
        kind: QuotaKind;
        amount: number;
        quota: number;
        backfill?: number;
      }) => {
        const k = key(p.userId, p.period, p.kind);
        const current = store.get(k) ?? p.backfill ?? 0;
        if (p.quota > 0 && current + p.amount > p.quota) return false;
        store.set(k, current + p.amount);
        return true;
      },
    ),
    release: jest.fn(
      async (userId: string, period: string, kind: QuotaKind, amount: number) => {
        const k = key(userId, period, kind);
        store.set(k, Math.max(0, (store.get(k) ?? 0) - amount));
      },
    ),
    settle: jest.fn(async (userId: string, period: string, kind: QuotaKind, delta: number) => {
      const k = key(userId, period, kind);
      store.set(k, Math.max(0, (store.get(k) ?? 0) + delta));
    }),
  };
}

/** 构造一条处于当前周期内的订阅 */
function subscriptionOf(plan: string, start = PERIOD_START, end = PERIOD_END): Subscription {
  const id = plan as PlanId;
  return {
    id: 'sub_1',
    userId: 'u1',
    plan,
    cycle: 'monthly',
    status: 'active',
    currentPeriodStart: start,
    currentPeriodEnd: end,
    expiresAt: null,
    quotaTokens: quotaForPlan(id),
    monthlyImages: PLAN_IMAGE_LIMITS[id].monthlyImages,
    pendingPlan: null,
    canceledAt: null,
    createdAt: start,
    updatedAt: start,
  } as unknown as Subscription;
}

function make(plan = 'free', used = 0) {
  const prisma: PrismaMock = {
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', plan }) },
    mediaAsset: { count: jest.fn().mockResolvedValue(used) },
  };
  const quota = fakeQuota();
  const sub = subscriptionOf(plan);
  const subscriptions = {
    current: jest.fn().mockResolvedValue(sub),
    periodKey: (s: Subscription) => s.currentPeriodStart.toISOString(),
  };
  const service = new ImageQuotaService(
    prisma as unknown as PrismaService,
    quota as unknown as QuotaService,
    subscriptions as unknown as SubscriptionService,
  );
  return { prisma, service, quota, subscriptions, sub };
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

    // 额度与套餐一律取自订阅快照，不再读 users 的冗余列：
    // 后者在周期滚动或降级时可能短暂落后于订阅
    it('额度取自订阅快照而非 users 表', async () => {
      const { service, prisma, sub } = make('plus');
      // 把订阅快照改成与套餐目录不同的值，模拟「下单时锁定的旧价格」
      sub.monthlyImages = 999;

      const info = await service.info('u1');

      expect(info.quota).toBe(999);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('generatedCountBetween', () => {
    it('只统计区间内的生成与变体，不含用户上传', async () => {
      const { prisma, service } = make('free', 7);
      const count = await service.generatedCountBetween('u1', PERIOD_START, PERIOD_END);

      expect(count).toBe(7);
      const where = prisma.mediaAsset.count.mock.calls[0][0].where;
      expect(where.userId).toBe('u1');
      expect(where.source).toEqual({ in: ['generation', 'variation'] });
      expect(where.createdAt).toEqual({ gte: PERIOD_START, lt: PERIOD_END });
    });

    // 计量口径已从自然月改为订阅周期：月中升级的用户不应把升级前的消耗算进新额度
    it('计数器为空时，info 用订阅周期而非自然月作为回退区间', async () => {
      const { prisma, service } = make('free', 3);

      await service.info('u1');

      const where = prisma.mediaAsset.count.mock.calls[0][0].where;
      expect(where.createdAt.gte).toEqual(PERIOD_START);
      expect(where.createdAt.lt).toEqual(PERIOD_END);
    });
  });

  describe('周期切换', () => {
    it('进入新周期后额度重新计算，旧周期的占用不再计入', async () => {
      const { service, quota, sub } = make('free');
      const limit = PLAN_IMAGE_LIMITS.free.monthlyImages;

      // 当前周期用满
      await service.reserve('u1', limit);
      await expect(service.reserve('u1', 1)).rejects.toMatchObject({ code: 'rate_limited' });

      // 订阅滚动到下一周期
      sub.currentPeriodStart = PERIOD_END;
      sub.currentPeriodEnd = new Date(PERIOD_END.getTime() + 30 * 86400000);

      await expect(service.reserve('u1', 1)).resolves.toBeDefined();
      // 旧周期的计数保持不变，仅新周期从头计起
      expect(quota.store.get(`u1:${PERIOD_START.toISOString()}:images`)).toBe(limit);
      expect(quota.store.get(`u1:${PERIOD_END.toISOString()}:images`)).toBe(1);
    });
  });

  describe('reserve', () => {
    it('额度充足时通过并返回配额信息', async () => {
      const { service } = make('free', 5);
      const info = await service.reserve('u1', 1);
      expect(info.used).toBe(5);
    });

    it('刚好用满额度时允许通过（边界值）', async () => {
      const quota = PLAN_IMAGE_LIMITS.free.monthlyImages;
      const { service } = make('free', quota - 1);
      await expect(service.reserve('u1', 1)).resolves.toBeDefined();
    });

    it('超出额度抛 rate_limited 并携带配额详情', async () => {
      const quota = PLAN_IMAGE_LIMITS.free.monthlyImages;
      const { service } = make('free', quota);
      await expect(service.reserve('u1', 1)).rejects.toMatchObject({
        code: 'rate_limited',
        details: { quota: { quota, used: quota, remaining: 0 } },
      });
    });

    it('批量请求会整体校验（剩余 1 张时请求 3 张应被拒绝）', async () => {
      const quota = PLAN_IMAGE_LIMITS.plus.monthlyImages;
      const { service } = make('plus', quota - 1);
      await expect(service.reserve('u1', 3)).rejects.toMatchObject({
        code: 'rate_limited',
      });
    });

    it('企业版不限量，任意张数均通过', async () => {
      const { service } = make('enterprise', 1_000_000);
      await expect(service.reserve('u1', 4)).resolves.toBeDefined();
    });

    it('额度被逐次占用，用满后拒绝后续请求', async () => {
      const quota = PLAN_IMAGE_LIMITS.free.monthlyImages;
      const { service } = make('free', quota - 2);
      await expect(service.reserve('u1', 1)).resolves.toBeDefined();
      await expect(service.reserve('u1', 1)).resolves.toBeDefined();
      // 前两次已把余量占满，第三次必须失败
      await expect(service.reserve('u1', 1)).rejects.toMatchObject({ code: 'rate_limited' });
    });

    it('并发请求不会超发：剩余 2 张时 5 个并发只有 2 个成功', async () => {
      const quota = PLAN_IMAGE_LIMITS.free.monthlyImages;
      const { service, quota: counter } = make('free', quota - 2);

      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => service.reserve('u1', 1)),
      );
      const granted = results.filter((r) => r.status === 'fulfilled').length;

      expect(granted).toBe(2);
      expect(counter.store.get(`u1:${PERIOD_START.toISOString()}:images`)).toBe(quota);
    });

    it('归还预留后额度可再次使用', async () => {
      const quota = PLAN_IMAGE_LIMITS.free.monthlyImages;
      const { service } = make('free', quota - 1);
      await service.reserve('u1', 1);
      await expect(service.reserve('u1', 1)).rejects.toMatchObject({ code: 'rate_limited' });

      await service.release('u1', 1);
      await expect(service.reserve('u1', 1)).resolves.toBeDefined();
    });
  });

  describe('planOf', () => {
    it('返回订阅上的套餐', async () => {
      const { service } = make('pro');
      expect(await service.planOf('u1')).toBe('pro');
    });

    // SubscriptionService.current 对无订阅用户会补开免费版，因此这里恒有值
    it('无订阅时由订阅服务兜底为 free', async () => {
      const { service } = make('free');
      expect(await service.planOf('u1')).toBe('free');
    });
  });
});
