import { Injectable } from '@nestjs/common';
import { Prisma, UsageFeature } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppException } from '../../common/errors';
import { QuotaService } from '../../common/quota.service';
import { SubscriptionService } from '../billing/subscription.service';
import { estimateCost, ModelId } from '../../ai/models';

export interface QuotaInfo {
  quota: number;
  used: number;
  remaining: number;
}

export interface RecordUsageParams {
  userId: string;
  feature: UsageFeature;
  /** 文本模型或图像模型 id，原样落库便于按模型聚合 */
  model: string;
  inputTokens: number;
  outputTokens: number;
  cached?: boolean;
  /** 覆盖自动估价（图像按张计价时使用） */
  cost?: number;
  messageId?: string;
  creationId?: string;
  mediaAssetId?: string;
  /** 有值时重复写入会命中唯一约束并幂等返回已有成本 */
  idempotencyKey?: string;
}

@Injectable()
export class UsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quota: QuotaService,
    private readonly subscriptions: SubscriptionService,
  ) {}

  /**
   * 指定区间内消耗的 token 总数（input + output）。
   * 仅在计数器尚未建立时作为回退口径使用。
   */
  async usedTokensBetween(userId: string, start: Date, end: Date): Promise<number> {
    const agg = await this.prisma.usageRecord.aggregate({
      where: { userId, createdAt: { gte: start, lt: end } },
      _sum: { inputTokens: true, outputTokens: true },
    });
    return (agg._sum.inputTokens ?? 0) + (agg._sum.outputTokens ?? 0);
  }

  /**
   * 当前配额信息（quota=0 视为不限）。
   * 额度与周期均取自订阅，已用量以计数器为准，未建立时回落到本周期的流水聚合。
   */
  async quotaInfo(userId: string): Promise<QuotaInfo> {
    const sub = await this.subscriptions.current(userId);
    const quota = sub.quotaTokens;
    const counted = await this.quota.used(userId, this.subscriptions.periodKey(sub), 'tokens');
    const used =
      counted ??
      (await this.usedTokensBetween(userId, sub.currentPeriodStart, sub.currentPeriodEnd));
    return { quota, used, remaining: Math.max(0, quota - used) };
  }

  /**
   * 前置快速失败：额度已用尽时在任何副作用（落库 / 调模型）之前拒绝。
   * 这里不做预留，真正的准入由 reserveTokens 在调模型前原子完成。
   */
  async assertQuota(userId: string): Promise<QuotaInfo> {
    const info = await this.quotaInfo(userId);
    if (info.quota > 0 && info.used >= info.quota) {
      throw new AppException('rate_limited', '本周期 Token 配额已用尽，请等待周期重置或升级套餐', {
        quota: info,
      });
    }
    return info;
  }

  /**
   * 原子预留 token 额度。超出配额抛 429。
   * 因为调用前无法得知真实消耗，这里预留的是保守估算量，事后由 settleTokens 修正。
   */
  async reserveTokens(userId: string, estimated: number): Promise<void> {
    const sub = await this.subscriptions.current(userId);
    const period = this.subscriptions.periodKey(sub);
    const counted = await this.quota.used(userId, period, 'tokens');
    const ok = await this.quota.reserve({
      userId,
      period,
      kind: 'tokens',
      amount: estimated,
      quota: sub.quotaTokens,
      backfill:
        counted ??
        (await this.usedTokensBetween(userId, sub.currentPeriodStart, sub.currentPeriodEnd)),
    });
    if (!ok) {
      const info = await this.quotaInfo(userId);
      throw new AppException('rate_limited', '本周期 Token 配额不足，请等待周期重置或升级套餐', {
        quota: info,
        period_end: sub.currentPeriodEnd,
      });
    }
  }

  /** 把预留量修正为实际消耗 */
  async settleTokens(userId: string, reserved: number, actual: number): Promise<void> {
    const sub = await this.subscriptions.current(userId);
    await this.quota.settle(
      userId,
      this.subscriptions.periodKey(sub),
      'tokens',
      actual - reserved,
    );
  }

  /**
   * 记录一次调用的用量与成本。
   * 传入 idempotencyKey 时写入唯一约束；重复落账（重试 / 双写）直接返回已有成本，不再插入。
   */
  async record(params: RecordUsageParams): Promise<number> {
    const cost =
      params.cost ??
      estimateCost(params.model as ModelId, params.inputTokens, params.outputTokens);

    try {
      await this.prisma.usageRecord.create({
        data: {
          userId: params.userId,
          feature: params.feature,
          model: params.model,
          inputTokens: params.inputTokens,
          outputTokens: params.outputTokens,
          cost,
          cached: params.cached ?? false,
          messageId: params.messageId,
          creationId: params.creationId,
          mediaAssetId: params.mediaAssetId,
          idempotencyKey: params.idempotencyKey,
        },
      });
      return cost;
    } catch (err) {
      if (
        params.idempotencyKey &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const existing = await this.prisma.usageRecord.findUnique({
          where: { idempotencyKey: params.idempotencyKey },
        });
        if (existing) {
          return Number(existing.cost);
        }
      }
      throw err;
    }
  }
}
