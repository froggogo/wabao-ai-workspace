import { Injectable } from '@nestjs/common';
import { Plan } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppException } from '../../common/errors';
import { ModelId } from '../../ai/models';
import { PLANS, PLAN_MAP, isModelAllowed, quotaForPlan } from './plans';

export type BillingCycle = 'monthly' | 'yearly';

@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService) {}

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
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AppException('not_found', '用户不存在');
    }
    const config = PLAN_MAP[user.plan] ?? PLAN_MAP[Plan.free];
    return {
      plan: user.plan,
      name: config.name,
      status: 'active',
      quota_tokens: user.quotaTokens,
      allowed_models: config.allowedModels,
    };
  }

  /**
   * 创建 / 变更订阅（原型：无支付，立即生效）。
   * 正式版应先创建订单 → 跳转支付 → Webhook 回调后再更新订阅与配额。
   */
  async subscribe(userId: string, plan: Plan, cycle: BillingCycle = 'monthly') {
    const config = PLAN_MAP[plan];
    if (!config) {
      throw new AppException('invalid_request', '未知的套餐');
    }
    // 企业版为定制方案，走销售流程，不在此直接开通
    if (plan === Plan.enterprise) {
      throw new AppException('invalid_request', '企业版为定制方案，请联系销售开通');
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { plan, quotaTokens: quotaForPlan(plan) },
    });

    return {
      plan: user.plan,
      name: config.name,
      cycle,
      status: 'active',
      quota_tokens: user.quotaTokens,
      allowed_models: config.allowedModels,
    };
  }

  /** 模型权限校验：当前套餐不可用则抛 403，引导升级 */
  async assertModelAllowed(userId: string, model: ModelId): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true },
    });
    const plan = user?.plan ?? Plan.free;
    if (!isModelAllowed(plan, model)) {
      const config = PLAN_MAP[plan];
      throw new AppException(
        'forbidden',
        `当前套餐「${config.name}」不可使用该模型，请升级后使用`,
        { plan, model, allowed_models: config.allowedModels },
      );
    }
  }
}
