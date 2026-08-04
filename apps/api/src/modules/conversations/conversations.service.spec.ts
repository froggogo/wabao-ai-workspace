import { ConversationsService } from './conversations.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../../ai/ai.service';
import { RouterService } from '../../ai/router.service';
import { PromptService, ChatTurn } from '../../ai/prompt.service';
import { ModerationService } from '../moderation/moderation.service';
import { UsageService } from '../users/usage.service';
import { BillingService } from '../billing/billing.service';
import { AbortRegistry } from '../../common/abort-registry.service';
import type { SseEvent } from '../../common/sse';

const CONVERSATION_ID = 'conv_1';
const USER_ID = 'u1';

interface Row {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  seq: number;
  createdAt: Date;
  parentId: string | null;
}

/**
 * 构造一条会话消息。第 4 个参数是 seq（会话内顺序）。
 * 所有消息共用同一个 createdAt，以此保证测试只能依赖 seq 排序——
 * 若实现回退到按时间排序，顺序相关的断言会立刻失败。
 */
function row(
  id: string,
  role: 'user' | 'assistant',
  content: string,
  seq: number,
  parentId: string | null = null,
): Row {
  return {
    id,
    role,
    content,
    seq,
    createdAt: new Date(Date.UTC(2026, 7, 4, 10, 0, 0, 0)),
    parentId,
  };
}

async function drain(gen: AsyncGenerator<SseEvent>): Promise<void> {
  for await (const _ of gen) {
    /* 仅驱动生成器执行，事件内容由各用例通过桩件断言 */
  }
}

function setup(rows: Row[]) {
  // 复刻 findMany 中与上下文构建相关的筛选：会话、非空内容、排除指定 id、seq 上界
  const findMany = jest.fn(
    (args: {
      where: {
        content?: { not: string };
        id?: { not: string };
        seq?: { lt: number };
      };
      take: number;
    }) => {
      const w = args.where;
      const filtered = rows
        .filter((r) => r.content !== '')
        .filter((r) => (w.id?.not ? r.id !== w.id.not : true))
        .filter((r) => (w.seq?.lt !== undefined ? r.seq < w.seq.lt : true))
        .sort((a, b) => b.seq - a.seq)
        .slice(0, args.take);
      return Promise.resolve(filtered);
    },
  );

  const conversation = {
    id: CONVERSATION_ID,
    userId: USER_ID,
    title: '已有会话',
    model: 'gpt-5.6-terra',
    assistantId: null,
    pinned: false,
    temperature: 0.7,
    reasoningEffort: 'medium',
    createdAt: new Date(Date.UTC(2026, 7, 4, 9)),
    updatedAt: new Date(Date.UTC(2026, 7, 4, 9)),
  };

  let created = 0;
  const prisma = {
    conversation: {
      findUnique: jest.fn().mockResolvedValue(conversation),
      update: jest.fn().mockResolvedValue(conversation),
    },
    message: {
      findMany,
      findUnique: jest.fn((args: { where: { id: string } }) =>
        Promise.resolve(rows.find((r) => r.id === args.where.id) ?? null),
      ),
      findFirst: jest.fn((args: { where: { seq?: { lt: number } } }) => {
        const before = args.where.seq?.lt;
        const match = rows
          .filter((r) => r.role === 'user')
          .filter((r) => (before !== undefined ? r.seq < before : true))
          .sort((a, b) => b.seq - a.seq)[0];
        return Promise.resolve(match ?? null);
      }),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: `new_${++created}`,
          seq: 1000 + created,
          createdAt: new Date(Date.UTC(2026, 7, 4, 12)),
          parentId: null,
          ...data,
        }),
      ),
      update: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(rows.length),
    },
  };

  // 记录实际送进模型的 turns，这是上下文构建的唯一可观测出口
  const captured: ChatTurn[][] = [];
  const ai = {
    isMock: true,
    stream: jest.fn(async function* (turns: ChatTurn[]) {
      captured.push(turns);
      yield '回复';
    }),
  };

  const usage = {
    assertQuota: jest.fn().mockResolvedValue({}),
    record: jest.fn().mockResolvedValue(0),
    reserveTokens: jest.fn().mockResolvedValue(undefined),
    settleTokens: jest.fn().mockResolvedValue(undefined),
  };

  const service = new ConversationsService(
    prisma as unknown as PrismaService,
    ai as unknown as AiService,
    { resolve: (m: string) => m } as unknown as RouterService,
    new PromptService(),
    {
      check: jest.fn().mockResolvedValue({ flagged: false, categories: [], action: 'warn' }),
    } as unknown as ModerationService,
    usage as unknown as UsageService,
    { assertModelAllowed: jest.fn().mockResolvedValue(undefined) } as unknown as BillingService,
    new AbortRegistry(),
  );

  return { service, captured, findMany, usage };
}

/** 取送入模型的对话内容（去掉 system） */
const contents = (turns: ChatTurn[]) => turns.filter((t) => t.role !== 'system').map((t) => t.content);

