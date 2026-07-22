import { ConfigService } from '@nestjs/config';
import { ModerationService } from './moderation.service';
import { PrismaService } from '../../prisma/prisma.service';

function makeConfig(values: Record<string, string | undefined>): ConfigService {
  return { get: (k: string) => values[k] } as unknown as ConfigService;
}

describe('ModerationService (本地关键词回退)', () => {
  let prisma: { moderationRecord: { create: jest.Mock } };
  let service: ModerationService;

  beforeEach(() => {
    prisma = { moderationRecord: { create: jest.fn().mockResolvedValue({}) } };
    service = new ModerationService(makeConfig({}), prisma as unknown as PrismaService);
  });

  it('命中关键词则拦截（block）', async () => {
    const res = await service.check('这是包含暴力的内容', 'input', { userId: 'u1' });
    expect(res.flagged).toBe(true);
    expect(res.action).toBe('block');
    expect(res.categories).toContain('暴力');
  });

  it('正常内容放行（warn）', async () => {
    const res = await service.check('今天天气不错', 'output');
    expect(res.flagged).toBe(false);
    expect(res.action).toBe('warn');
  });

  it('每次检查都会写审计记录 ModerationRecord', async () => {
    await service.check('普通文本', 'input', { userId: 'u1', refId: 'm1' });
    expect(prisma.moderationRecord.create).toHaveBeenCalledTimes(1);
  });
});
