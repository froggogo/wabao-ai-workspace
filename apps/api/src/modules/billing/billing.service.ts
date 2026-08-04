import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BillingCycle, Plan, Subscription } from '@prisma/client';
import { PLAN_RANK, PlanId } from '@wabao/shared';
import { AppException } from '../../common/errors';
import { ModelId } from '../../ai/models';
import { PLANS, PLAN_MAP, isModelAllowed } from './plans';
import { SubscriptionService } from './subscription.service';
import { OrderService } from './order.service';
import { PaymentWebhookDto } from './dto/billing.dto';

@Injectable()
export class BillingService {
  constructor(
    private readonly config: ConfigService,
    private readonly subscriptions: SubscriptionService,
    private readonly orders: OrderService,
  ) {}

  /** 套餐目录（公开） */
  listPlans() {
    return PLANS.map((p) => ({
      id: p.id,
      name: p.name,
      tagline: p.tagline,
      anchor: p.anchor,
      price_monthly: p.priceMonthly,
      price_yearly_per_month: p.priceYearlyPerMonth,
      unit: p.unit,
      quota_tokens: p.quotaTokens,
      allowed_models: p.allowedModels,
      highlights: p.highlights,
    }));
  }

  /** 当前用户订阅详情 */
  async getSubscription(userId: string) {
    const sub = await this.subscriptions.current(userId);
    return this.toDto(sub);
  }

  /**
   * 变更订阅。
   *
   * - 降档 / 回到免费：无需支付，直接记 pendingPlan（周期末生效）；
   * - 升档 / 同档续期：创建订单；`PAYMENT_PROVIDER=mock`（默认）时自动确认支付并履约，
   *   正式渠道接入后改为返回订单让前端跳转收银台，Webhook 再调 markPaid。
   */
  async subscribe(userId: string, plan: Plan, cycle: BillingCycle = BillingCycle.monthly) {
    const config = PLAN_MAP[plan];
    if (!config) {
      throw new AppException('invalid_request', '未知的套餐');
    }
    if (plan === Plan.enterprise) {
      throw new AppException('invalid_request', '企业版为定制方案，请联系销售开通');
    }

    const current = await this.subscriptions.current(userId);
    const from = PLAN_RANK[current.plan as unknown as PlanId] ?? 0;
    const to = PLAN_RANK[plan as unknown as PlanId] ?? 0;

    // 降档或切免费：无资金流，直接走订阅状态机
    if (to < from || plan === Plan.free) {
      const sub = await this.subscriptions.changePlan(userId, plan, cycle);
      return this.toDto(sub);
    }

    const order = await this.orders.create({ userId, plan, cycle });
    if (this.isMockPayment()) {
      await this.orders.mockPay(order.orderNo);
      return this.toDto(await this.subscriptions.current(userId));
    }

    // 真实支付：返回待支付订单，前端凭 order_no 调起收银台
    return {
      ...this.toDto(current),
      pending_order: this.orders.toDto(order),
    };
  }

  /** 取消订阅：当期照常可用，周期末回落免费版 */
  async cancel(userId: string) {
    return this.toDto(await this.subscriptions.cancel(userId));
  }

  /** 撤销取消 */
  async resume(userId: string) {
    return this.toDto(await this.subscriptions.resume(userId));
  }

  // ---------- 订单 ----------

  async createOrder(userId: string, plan: Plan, cycle?: BillingCycle, provider?: string) {
    const order = await this.orders.create({ userId, plan, cycle, provider });
    return this.orders.toDto(order);
  }

  async listOrders(userId: string) {
    const rows = await this.orders.listForUser(userId);
    return rows.map((o) => this.orders.toDto(o));
  }

  async getOrder(userId: string, orderNo: string) {
    return this.orders.toDto(await this.orders.getForUser(userId, orderNo));
  }

  async cancelOrder(userId: string, orderNo: string) {
    return this.orders.toDto(await this.orders.cancel(userId, orderNo));
  }

  /** 仅 mock 渠道开放：模拟用户完成支付 */
  async mockPayOrder(userId: string, orderNo: string) {
    if (!this.isMockPayment()) {
      throw new AppException('forbidden', '当前环境未启用 mock 支付');
    }
    // 校验归属后再确认，避免用他人 order_no 刷单
    await this.orders.getForUser(userId, orderNo);
    return this.orders.toDto(await this.orders.mockPay(orderNo));
  }

  /**
   * 支付渠道回调。生产环境应在控制器层先验签；
   * 此处按 event 分发到状态机，paid 事件必须带 provider_txn_id。
   */
  async handleWebhook(provider: string, dto: PaymentWebhookDto) {
    if (dto.event === 'paid') {
      if (!dto.provider_txn_id) {
        throw new AppException('invalid_request', 'paid 事件缺少 provider_txn_id');
      }
      const order = await this.orders.markPaid({
        orderNo: dto.order_no,
        provider,
        providerTxnId: dto.provider_txn_id,
      });
      return this.orders.toDto(order);
    }
    if (dto.event === 'failed') {
      return this.orders.toDto(await this.orders.markFailed(dto.order_no, dto.reason));
    }
    if (dto.event === 'refunded') {
      return this.orders.toDto(
        await this.orders.refund(dto.order_no, { reason: dto.reason }),
      );
    }
    throw new AppException('invalid_request', `未知事件：${dto.event}`);
  }

  /** 模型权限校验：当前套餐不可用则抛 403，引导升级 */
  async assertModelAllowed(userId: string, model: ModelId): Promise<void> {
    const sub = await this.subscriptions.current(userId);
    if (!isModelAllowed(sub.plan, model)) {
      const config = PLAN_MAP[sub.plan];
      throw new AppException(
        'forbidden',
        `当前套餐「${config.name}」不可使用该模型，请升级后使用`,
        { plan: sub.plan, model, allowed_models: config.allowedModels },
      );
    }
  }

  private isMockPayment(): boolean {
    const provider = (this.config.get<string>('PAYMENT_PROVIDER') ?? 'mock').toLowerCase();
    return provider === 'mock' || provider === '';
  }

  private toDto(sub: Subscription) {
    const config = PLAN_MAP[sub.plan] ?? PLAN_MAP[Plan.free];
    return {
      plan: sub.plan,
      name: config.name,
      status: sub.status,
      cycle: sub.cycle,
      quota_tokens: sub.quotaTokens,
      monthly_images: sub.monthlyImages,
      allowed_models: config.allowedModels,
      current_period_start: sub.currentPeriodStart,
      current_period_end: sub.currentPeriodEnd,
      expires_at: sub.expiresAt,
      // 降级/取消在周期末才切换，前端据此提示「将于 X 日变更为 Y」
      pending_plan: sub.pendingPlan,
      canceled_at: sub.canceledAt,
    };
  }
}
