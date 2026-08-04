import { Injectable } from '@nestjs/common';
import { Plan } from '@prisma/client';
import { PlanId, imageLimitsForPlan, PlanImageLimit } from '@wabao/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AppException } from '../../common/errors';
import { QuotaService } from '../../common/quota.service';
import { SubscriptionService } from '../billing/subscription.service';

export interface ImageQuotaInfo {
  /** 每月可生成张数，0 表示不限量 */
  quota: number;
  used: number;
  remaining: number;
  limits: PlanImageLimit;
  plan: PlanId;
}

/**
 * 图像配额计量（M5 + M12）。
 * 与 Token 配额分开统计：图像按「张数 / 订阅周期」计费，Token 按「量 / 订阅周期」计费。
 * 计数器未建立时，回退口径为本周期内 media_assets 中 source != upload 的记录数。
 */
@Injectable()
export class ImageQuotaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quota: QuotaService,
    private readonly subscriptions: SubscriptionService,
  ) {}

  /** 指定区间内已生成的图片张数（不含用户上传） */
  async generatedCountBetween(userId: string, start: Date, end: Date): Promise<number> {
    return this.prisma.mediaAsset.count({
      where: {
        userId,
        source: { in: ['generation', 'variation'] },
        createdAt: { gte: start, lt: end },
      },
    });
  }

  async info(userId: string): Promise<ImageQuotaInfo> {
    const sub = await this.subscriptions.current(userId);
    const plan = sub.plan as unknown as PlanId;
    const limits = imageLimitsForPlan(plan);
    // 计数器是权威值（含尚未落库的预留）；未建立时回落到本周期的资产计数
    const counted = await this.quota.used(userId, this.subscriptions.periodKey(sub), 'images');
    const used =
      counted ??
      (await this.generatedCountBetween(userId, sub.currentPeriodStart, sub.currentPeriodEnd));
    const quota = sub.monthlyImages;
    return {
      plan,
      limits,
      quota,
      used,
      remaining: quota === 0 ? Number.MAX_SAFE_INTEGER : Math.max(0, quota - used),
    };
  }

  /**
   * 生成前原子预留 count 张额度，超额抛 429，前端据此引导升级套餐。
   *
   * 图像按张计费，必须在调用模型**之前**把额度占住：先查后写的写法在并发下
   * 会让多个请求同时通过校验，直接造成超发。生成失败时由调用方 release 归还。
   */
  async reserve(userId: string, count: number): Promise<ImageQuotaInfo> {
    const sub = await this.subscriptions.current(userId);
    const info = await this.info(userId);
    const ok = await this.quota.reserve({
      userId,
      period: this.subscriptions.periodKey(sub),
      kind: 'images',
      amount: count,
      quota: info.quota,
      backfill: info.used,
    });
    if (!ok) {
      throw new AppException(
        'rate_limited',
        `本周期 AI 绘图额度不足（已用 ${info.used}/${info.quota} 张），请升级套餐或等待周期重置`,
        {
          quota: { quota: info.quota, used: info.used, remaining: info.remaining },
          period_end: sub.currentPeriodEnd,
        },
      );
    }
    return info;
  }

  /** 归还未实际产出的预留张数 */
  async release(userId: string, count: number): Promise<void> {
    const sub = await this.subscriptions.current(userId);
    await this.quota.release(userId, this.subscriptions.periodKey(sub), 'images', count);
  }

  /** 取用户套餐（用于模型/风格/批量数的权限校验） */
  async planOf(userId: string): Promise<PlanId> {
    const sub = await this.subscriptions.current(userId);
    return sub.plan as unknown as PlanId;
  }
}
