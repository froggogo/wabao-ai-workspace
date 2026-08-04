import { BillingCycle, Order, OrderStatus, Plan, Prisma, Subscription } from '@prisma/client';
import { OrderService } from './order.service';
import { SubscriptionService } from './subscription.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AppException } from '../../common/errors';

type OrderRow = Order;

function fakeOrders() {
  const orders: OrderRow[] = [];
  let seq = 0;

  const copy = (row: OrderRow) => ({ ...row, amount: new Prisma.Decimal(row.amount) }) as OrderRow;

  const client = {
    order: {
      findUnique: jest.fn(async (args: { where: { orderNo?: string; providerTxnId?: string; id?: string } }) => {
        const row = orders.find((o) => {
          if (args.where.orderNo) return o.orderNo === args.where.orderNo;
          if (args.where.providerTxnId) return o.providerTxnId === args.where.providerTxnId;
          if (args.where.id) return o.id === args.where.id;
          return false;
        });
        return row ? copy(row) : null;
      }),
      findUniqueOrThrow: jest.fn(async (args: { where: { id: string } }) => {
        const row = orders.find((o) => o.id === args.where.id);
        if (!row) throw new Error('not found');
        return copy(row);
      }),
      findFirst: jest.fn(
        async (args: { where: { userId: string; status: OrderStatus }; orderBy?: { createdAt: string } }) => {
          const matched = orders
            .filter((o) => o.userId === args.where.userId && o.status === args.where.status)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          return matched[0] ? copy(matched[0]) : null;
        },
      ),
      findMany: jest.fn(
        async (args: { where: { userId: string }; orderBy?: { createdAt: string }; take?: number }) => {
          return orders
            .filter((o) => o.userId === args.where.userId)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .slice(0, args.take ?? 20)
            .map(copy);
        },
      ),
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        const row = {
          id: `ord_${++seq}`,
          subscriptionId: null,
          currency: 'CNY',
          status: OrderStatus.pending,
          provider: null,
          providerTxnId: null,
          paidAt: null,
          canceledAt: null,
          refundedAt: null,
          metadata: null,
          // 用「现在」作时间戳，否则会被 PENDING_TTL 判成过期单而关掉
          createdAt: new Date(),
          updatedAt: new Date(),
          ...args.data,
          amount: new Prisma.Decimal(args.data.amount as Prisma.Decimal),
        } as unknown as OrderRow;
        orders.push(row);
        return copy(row);
      }),
      update: jest.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = orders.find((o) => o.id === args.where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, args.data);
        return copy(row);
      }),
      updateMany: jest.fn(
        async (args: { where: { id: string; status: OrderStatus }; data: Record<string, unknown> }) => {
          const row = orders.find((o) => o.id === args.where.id && o.status === args.where.status);
          if (!row) return { count: 0 };
          Object.assign(row, args.data);
          return { count: 1 };
        },
      ),
    },
  };

  return { client: client as unknown as PrismaService, orders };
}

function stubSubscriptions() {
  const changePlan = jest.fn(async (_userId: string, plan: Plan) => {
    return {
      id: `sub_${plan}`,
      plan,
      status: 'active',
    } as unknown as Subscription;
  });
  const cancel = jest.fn(async () => ({ id: 'sub_free' }) as unknown as Subscription);
  return { changePlan, cancel } as unknown as SubscriptionService & {
    changePlan: jest.Mock;
    cancel: jest.Mock;
  };
}

