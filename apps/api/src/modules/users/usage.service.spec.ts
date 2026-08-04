import { Prisma, Subscription } from '@prisma/client';
import { UsageService } from './usage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { QuotaService } from '../../common/quota.service';
import { SubscriptionService } from '../billing/subscription.service';
import { estimateCost } from '../../ai/models';

const PERIOD_START = new Date('2026-08-04T00:00:00.000Z');
const PERIOD_END = new Date('2026-09-03T00:00:00.000Z');
const PERIOD_KEY = PERIOD_START.toISOString();

describe('UsageService', () => {
  let prisma: {
    usageRecord: { create: jest.Mock; aggregate: jest.Mock; findUnique: jest.Mock };
    user: { findUnique: jest.Mock };
  };
  let quota: { used: jest.Mock; reserve: jest.Mock; settle: jest.Mock; release: jest.Mock };
  let sub: Subscription;
  let subscriptions: { current: jest.Mock; periodKey: (s: Subscription) => string };
  let service: UsageService;

  beforeEach(() => {
    prisma = {
      usageRecord: {
        create: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue(null),
        aggregate: jest
          .fn()
          .mockResolvedValue({ _sum: { inputTokens: 0, outputTokens: 0 } }),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ quotaTokens: 1000 }) },
    };
    quota = {
      // 计数器默认为空，使既有用例继续覆盖「回落到流水聚合」的路径
      used: jest.fn().mockResolvedValue(null),
      reserve: jest.fn().mockResolvedValue(true),
      settle: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
    };
    sub = {
      id: 'sub_1',
      userId: 'u1',
      plan: 'plus',
      quotaTokens: 1000,
      monthlyImages: 500,
      currentPeriodStart: PERIOD_START,
      currentPeriodEnd: PERIOD_END,
    } as unknown as Subscription;
    subscriptions = {
      current: jest.fn().mockResolvedValue(sub),
      periodKey: (s: Subscription) => s.currentPeriodStart.toISOString(),
    };
    service = new UsageService(
      prisma as unknown as PrismaService,
      quota as unknown as QuotaService,
      subscriptions as unknown as SubscriptionService,
    );
  });

  it('记录用量并返回与估算一致的成本', async () => {
    const cost = await service.record({
      userId: 'u1',
      feature: 'chat',
      model: 'gpt-5.6-terra',
      inputTokens: 100,
      outputTokens: 200,
      messageId: 'm1',
      idempotencyKey: 'chat:m1',
    });
    expect(cost).toBe(estimateCost('gpt-5.6-terra', 100, 200));
    expect(prisma.usageRecord.create).toHaveBeenCalledTimes(1);
    const arg = prisma.usageRecord.create.mock.calls[0][0];
    expect(arg.data.feature).toBe('chat');
    expect(arg.data.cost).toBe(cost);
    expect(arg.data.messageId).toBe('m1');
    expect(arg.data.idempotencyKey).toBe('chat:m1');
  });

  it('幂等键冲突时返回已有成本且不再抛错', async () => {
    const dup = Object.assign(new Prisma.PrismaClientKnownRequestError('Unique', {
      code: 'P2002',
      clientVersion: 'test',
    }), {});
    prisma.usageRecord.create.mockRejectedValueOnce(dup);
    prisma.usageRecord.findUnique.mockResolvedValueOnce({
      cost: new Prisma.Decimal(0.42),
    });

    const cost = await service.record({
      userId: 'u1',
      feature: 'chat',
      model: 'gpt-5.6-terra',
      inputTokens: 1,
      outputTokens: 1,
      idempotencyKey: 'chat:m1',
    });
    expect(cost).toBe(0.42);
    expect(prisma.usageRecord.findUnique).toHaveBeenCalledWith({
      where: { idempotencyKey: 'chat:m1' },
    });
  });

  it('支持显式 cost 覆盖（图像按张计价）', async () => {
    const cost = await service.record({
      userId: 'u1',
      feature: 'image',
      model: 'gpt-image-2-mini',
      inputTokens: 0,
      outputTokens: 0,
      cost: 0.04,
      mediaAssetId: 'a1',
      idempotencyKey: 'image:a1',
    });
    expect(cost).toBe(0.04);
    expect(prisma.usageRecord.create.mock.calls[0][0].data.cost).toBe(0.04);
  });

  // P2：新增 image / vision 两个计量维度
  it('支持 P2 新增的 image 与 vision 计量维度', async () => {
    for (const feature of ['image', 'vision'] as const) {
      await service.record({
        userId: 'u1',
        feature,
        model: 'gpt-5.6-terra',
        inputTokens: 10,
        outputTokens: 0,
      });
    }
    const features = prisma.usageRecord.create.mock.calls.map((c) => c[0].data.feature);
    expect(features).toEqual(['image', 'vision']);
  });

  it('图像计量以 0 token 记录时成本为 0（成本另按张数计价）', async () => {
    const cost = await service.record({
      userId: 'u1',
      feature: 'image',
      model: 'gpt-5.6-terra',
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(cost).toBe(0);
  });

  describe('assertQuota', () => {
    it('未超额时通过', async () => {
      prisma.usageRecord.aggregate.mockResolvedValue({
        _sum: { inputTokens: 100, outputTokens: 100 },
      });
      await expect(service.assertQuota('u1')).resolves.toMatchObject({ used: 200 });
    });

    it('用尽配额抛 rate_limited 并携带配额详情', async () => {
      prisma.usageRecord.aggregate.mockResolvedValue({
        _sum: { inputTokens: 600, outputTokens: 600 },
      });
      await expect(service.assertQuota('u1')).rejects.toMatchObject({
        code: 'rate_limited',
        details: { quota: { quota: 1000, used: 1200, remaining: 0 } },
      });
    });

    it('quota=0 视为不限量', async () => {
      sub.quotaTokens = 0;
      prisma.usageRecord.aggregate.mockResolvedValue({
        _sum: { inputTokens: 99999, outputTokens: 0 },
      });
      await expect(service.assertQuota('u1')).resolves.toBeDefined();
    });

    // 计量口径为订阅周期而非自然月，回退聚合的区间必须取自订阅
    it('计数器为空时按订阅周期区间聚合流水', async () => {
      await service.quotaInfo('u1');
      const where = prisma.usageRecord.aggregate.mock.calls[0][0].where;
      expect(where.createdAt).toEqual({ gte: PERIOD_START, lt: PERIOD_END });
    });

    it('额度取自订阅快照而非 users 表', async () => {
      sub.quotaTokens = 12345;
      await expect(service.quotaInfo('u1')).resolves.toMatchObject({ quota: 12345 });
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('计数器已建立时以计数器为准，不再聚合流水', async () => {
      quota.used.mockResolvedValue(777);
      await expect(service.quotaInfo('u1')).resolves.toMatchObject({
        used: 777,
        remaining: 223,
      });
      expect(prisma.usageRecord.aggregate).not.toHaveBeenCalled();
    });
  });

  describe('预留与结算', () => {
    it('预留成功时带上配额与回填值', async () => {
      prisma.usageRecord.aggregate.mockResolvedValue({
        _sum: { inputTokens: 300, outputTokens: 0 },
      });
      await service.reserveTokens('u1', 500);
      expect(quota.reserve).toHaveBeenCalledWith({
        userId: 'u1',
        period: PERIOD_KEY,
        kind: 'tokens',
        amount: 500,
        quota: 1000,
        backfill: 300,
      });
    });

    it('预留失败抛 rate_limited', async () => {
      quota.reserve.mockResolvedValue(false);
      await expect(service.reserveTokens('u1', 5000)).rejects.toMatchObject({
        code: 'rate_limited',
      });
    });

    it('结算按「实际 - 预留」修正，实际更少时归还差额', async () => {
      await service.settleTokens('u1', 2100, 350);
      expect(quota.settle).toHaveBeenCalledWith('u1', PERIOD_KEY, 'tokens', -1750);
    });

    it('实际超出预留时补记差额', async () => {
      await service.settleTokens('u1', 2100, 2600);
      expect(quota.settle).toHaveBeenCalledWith('u1', PERIOD_KEY, 'tokens', 500);
    });
  });
});
