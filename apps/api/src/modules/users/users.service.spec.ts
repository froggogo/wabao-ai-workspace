import { Prisma } from '@prisma/client';
import { PLAN_IMAGE_LIMITS } from '@wabao/shared';
import { UsersService } from './users.service';
import { PrismaService } from '../../prisma/prisma.service';

type PrismaMock = {
  user: { findUnique: jest.Mock };
  usageRecord: { groupBy: jest.Mock };
  mediaAsset: { count: jest.Mock };
};

function setup(plan = 'plus', usedImages = 0) {
  const prisma: PrismaMock = {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'u1',
        email: 'a@b.c',
        name: '蛙宝',
        plan,
        quotaTokens: 2_000_000,
      }),
    },
    usageRecord: { groupBy: jest.fn().mockResolvedValue([]) },
    mediaAsset: { count: jest.fn().mockResolvedValue(usedImages) },
  };
  return { prisma, service: new UsersService(prisma as unknown as PrismaService) };
}

/**
 * groupBy 返回值构造器。
 * cost 列是 numeric，Prisma 会返回 Decimal 而非 number，这里如实模拟，
 * 否则测试会漏掉「Decimal 未转换就参与算术」这类问题。
 */
const row = (feature: string, input: number, output: number, calls: number, cost = 1) => ({
  feature,
  _sum: { inputTokens: input, outputTokens: output, cost: new Prisma.Decimal(cost) },
  _count: { _all: calls },
});

describe('UsersService.usage（用量聚合，含 P2 图像维度）', () => {
  it('汇总 token 用量并计算剩余额度', async () => {
    const { service, prisma } = setup('plus');
    prisma.usageRecord.groupBy.mockResolvedValue([
      row('chat', 40_000, 25_000, 120),
      row('studio', 10_000, 7_000, 30),
    ]);

    const res = await service.usage('u1');
    expect(res.used_tokens).toBe(82_000);
    expect(res.remaining_tokens).toBe(2_000_000 - 82_000);
    expect(res.plan).toBe('plus');
  });

  // cost 在库中是 numeric，Prisma 返回 Decimal 对象，而 Decimal 的 JSON 形态是字符串。
  // 若直接透传，接口里的 cost 会从数字变成字符串，前端计算随之出错。
  it('cost 以数字输出，不泄漏 Decimal 类型', async () => {
    const { service, prisma } = setup('plus');
    prisma.usageRecord.groupBy.mockResolvedValue([row('chat', 100, 100, 2, 12.3456)]);

    const res = await service.usage('u1');
    const cost = res.breakdown[0].cost;

    expect(typeof cost).toBe('number');
    expect(cost).toBe(12.35);
    // 序列化后仍应是数字字面量，而非带引号的字符串
    expect(JSON.stringify({ cost })).toBe('{"cost":12.35}');
  });

  it('breakdown 覆盖 P2 新增的 image / vision 并带中文标签', async () => {
    const { service, prisma } = setup('plus');
    prisma.usageRecord.groupBy.mockResolvedValue([
      row('chat', 100, 100, 2),
      row('studio', 100, 100, 2),
      row('image', 0, 0, 126),
      row('vision', 8_000, 1_600, 8),
    ]);

    const res = await service.usage('u1');
    const labels = Object.fromEntries(res.breakdown.map((b) => [b.feature, b.label]));
    expect(labels).toMatchObject({
      chat: '对话',
      studio: '创作',
      image: 'AI 绘图',
      vision: '看图问答',
    });
    // 绘图不消耗 token，但调用次数需体现
    expect(res.breakdown.find((b) => b.feature === 'image')).toMatchObject({
      tokens: 0,
      calls: 126,
    });
  });

  it('返回图像张数额度（与 Token 额度并列）', async () => {
    const { service } = setup('plus', 126);
    const res = await service.usage('u1');
    expect(res.images).toEqual({
      quota: PLAN_IMAGE_LIMITS.plus.monthlyImages,
      used: 126,
      remaining: PLAN_IMAGE_LIMITS.plus.monthlyImages - 126,
      vision: true,
    });
  });

  it('免费版图像额度小且无 Vision 权益', async () => {
    const { service } = setup('free', 5);
    const res = await service.usage('u1');
    expect(res.images.quota).toBe(PLAN_IMAGE_LIMITS.free.monthlyImages);
    expect(res.images.vision).toBe(false);
  });

  it('企业版不限量时 remaining 为 null', async () => {
    const { service } = setup('enterprise', 9999);
    const res = await service.usage('u1');
    expect(res.images.quota).toBe(0);
    expect(res.images.remaining).toBeNull();
  });

  it('图像统计只计当月的生成与变体，排除用户上传', async () => {
    const { service, prisma } = setup('plus', 3);
    await service.usage('u1', '2026-07');

    const where = prisma.mediaAsset.count.mock.calls[0][0].where;
    expect(where.source).toEqual({ in: ['generation', 'variation'] });
    expect(where.createdAt.gte.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(where.createdAt.lt.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('period 参数决定统计区间与返回标签', async () => {
    const { service } = setup('plus');
    const res = await service.usage('u1', '2026-03');
    expect(res.period).toBe('2026-03');
  });

  it('非法 period 回退为当前月份', async () => {
    const { service } = setup('plus');
    const res = await service.usage('u1', 'not-a-period');
    expect(res.period).toMatch(/^\d{4}-\d{2}$/);
  });

  it('用户不存在抛 not_found', async () => {
    const { service, prisma } = setup('plus');
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.usage('missing')).rejects.toMatchObject({ code: 'not_found' });
  });
});