describe('OrderService', () => {
  let svc: OrderService;
  let store: ReturnType<typeof fakeOrders>;
  let subs: ReturnType<typeof stubSubscriptions>;

  beforeEach(() => {
    store = fakeOrders();
    subs = stubSubscriptions();
    svc = new OrderService(store.client, subs);
  });

  describe('create', () => {
    it('创建 pending 订单并计算月付金额', async () => {
      const order = await svc.create({ userId: 'u1', plan: Plan.plus, cycle: BillingCycle.monthly });
      expect(order.status).toBe(OrderStatus.pending);
      expect(order.orderNo).toMatch(/^WO\d{14}[0-9A-F]{8}$/);
      expect(Number(order.amount)).toBe(98);
      expect(order.provider).toBe('mock');
    });

    it('年付金额 = 月均价 × 12', async () => {
      const order = await svc.create({ userId: 'u1', plan: Plan.plus, cycle: BillingCycle.yearly });
      expect(Number(order.amount)).toBe(82 * 12);
    });

    it('拒绝免费版与企业版', async () => {
      await expect(svc.create({ userId: 'u1', plan: Plan.free })).rejects.toBeInstanceOf(AppException);
      await expect(svc.create({ userId: 'u1', plan: Plan.enterprise })).rejects.toBeInstanceOf(
        AppException,
      );
    });

    it('同用户同套餐复用未过期的 pending 单', async () => {
      const a = await svc.create({ userId: 'u1', plan: Plan.plus });
      const b = await svc.create({ userId: 'u1', plan: Plan.plus });
      expect(b.id).toBe(a.id);
      expect(store.orders).toHaveLength(1);
    });

    it('同用户换套餐时关闭旧 pending 并开新单', async () => {
      const a = await svc.create({ userId: 'u1', plan: Plan.plus });
      const b = await svc.create({ userId: 'u1', plan: Plan.pro });
      expect(b.id).not.toBe(a.id);
      expect(store.orders.find((o) => o.id === a.id)?.status).toBe(OrderStatus.canceled);
      expect(b.status).toBe(OrderStatus.pending);
    });
  });

  describe('markPaid', () => {
    it('pending → paid 并履约订阅', async () => {
      const order = await svc.create({ userId: 'u1', plan: Plan.plus });
      const paid = await svc.markPaid({
        orderNo: order.orderNo,
        provider: 'mock',
        providerTxnId: 'txn_1',
      });
      expect(paid.status).toBe(OrderStatus.paid);
      expect(paid.providerTxnId).toBe('txn_1');
      expect(paid.subscriptionId).toBe('sub_plus');
      expect(subs.changePlan).toHaveBeenCalledWith('u1', Plan.plus, BillingCycle.monthly);
    });

    it('同一交易号重复回调幂等', async () => {
      const order = await svc.create({ userId: 'u1', plan: Plan.plus });
      await svc.markPaid({ orderNo: order.orderNo, provider: 'mock', providerTxnId: 'txn_1' });
      const again = await svc.markPaid({
        orderNo: order.orderNo,
        provider: 'mock',
        providerTxnId: 'txn_1',
      });
      expect(again.status).toBe(OrderStatus.paid);
      expect(subs.changePlan).toHaveBeenCalledTimes(1);
    });

    it('已支付订单收到不同交易号则冲突', async () => {
      const order = await svc.create({ userId: 'u1', plan: Plan.plus });
      await svc.markPaid({ orderNo: order.orderNo, provider: 'mock', providerTxnId: 'txn_1' });
      await expect(
        svc.markPaid({ orderNo: order.orderNo, provider: 'mock', providerTxnId: 'txn_2' }),
      ).rejects.toMatchObject({ code: 'conflict' });
    });

    it('canceled 订单不可再支付', async () => {
      const order = await svc.create({ userId: 'u1', plan: Plan.plus });
      await svc.cancel('u1', order.orderNo);
      await expect(
        svc.markPaid({ orderNo: order.orderNo, provider: 'mock', providerTxnId: 'txn_1' }),
      ).rejects.toMatchObject({ code: 'invalid_request' });
    });

    it('履约失败时订单保持 paid 并记录错误', async () => {
      subs.changePlan.mockRejectedValueOnce(new Error('boom'));
      const order = await svc.create({ userId: 'u1', plan: Plan.plus });
      const paid = await svc.markPaid({
        orderNo: order.orderNo,
        provider: 'mock',
        providerTxnId: 'txn_1',
      });
      expect(paid.status).toBe(OrderStatus.paid);
      expect((paid.metadata as { fulfill_error?: string }).fulfill_error).toBe('boom');
    });
  });

  describe('mockPay / cancel / refund / fail', () => {
    it('mockPay 生成稳定交易号且可重复确认', async () => {
      const order = await svc.create({ userId: 'u1', plan: Plan.plus });
      const a = await svc.mockPay(order.orderNo);
      const b = await svc.mockPay(order.orderNo);
      expect(a.providerTxnId).toBe(b.providerTxnId);
      expect(a.providerTxnId).toMatch(/^mock_/);
      expect(subs.changePlan).toHaveBeenCalledTimes(1);
    });

    it('cancel 仅允许 pending', async () => {
      const order = await svc.create({ userId: 'u1', plan: Plan.plus });
      const canceled = await svc.cancel('u1', order.orderNo);
      expect(canceled.status).toBe(OrderStatus.canceled);
      expect(canceled.canceledAt).toBeTruthy();
    });

    it('markFailed 幂等', async () => {
      const order = await svc.create({ userId: 'u1', plan: Plan.plus });
      const a = await svc.markFailed(order.orderNo, 'channel_reject');
      const b = await svc.markFailed(order.orderNo, 'channel_reject');
      expect(a.status).toBe(OrderStatus.failed);
      expect(b.status).toBe(OrderStatus.failed);
    });

    it('refund 仅已支付可退，并触发取消订阅', async () => {
      const order = await svc.create({ userId: 'u1', plan: Plan.plus });
      await svc.mockPay(order.orderNo);
      const refunded = await svc.refund(order.orderNo, { reason: 'user_request' });
      expect(refunded.status).toBe(OrderStatus.refunded);
      expect(refunded.refundedAt).toBeTruthy();
      expect(subs.cancel).toHaveBeenCalledWith('u1');
    });

    it('pending 不可退款', async () => {
      const order = await svc.create({ userId: 'u1', plan: Plan.plus });
      await expect(svc.refund(order.orderNo)).rejects.toMatchObject({ code: 'invalid_request' });
    });
  });

  describe('toDto', () => {
    it('amount 输出为 number', async () => {
      const order = await svc.create({ userId: 'u1', plan: Plan.plus });
      const dto = svc.toDto(order);
      expect(typeof dto.amount).toBe('number');
      expect(dto.order_no).toBe(order.orderNo);
    });
  });
});
