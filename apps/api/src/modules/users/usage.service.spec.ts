import { UsageService } from './usage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { estimateCost } from '../../ai/models';

describe('UsageService', () => {
  let prisma: {
    usageRecord: { create: jest.Mock; aggregate: jest.Mock };
    user: { findUnique: jest.Mock };
  };
  let service: UsageService;

  beforeEach(() => {
    prisma = {
      usageRecord: {
        create: jest.fn().mockResolvedValue({}),
        aggregate: jest
          .fn()
          .mockResolvedValue({ _sum: { inputTokens: 0, outputTokens: 0 } }),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ quotaTokens: 1000 }) },
    };
    service = new UsageService(prisma as unknown as PrismaService);
  });

  it('记录用量并返回与估算一致的成本', async () => {
    const cost = await service.record({
      userId: 'u1',
      feature: 'chat',
      model: 'gpt-5.6-terra',
      inputTokens: 100,
      outputTokens: 200,
    });
    expect(cost).toBe(estimateCost('gpt-5.6-terra', 100, 200));
    expect(prisma.usageRecord.create).toHaveBeenCalledTimes(1);
    const arg = prisma.usageRecord.create.mock.calls[0][0];
    expect(arg.data.feature).toBe('chat');
    expect(arg.data.cost).toBe(cost);
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
      prisma.user.findUnique.mockResolvedValue({ quotaTokens: 0 });
      prisma.usageRecord.aggregate.mockResolvedValue({
        _sum: { inputTokens: 99999, outputTokens: 0 },
      });
      await expect(service.assertQuota('u1')).resolves.toBeDefined();
    });
  });
});
