import { Plan, Subscription } from '@prisma/client';
import { PLAN_IMAGE_LIMITS, quotaForPlan } from '@wabao/shared';
import { SubscriptionService } from './subscription.service';
import { PrismaService } from '../../prisma/prisma.service';

const DAY = 24 * 60 * 60 * 1000;
const PERIOD_MS = 30 * DAY;

/**
 * 内存版订阅存储，复刻「一个用户最多一条 active 订阅」的部分唯一索引语义。
 * 周期滚动与升降级都依赖读改写的时序，纯 mock 无法暴露顺序问题。
 */
function fakeStore() {
  const subs: Subscription[] = [];
  const users = new Map<string, { plan: Plan; quotaTokens: number }>();
  let seq = 0;

  const create = (data: Record<string, unknown>): Subscription => {
    const row = {
      id: `sub_${++seq}`,
      cycle: 'monthly',
      status: 'active',
      expiresAt: null,
      pendingPlan: null,
      canceledAt: null,
      createdAt: new Date(1000 + seq),
      updatedAt: new Date(1000 + seq),
      ...data,
    } as unknown as Subscription;
    if (
      row.status === 'active' &&
      subs.some((s) => s.userId === row.userId && s.status === 'active')
    ) {
      throw Object.assign(new Error('unique violation'), { code: 'P2002' });
    }
    subs.push(row);
    return row;
  };

  // 真实 Prisma 返回的是新对象而非存储行的引用；返回副本才能暴露
  // 「写入后又去读入参对象」这类顺序缺陷
  const copy = (row: Subscription) => ({ ...row }) as Subscription;

  const client = {
    subscription: {
      findFirst: jest.fn(async (args: { where: { userId: string; status: { in: string[] } } }) => {
        const matched = subs
          .filter((s) => s.userId === args.where.userId)
          .filter((s) => args.where.status.in.includes(s.status))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return matched[0] ? copy(matched[0]) : null;
      }),
      create: jest.fn(async (args: { data: Record<string, unknown> }) => copy(create(args.data))),
      update: jest.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = subs.find((s) => s.id === args.where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, args.data);
        return copy(row);
      }),
      updateMany: jest.fn(
        async (args: {
          where: { userId: string; status: { in: string[] } };
          data: Record<string, unknown>;
        }) => {
          let count = 0;
          for (const s of subs) {
            if (s.userId === args.where.userId && args.where.status.in.includes(s.status)) {
              Object.assign(s, args.data);
              count++;
            }
          }
          return { count };
        },
      ),
    },
    user: {
      update: jest.fn(
        async (args: { where: { id: string }; data: { plan: Plan; quotaTokens: number } }) => {
          users.set(args.where.id, args.data);
          return args.data;
        },
      ),
    },
  };

  return {
    subs,
    users,
    prisma: {
      ...client,
      // 事务直接复用同一份内存客户端，保证顺序语义一致
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(client)),
    } as unknown as PrismaService,
  };
}

function setup() {
  const store = fakeStore();
  return { store, service: new SubscriptionService(store.prisma) };
}

/**
 * 把订阅周期挪到过去，模拟时间流逝。
 * agoMs 指周期起点距今的时长，需刻意取非整数个周期，
 * 否则滚动后的新起点会恰好回到原值，测不出周期是否真的推进了。
 */
function expirePeriod(sub: Subscription, agoMs: number) {
  const now = Date.now();
  sub.currentPeriodStart = new Date(now - agoMs);
  sub.currentPeriodEnd = new Date(now - agoMs + PERIOD_MS);
}

