import { Injectable, Logger } from '@nestjs/common';
import { BillingCycle, Plan, Prisma, Subscription } from '@prisma/client';
import { PLAN_RANK, PlanId, imageLimitsForPlan, quotaForPlan } from '@wabao/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AppException } from '../../common/errors';

/**
 * 配额周期长度。刻意与自然月脱钩：按自然月计量时，月中升级的用户会把
 * 升级前已消耗的量算进新套餐额度，等于为已付费的额度打了折。
 */
const PERIOD_DAYS = 30;
const PERIOD_MS = PERIOD_DAYS * 24 * 60 * 60 * 1000;

/** 年付订阅的有效期 */
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export interface PlanEntitlement {
  quotaTokens: number;
  monthlyImages: number;
}

/**
 * 订阅与计费周期的唯一权威来源。
 *
 * 关键约定：
 * - 每个用户恒有一条 active 订阅，免费版由此兜底，业务代码无需处理「无订阅」分支；
 * - 周期滚动是**惰性**的：任何一次读取都会先把过期周期推进到当前，
 *   因此即使没有定时任务，配额也能正确重置；
 * - 升级立即生效（用户已付费，理应马上拿到权益），降级与取消一律周期末生效。
 */
@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger('Subscription');

  constructor(private readonly prisma: PrismaService) {}

  // ---------- 读取 ----------

  /** 取当前生效订阅；缺失时补开免费版，过期周期会被顺带推进 */
  async current(userId: string): Promise<Subscription> {
    const existing = await this.prisma.subscription.findFirst({
      where: { userId, status: { in: ['active', 'canceled'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (!existing) {
      return this.openFree(userId);
    }
    return this.roll(existing);
  }

  /**
   * 配额计数器的周期标识。以周期起点作为键，续期后自然变成新键，
   * 额度随之重置，无需任何清理任务。
   */
  periodKey(sub: Subscription): string {
    return sub.currentPeriodStart.toISOString();
  }

  /** 当前周期的权益快照（下单时锁定，不受后续调价影响） */
  entitlement(sub: Subscription): PlanEntitlement {
    return { quotaTokens: sub.quotaTokens, monthlyImages: sub.monthlyImages };
  }

  // ---------- 变更 ----------

  /**
   * 套餐变更入口。按档位高低自动分流：
   * 升档立即生效并开启新周期，降档记入 pendingPlan 待周期末生效。
   */
  async changePlan(userId: string, plan: Plan, cycle: BillingCycle = 'monthly') {
    const sub = await this.current(userId);
    const from = PLAN_RANK[sub.plan as unknown as PlanId] ?? 0;
    const to = PLAN_RANK[plan as unknown as PlanId] ?? 0;

    if (to > from) {
      return this.activate(userId, plan, cycle);
    }
    if (to < from) {
      return this.scheduleDowngrade(userId, plan);
    }
    // 同档视为续期：延长有效期，不打断当前周期
    return this.renew(sub, cycle);
  }

  /**
   * 立即生效地切换到目标套餐（支付成功后调用）。
   * 结束旧订阅并开启新周期，因此额度按新套餐重新计算。
   */
  async activate(
    userId: string,
    plan: Plan,
    cycle: BillingCycle = 'monthly',
  ): Promise<Subscription> {
    const now = new Date();
    const entitlement = this.entitlementFor(plan);

    return this.prisma.$transaction(async (tx) => {
      // 部分唯一索引限制同一用户只能有一条 active，必须先让旧订阅退场
      await tx.subscription.updateMany({
        where: { userId, status: { in: ['active', 'canceled'] } },
        data: { status: 'expired' },
      });

      const created = await tx.subscription.create({
        data: {
          userId,
          plan,
          cycle,
          status: 'active',
          currentPeriodStart: now,
          currentPeriodEnd: new Date(now.getTime() + PERIOD_MS),
          expiresAt: this.expiryFor(plan, cycle, now),
          ...entitlement,
        },
      });
      await this.syncUser(tx, userId, plan, entitlement.quotaTokens);
      return created;
    });
  }

  /** 降级：当期维持原权益，周期末才切换 */
  async scheduleDowngrade(userId: string, plan: Plan): Promise<Subscription> {
    const sub = await this.current(userId);
    if (sub.plan === plan) {
      return this.prisma.subscription.update({
        where: { id: sub.id },
        data: { pendingPlan: null },
      });
    }
    return this.prisma.subscription.update({
      where: { id: sub.id },
      data: { pendingPlan: plan },
    });
  }

  /** 取消订阅：周期末失效并回落免费版 */
  async cancel(userId: string): Promise<Subscription> {
    const sub = await this.current(userId);
    if (sub.plan === Plan.free) {
      throw new AppException('invalid_request', '免费版无需取消');
    }
    return this.prisma.subscription.update({
      where: { id: sub.id },
      data: { status: 'canceled', canceledAt: new Date(), pendingPlan: Plan.free },
    });
  }

  /** 撤销取消（周期结束前可反悔） */
  async resume(userId: string): Promise<Subscription> {
    const sub = await this.current(userId);
    if (sub.status !== 'canceled') {
      throw new AppException('invalid_request', '当前订阅未处于已取消状态');
    }
    return this.prisma.subscription.update({
      where: { id: sub.id },
      data: { status: 'active', canceledAt: null, pendingPlan: null },
    });
  }

  // ---------- 内部 ----------

  /** 同档续期：仅延长有效期，当前配额周期不受影响 */
  private async renew(sub: Subscription, cycle: BillingCycle): Promise<Subscription> {
    if (sub.plan === Plan.free) {
      return sub;
    }
    const base = sub.expiresAt && sub.expiresAt > new Date() ? sub.expiresAt : new Date();
    const extended = new Date(base.getTime() + (cycle === 'yearly' ? YEAR_MS : PERIOD_MS));
    return this.prisma.subscription.update({
      where: { id: sub.id },
      data: { cycle, expiresAt: extended, status: 'active', canceledAt: null, pendingPlan: null },
    });
  }

  /**
   * 惰性周期滚动。当前周期已结束时推进到包含此刻的周期，并应用 pendingPlan。
   * 用户长期未访问可能跨越多个周期，这里一次算到位而非逐周期循环。
   */
  private async roll(sub: Subscription): Promise<Subscription> {
    const now = new Date();
    if (now < sub.currentPeriodEnd) {
      return sub;
    }

    // 订阅整体到期，或已申请取消且周期已走完 → 回落免费版
    const reachedExpiry = sub.expiresAt !== null && now >= sub.expiresAt;
    if (reachedExpiry || sub.status === 'canceled') {
      return this.expireAndFallback(sub);
    }

    const elapsed = now.getTime() - sub.currentPeriodStart.getTime();
    const periods = Math.floor(elapsed / PERIOD_MS);
    const start = new Date(sub.currentPeriodStart.getTime() + periods * PERIOD_MS);
    // 在任何写入之前取快照：写入后再读 sub 的字段，取到的可能已是新值
    const previousPlan = sub.plan;
    const userId = sub.userId;
    const nextPlan = sub.pendingPlan ?? previousPlan;
    const entitlement = this.entitlementFor(nextPlan);

    this.logger.log(`订阅 ${sub.id} 周期滚动至 ${start.toISOString()}（套餐 ${nextPlan}）`);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.subscription.update({
        where: { id: sub.id },
        data: {
          plan: nextPlan,
          pendingPlan: null,
          currentPeriodStart: start,
          currentPeriodEnd: new Date(start.getTime() + PERIOD_MS),
          ...entitlement,
        },
      });
      if (nextPlan !== previousPlan) {
        await this.syncUser(tx, userId, nextPlan, entitlement.quotaTokens);
      }
      return updated;
    });
  }

  /** 结束当前订阅并开启免费版 */
  private async expireAndFallback(sub: Subscription): Promise<Subscription> {
    this.logger.log(`订阅 ${sub.id} 已到期，回落免费版`);
    const now = new Date();
    const entitlement = this.entitlementFor(Plan.free);

    return this.prisma.$transaction(async (tx) => {
      await tx.subscription.update({ where: { id: sub.id }, data: { status: 'expired' } });
      const created = await tx.subscription.create({
        data: {
          userId: sub.userId,
          plan: Plan.free,
          cycle: 'monthly',
          status: 'active',
          currentPeriodStart: now,
          currentPeriodEnd: new Date(now.getTime() + PERIOD_MS),
          expiresAt: null,
          ...entitlement,
        },
      });
      await this.syncUser(tx, sub.userId, Plan.free, entitlement.quotaTokens);
      return created;
    });
  }

  /** 开通免费版（注册时调用，也用于缺失订阅的兜底修复） */
  async openFree(userId: string): Promise<Subscription> {
    const now = new Date();
    const entitlement = this.entitlementFor(Plan.free);
    return this.prisma.subscription.create({
      data: {
        userId,
        plan: Plan.free,
        cycle: 'monthly',
        status: 'active',
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + PERIOD_MS),
        expiresAt: null,
        ...entitlement,
      },
    });
  }

  private entitlementFor(plan: Plan): PlanEntitlement {
    const id = plan as unknown as PlanId;
    return {
      quotaTokens: quotaForPlan(id),
      monthlyImages: imageLimitsForPlan(id).monthlyImages,
    };
  }

  /** 付费订阅必须有明确到期日；免费版永不过期 */
  private expiryFor(plan: Plan, cycle: BillingCycle, from: Date): Date | null {
    if (plan === Plan.free) return null;
    return new Date(from.getTime() + (cycle === 'yearly' ? YEAR_MS : PERIOD_MS));
  }

  /** users 上的 plan / quota_tokens 是冗余快照，只在此处同步，避免多点写入 */
  private async syncUser(
    tx: Prisma.TransactionClient,
    userId: string,
    plan: Plan,
    quotaTokens: number,
  ): Promise<void> {
    await tx.user.update({ where: { id: userId }, data: { plan, quotaTokens } });
  }
}
