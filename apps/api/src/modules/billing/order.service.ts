import { Injectable, Logger } from '@nestjs/common';
import { BillingCycle, Order, OrderStatus, Plan, Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { PLAN_MAP, PlanId } from '@wabao/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AppException } from '../../common/errors';
import { SubscriptionService } from './subscription.service';

/** 待支付订单超时（超时后允许用户重新下单；关闭动作惰性执行） */
const PENDING_TTL_MS = 30 * 60 * 1000;

export interface CreateOrderInput {
  userId: string;
  plan: Plan;
  cycle?: BillingCycle;
  provider?: string;
}

export interface PayCallbackInput {
  orderNo: string;
  provider: string;
  providerTxnId: string;
  paidAt?: Date;
  metadata?: Record<string, unknown>;
}

/**
 * 订单与支付状态机。
 *
 * 状态流转（单向，已终态不可回退）：
 *   pending → paid | failed | canceled
 *   paid    → refunded
 *
 * 幂等约定：
 * - `providerTxnId` 全局唯一；同一交易号重复回调直接返回已支付订单；
 * - `markPaid` 用 `UPDATE … WHERE status='pending'` 做条件写入，
 *   并发回调只有一条能抢到状态迁移，其余走幂等读回。
 */
@Injectable()
export class OrderService {
  private readonly logger = new Logger('Order');

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionService,
  ) {}

  // ---------- 下单 ----------

  async create(input: CreateOrderInput): Promise<Order> {
    const cycle = input.cycle ?? BillingCycle.monthly;
    const plan = input.plan;

    if (plan === Plan.free) {
      throw new AppException('invalid_request', '免费版无需下单');
    }
    if (plan === Plan.enterprise) {
      throw new AppException('invalid_request', '企业版为定制方案，请联系销售开通');
    }
    const config = PLAN_MAP[plan as unknown as PlanId];
    if (!config) {
      throw new AppException('invalid_request', '未知的套餐');
    }

    const amount = this.amountOf(plan, cycle);
    // 同一用户同时只允许一笔待支付单，避免重复扣款
    const existing = await this.prisma.order.findFirst({
      where: { userId: input.userId, status: OrderStatus.pending },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      if (Date.now() - existing.createdAt.getTime() < PENDING_TTL_MS) {
        // 套餐/周期一致则复用，否则先关掉旧单再开新单
        if (existing.plan === plan && existing.cycle === cycle) {
          return existing;
        }
        await this.closePending(existing, 'replaced_by_new_order');
      } else {
        await this.closePending(existing, 'expired');
      }
    }

    const orderNo = this.genOrderNo();
    const provider = input.provider ?? 'mock';
    return this.prisma.order.create({
      data: {
        orderNo,
        userId: input.userId,
        plan,
        cycle,
        amount,
        currency: 'CNY',
        status: OrderStatus.pending,
        provider,
      },
    });
  }

  // ---------- 查询 ----------

  async getForUser(userId: string, orderNo: string): Promise<Order> {
    const order = await this.prisma.order.findUnique({ where: { orderNo } });
    if (!order || order.userId !== userId) {
      throw new AppException('not_found', '订单不存在');
    }
    return order;
  }

  async listForUser(userId: string, take = 20): Promise<Order[]> {
    return this.prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(take, 1), 100),
    });
  }

  // ---------- 状态迁移 ----------

  /** 用户主动取消待支付订单 */
  async cancel(userId: string, orderNo: string): Promise<Order> {
    const order = await this.getForUser(userId, orderNo);
    if (order.status !== OrderStatus.pending) {
      throw new AppException('invalid_request', `订单状态为 ${order.status}，无法取消`);
    }
    return this.closePending(order, 'user_canceled');
  }

  /**
   * 支付成功回调（渠道 Webhook / mock 确认共用入口）。
   * 成功后驱动订阅变更；重复回调对同一 `providerTxnId` 幂等。
   */
  async markPaid(input: PayCallbackInput): Promise<Order> {
    const order = await this.prisma.order.findUnique({ where: { orderNo: input.orderNo } });
    if (!order) {
      throw new AppException('not_found', '订单不存在');
    }

    // 已支付：同交易号 → 幂等返回；不同交易号 → 冲突
    if (order.status === OrderStatus.paid) {
      if (order.providerTxnId === input.providerTxnId) {
        return order;
      }
      throw new AppException('conflict', '订单已支付，交易号不一致', {
        order_no: order.orderNo,
        existing_txn: order.providerTxnId,
      });
    }
    if (order.status !== OrderStatus.pending) {
      throw new AppException('invalid_request', `订单状态为 ${order.status}，无法支付`);
    }

    // 交易号若已被其它订单占用，先拦一层，避免落到 DB unique 报错
    const occupied = await this.prisma.order.findUnique({
      where: { providerTxnId: input.providerTxnId },
    });
    if (occupied && occupied.id !== order.id) {
      throw new AppException('conflict', '支付交易号已被其它订单使用', {
        order_no: occupied.orderNo,
      });
    }

    const paidAt = input.paidAt ?? new Date();
    const meta = {
      ...((order.metadata as Record<string, unknown> | null) ?? {}),
      ...(input.metadata ?? {}),
    };

    // 条件写入：只有 pending → paid 抢锁成功的那条回调继续履约
    const locked = await this.prisma.order.updateMany({
      where: { id: order.id, status: OrderStatus.pending },
      data: {
        status: OrderStatus.paid,
        provider: input.provider,
        providerTxnId: input.providerTxnId,
        paidAt,
        metadata: meta as Prisma.InputJsonValue,
      },
    });

    if (locked.count === 0) {
      // 并发下别人已处理；按幂等规则再读一次
      const again = await this.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      if (again.status === OrderStatus.paid && again.providerTxnId === input.providerTxnId) {
        return again;
      }
      throw new AppException('conflict', '订单状态已被并发更新', { status: again.status });
    }

    this.logger.log(`订单 ${order.orderNo} 已支付（${input.provider}/${input.providerTxnId}）`);

    // 履约：驱动订阅变更。失败时订单保持 paid，写入 metadata 供补单/对账
    try {
      const sub = await this.subscriptions.changePlan(order.userId, order.plan, order.cycle);
      return this.prisma.order.update({
        where: { id: order.id },
        data: { subscriptionId: sub.id },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`订单 ${order.orderNo} 履约失败：${message}`);
      return this.prisma.order.update({
        where: { id: order.id },
        data: {
          metadata: {
            ...meta,
            fulfill_error: message,
          } as Prisma.InputJsonValue,
        },
      });
    }
  }

  /** 支付失败（渠道明确告知失败时调用；用户可重新下单） */
  async markFailed(
    orderNo: string,
    reason?: string,
    metadata?: Record<string, unknown>,
  ): Promise<Order> {
    const order = await this.prisma.order.findUnique({ where: { orderNo } });
    if (!order) {
      throw new AppException('not_found', '订单不存在');
    }
    if (order.status === OrderStatus.failed) {
      return order;
    }
    if (order.status !== OrderStatus.pending) {
      throw new AppException('invalid_request', `订单状态为 ${order.status}，无法标记失败`);
    }
    const meta = {
      ...((order.metadata as Record<string, unknown> | null) ?? {}),
      ...(metadata ?? {}),
      fail_reason: reason ?? 'payment_failed',
    };
    const locked = await this.prisma.order.updateMany({
      where: { id: order.id, status: OrderStatus.pending },
      data: {
        status: OrderStatus.failed,
        metadata: meta as Prisma.InputJsonValue,
      },
    });
    if (locked.count === 0) {
      return this.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    }
    return this.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  }

  /**
   * 退款：仅已支付订单可退。退款后当前策略是回落免费版
   * （更精细的按剩余天数折算可在接真实渠道时再补）。
   */
  async refund(
    orderNo: string,
    opts: { reason?: string; metadata?: Record<string, unknown> } = {},
  ): Promise<Order> {
    const order = await this.prisma.order.findUnique({ where: { orderNo } });
    if (!order) {
      throw new AppException('not_found', '订单不存在');
    }
    if (order.status === OrderStatus.refunded) {
      return order;
    }
    if (order.status !== OrderStatus.paid) {
      throw new AppException('invalid_request', `订单状态为 ${order.status}，无法退款`);
    }

    const meta = {
      ...((order.metadata as Record<string, unknown> | null) ?? {}),
      ...(opts.metadata ?? {}),
      refund_reason: opts.reason ?? 'refunded',
    };
    const locked = await this.prisma.order.updateMany({
      where: { id: order.id, status: OrderStatus.paid },
      data: {
        status: OrderStatus.refunded,
        refundedAt: new Date(),
        metadata: meta as Prisma.InputJsonValue,
      },
    });
    if (locked.count === 0) {
      const again = await this.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      if (again.status === OrderStatus.refunded) return again;
      throw new AppException('conflict', '订单状态已被并发更新', { status: again.status });
    }

    // 退款后取消付费权益：周期末回落（与用户主动取消一致）
    try {
      await this.subscriptions.cancel(order.userId);
    } catch (err) {
      // 用户可能已是免费版或已取消，不阻断退款记账
      this.logger.warn(
        `订单 ${order.orderNo} 退款后取消订阅跳过：${err instanceof Error ? err.message : err}`,
      );
    }

    return this.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  }

  /**
   * Mock 支付：开发/e2e 环境用。正式渠道接入后由 Webhook 调用 markPaid。
   * 生成稳定可复现的 mock 交易号，重复确认同一订单保持幂等。
   */
  async mockPay(orderNo: string): Promise<Order> {
    const order = await this.prisma.order.findUnique({ where: { orderNo } });
    if (!order) {
      throw new AppException('not_found', '订单不存在');
    }
    const txnId =
      order.providerTxnId ??
      `mock_${createHash('sha256').update(order.orderNo).digest('hex').slice(0, 24)}`;
    return this.markPaid({
      orderNo,
      provider: order.provider ?? 'mock',
      providerTxnId: txnId,
      metadata: { mock: true },
    });
  }

  // ---------- DTO ----------

  toDto(order: Order) {
    return {
      order_no: order.orderNo,
      plan: order.plan,
      cycle: order.cycle,
      amount: Number(order.amount),
      currency: order.currency,
      status: order.status,
      provider: order.provider,
      provider_txn_id: order.providerTxnId,
      subscription_id: order.subscriptionId,
      paid_at: order.paidAt,
      canceled_at: order.canceledAt,
      refunded_at: order.refundedAt,
      created_at: order.createdAt,
    };
  }

  // ---------- 内部 ----------

  /** 套餐应付金额（元）。年付按「月均价 × 12」一次收取 */
  amountOf(plan: Plan, cycle: BillingCycle): Prisma.Decimal {
    const config = PLAN_MAP[plan as unknown as PlanId];
    if (!config) {
      throw new AppException('invalid_request', '未知的套餐');
    }
    if (config.priceMonthly === null) {
      throw new AppException('invalid_request', '该套餐无标价，请联系销售');
    }
    if (cycle === BillingCycle.yearly) {
      const perMonth = config.priceYearlyPerMonth ?? config.priceMonthly;
      return new Prisma.Decimal(perMonth).mul(12);
    }
    return new Prisma.Decimal(config.priceMonthly);
  }

  private async closePending(order: Order, reason: string): Promise<Order> {
    const meta = {
      ...((order.metadata as Record<string, unknown> | null) ?? {}),
      close_reason: reason,
    };
    const locked = await this.prisma.order.updateMany({
      where: { id: order.id, status: OrderStatus.pending },
      data: {
        status: OrderStatus.canceled,
        canceledAt: new Date(),
        metadata: meta as Prisma.InputJsonValue,
      },
    });
    if (locked.count === 0) {
      return this.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    }
    return this.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  }

  /** 商户订单号：时间戳 + 随机后缀，可读且碰撞概率可忽略 */
  private genOrderNo(): string {
    const ts = new Date()
      .toISOString()
      .replace(/[-:TZ.]/g, '')
      .slice(0, 14);
    const rand = randomBytes(4).toString('hex').toUpperCase();
    return `WO${ts}${rand}`;
  }
}