describe('SubscriptionService', () => {
  describe('current', () => {
    it('无订阅时自动开通免费版', async () => {
      const { service, store } = setup();

      const sub = await service.current('u1');

      expect(sub.plan).toBe('free');
      expect(sub.status).toBe('active');
      // 免费版不应有到期日，否则周期滚动停摆时会集体失效
      expect(sub.expiresAt).toBeNull();
      expect(store.subs).toHaveLength(1);
    });

    it('周期未结束时原样返回，不做滚动', async () => {
      const { service, store } = setup();
      const first = await service.current('u1');

      const again = await service.current('u1');

      expect(again.currentPeriodStart).toEqual(first.currentPeriodStart);
      expect(store.subs).toHaveLength(1);
    });
  });

  describe('周期滚动', () => {
    it('周期结束后自动推进到新周期', async () => {
      const { service, store } = setup();
      await service.current('u1');
      // 起点在 45 天前 → 周期已于 15 天前结束
      expirePeriod(store.subs[0], 45 * DAY);
      const staleStart = store.subs[0].currentPeriodStart.getTime();

      const rolled = await service.current('u1');

      expect(rolled.currentPeriodStart.getTime()).toBe(staleStart + PERIOD_MS);
      expect(rolled.currentPeriodEnd.getTime()).toBeGreaterThan(Date.now());
    });

    it('长期未访问跨越多个周期时一次推进到位', async () => {
      const { service, store } = setup();
      await service.current('u1');
      expirePeriod(store.subs[0], 100 * DAY);

      const rolled = await service.current('u1');

      // 新周期必须覆盖此刻，而不是只前进一个周期
      expect(rolled.currentPeriodStart.getTime()).toBeLessThanOrEqual(Date.now());
      expect(rolled.currentPeriodEnd.getTime()).toBeGreaterThan(Date.now());
    });

    it('周期末应用 pendingPlan，并同步 users 冗余字段', async () => {
      const { service, store } = setup();
      await service.activate('u1', Plan.pro);
      await service.scheduleDowngrade('u1', Plan.plus);
      expirePeriod(store.subs.find((s) => s.status === 'active')!, 45 * DAY);

      const rolled = await service.current('u1');

      expect(rolled.plan).toBe('plus');
      expect(rolled.pendingPlan).toBeNull();
      expect(rolled.quotaTokens).toBe(quotaForPlan('plus'));
      expect(rolled.monthlyImages).toBe(PLAN_IMAGE_LIMITS.plus.monthlyImages);
      expect(store.users.get('u1')).toMatchObject({ plan: 'plus' });
    });

    it('付费订阅到期后回落免费版', async () => {
      const { service, store } = setup();
      await service.activate('u1', Plan.plus);
      const sub = store.subs.find((s) => s.status === 'active')!;
      expirePeriod(sub, 45 * DAY);
      sub.expiresAt = new Date(Date.now() - DAY);

      const rolled = await service.current('u1');

      expect(rolled.plan).toBe('free');
      expect(rolled.status).toBe('active');
      // 旧订阅置为 expired，保证 active 唯一
      expect(store.subs.filter((s) => s.status === 'active')).toHaveLength(1);
    });
  });

  describe('升降级', () => {
    it('升级立即生效并开启新周期', async () => {
      const { service, store } = setup();
      await service.current('u1');

      const upgraded = await service.changePlan('u1', Plan.plus);

      expect(upgraded.plan).toBe('plus');
      expect(upgraded.quotaTokens).toBe(quotaForPlan('plus'));
      expect(upgraded.expiresAt).not.toBeNull();
      expect(store.subs.filter((s) => s.status === 'active')).toHaveLength(1);
      expect(store.users.get('u1')).toMatchObject({ plan: 'plus' });
    });

    // 用户已为当期付费，降级若立刻生效等于没收已付费额度
    it('降级不立即生效，当期维持原权益', async () => {
      const { service, store } = setup();
      await service.activate('u1', Plan.pro);

      const after = await service.changePlan('u1', Plan.plus);

      expect(after.plan).toBe('pro');
      expect(after.pendingPlan).toBe('plus');
      expect(after.quotaTokens).toBe(quotaForPlan('pro'));
      expect(store.users.get('u1')).toMatchObject({ plan: 'pro' });
    });

    it('同档变更视为续期，不打断当前周期', async () => {
      const { service } = setup();
      const sub = await service.activate('u1', Plan.plus);
      const start = sub.currentPeriodStart;
      const expiry = sub.expiresAt!.getTime();

      const renewed = await service.changePlan('u1', Plan.plus);

      expect(renewed.currentPeriodStart).toEqual(start);
      expect(renewed.expiresAt!.getTime()).toBeGreaterThan(expiry);
    });

    it('年付续期按年延长有效期', async () => {
      const { service } = setup();
      const monthly = await service.activate('u1', Plan.plus, 'monthly');
      const monthlyExpiry = monthly.expiresAt!.getTime();

      const yearly = await service.changePlan('u1', Plan.plus, 'yearly');

      expect(yearly.cycle).toBe('yearly');
      expect(yearly.expiresAt!.getTime() - monthlyExpiry).toBeGreaterThan(300 * DAY);
      // 年付的配额周期仍是 30 天滚动，不是一年一次
      expect(yearly.currentPeriodEnd.getTime() - yearly.currentPeriodStart.getTime()).toBe(
        PERIOD_MS,
      );
    });
  });

  describe('取消与恢复', () => {
    it('取消后当期仍可用，周期末回落免费版', async () => {
      const { service, store } = setup();
      await service.activate('u1', Plan.plus);

      const canceled = await service.cancel('u1');
      expect(canceled.status).toBe('canceled');
      expect(canceled.plan).toBe('plus');

      expirePeriod(store.subs.find((s) => s.status === 'canceled')!, 45 * DAY);
      const rolled = await service.current('u1');

      expect(rolled.plan).toBe('free');
      expect(rolled.status).toBe('active');
    });

    it('周期结束前可撤销取消', async () => {
      const { service } = setup();
      await service.activate('u1', Plan.plus);
      await service.cancel('u1');

      const resumed = await service.resume('u1');

      expect(resumed.status).toBe('active');
      expect(resumed.canceledAt).toBeNull();
      expect(resumed.pendingPlan).toBeNull();
    });

    it('免费版无法取消', async () => {
      const { service } = setup();
      await service.current('u1');
      await expect(service.cancel('u1')).rejects.toMatchObject({ code: 'invalid_request' });
    });

    it('未取消时无法撤销', async () => {
      const { service } = setup();
      await service.activate('u1', Plan.plus);
      await expect(service.resume('u1')).rejects.toMatchObject({ code: 'invalid_request' });
    });
  });

  describe('periodKey', () => {
    it('随周期滚动而改变，使额度自然重置', async () => {
      const { service, store } = setup();
      const sub = await service.current('u1');
      const before = service.periodKey(sub);

      expirePeriod(store.subs[0], 45 * DAY);
      const rolled = await service.current('u1');

      expect(service.periodKey(rolled)).not.toBe(before);
    });
  });
});
