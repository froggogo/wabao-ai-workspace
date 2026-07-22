import { UsageService } from './usage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { estimateCost } from '../../ai/models';

describe('UsageService', () => {
  let prisma: { usageRecord: { create: jest.Mock } };
  let service: UsageService;

  beforeEach(() => {
    prisma = { usageRecord: { create: jest.fn().mockResolvedValue({}) } };
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
});