describe('ConversationsService 上下文构建', () => {
  it('发送消息时把历史按时间正序带上，并以本条提问收尾', async () => {
    const { service, captured } = setup([
      row('m1', 'user', '第一个问题', 1),
      row('m2', 'assistant', '第一个回答', 2),
    ]);

    await drain(service.sendMessage(USER_ID, CONVERSATION_ID, { content: '第二个问题' }));

    expect(contents(captured[0])).toEqual(['第一个问题', '第一个回答', '第二个问题']);
  });

  it('重新生成时截断到目标回复之前，不把旧回复喂回模型', async () => {
    const { service, captured } = setup([
      row('m1', 'user', '第一个问题', 1),
      row('m2', 'assistant', '第一个回答', 2),
      row('m3', 'user', '第二个问题', 3),
      row('m4', 'assistant', '待重新生成的旧回答', 4),
    ]);

    await drain(service.regenerate(USER_ID, 'm4'));

    const sent = contents(captured[0]);
    expect(sent).not.toContain('待重新生成的旧回答');
    // 截断到 m3 之前的历史，末尾重新追加 m3 的提问
    expect(sent).toEqual(['第一个问题', '第一个回答', '第二个问题']);
  });

  it('重新生成后再发消息，只保留新回复，旧回复被视为已取代', async () => {
    const { service, captured } = setup([
      row('m1', 'user', '第一个问题', 1),
      row('m2', 'assistant', '旧回答', 2),
      // m3 由 m2 重新生成而来，parentId 指向 m2
      row('m3', 'assistant', '新回答', 3, 'm2'),
    ]);

    await drain(service.sendMessage(USER_ID, CONVERSATION_ID, { content: '追问' }));

    const sent = contents(captured[0]);
    expect(sent).not.toContain('旧回答');
    expect(sent).toEqual(['第一个问题', '新回答', '追问']);
  });

  // 所有 row() 的 createdAt 完全相同，模拟同毫秒批量写入；
  // 顺序若依赖时间戳则无法确定，这两条断言即会失败
  it('同一毫秒写入的消息仍按 seq 保持正确顺序', async () => {
    const { service, captured } = setup([
      row('m1', 'user', '第一问', 1),
      row('m2', 'assistant', '第一答', 2),
      row('m3', 'user', '第二问', 3),
      row('m4', 'assistant', '第二答', 4),
    ]);

    await drain(service.sendMessage(USER_ID, CONVERSATION_ID, { content: '第三问' }));

    expect(contents(captured[0])).toEqual(['第一问', '第一答', '第二问', '第二答', '第三问']);
  });

  it('同一毫秒写入时，重新生成仍能定位到正确的上一条用户消息', async () => {
    const { service, captured } = setup([
      row('m1', 'user', '第一问', 1),
      row('m2', 'assistant', '第一答', 2),
      row('m3', 'user', '第二问', 3),
      row('m4', 'assistant', '待重生成', 4),
    ]);

    await drain(service.regenerate(USER_ID, 'm4'));

    // 应取 m3 而非 m1 作为重新提问的内容
    expect(contents(captured[0])).toEqual(['第一问', '第一答', '第二问']);
  });

  it('调模型前先预留额度，结束后按实际用量结算', async () => {
    const { service, usage } = setup([row('m1', 'user', '问题', 1)]);

    await drain(service.sendMessage(USER_ID, CONVERSATION_ID, { content: '新提问' }));

    expect(usage.reserveTokens).toHaveBeenCalledTimes(1);
    const [, reserved] = usage.reserveTokens.mock.calls[0];
    // 预留必须覆盖输入并为输出留出余量，否则并发请求可同时挤过配额校验
    expect(reserved).toBeGreaterThan(2000);

    expect(usage.settleTokens).toHaveBeenCalledTimes(1);
    const [, settleReserved, actual] = usage.settleTokens.mock.calls[0];
    expect(settleReserved).toBe(reserved);
    // 实际用量远小于保守预留，差额应被归还
    expect(actual).toBeLessThan(reserved);
  });

  it('预留失败时不产生任何消息与 SSE 事件', async () => {
    const { service, usage } = setup([]);
    usage.reserveTokens.mockRejectedValue(
      Object.assign(new Error('quota'), { code: 'rate_limited' }),
    );

    await expect(
      drain(service.sendMessage(USER_ID, CONVERSATION_ID, { content: '提问' })),
    ).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('长会话保留最近的历史而非最早的历史', async () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      row(`m${i}`, i % 2 === 0 ? 'user' : 'assistant', `第 ${i} 条`, i),
    );
    const { service, captured } = setup(many);

    await drain(service.sendMessage(USER_ID, CONVERSATION_ID, { content: '新提问' }));

    const sent = contents(captured[0]);
    expect(sent).toContain('第 39 条');
    expect(sent).not.toContain('第 0 条');
    // 20 条历史 + 本条提问
    expect(sent).toHaveLength(21);
  });
});
