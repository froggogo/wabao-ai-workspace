import { Injectable } from '@nestjs/common';
import { UsageFeature } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppException } from '../../common/errors';
import { estimateCost, ModelId } from '../../ai/models';

export interface QuotaInfo {
  quota: number;
  used: number;
  remaining: number;
}

@Injectable()
export class UsageService {
  constructor(private readonly prisma: PrismaService) {}

  /** 当月已消耗的 token 总数（input + output） */
  async monthlyUsedTokens(userId: string, at: Date = new Date()): Promise<number> {
    const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
    const end = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
    const agg = await this.prisma.usageRecord.aggregate({
      where: { userId, createdAt: { gte: start, lt: end } },
      _sum: { inputTokens: true, outputTokens: true },
    });
    return (agg._sum.inputTokens ?? 0) + (agg._sum.outputTokens ?? 0);
  }

  /** 返回当前配额信息（quota=0 视为不限） */
  async quotaInfo(userId: string): Promise<QuotaInfo> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const quota = user?.quotaTokens ?? 0;
    const used = await this.monthlyUsedTokens(userId);
    return { quota, used, remaining: Math.max(0, quota - used) };
  }

  /** 配额强制：已用尽则抛 429 rate_limited，携带 details.quota */
  async assertQuota(userId: string): Promise<QuotaInfo> {
    const info = await this.quotaInfo(userId);
    if (info.quota > 0 && info.used >= info.quota) {
      throw new AppException('rate_limited', '本月 Token 配额已用尽，请次月再试或升级套餐', {
        quota: info,
      });
    }
    return info;
  }

  /** 记录一次调用的用量与成本（M10/M12 计量） */
  async record(params: {
    userId: string;
    feature: UsageFeature;
    model: ModelId;
    inputTokens: number;
    outputTokens: number;
    cached?: boolean;
  }): Promise<number> {
    const cost = estimateCost(params.model, params.inputTokens, params.outputTokens);
    await this.prisma.usageRecord.create({
      data: {
        userId: params.userId,
        feature: params.feature,
        model: params.model,
        inputTokens: params.inputTokens,
        outputTokens: params.outputTokens,
        cost,
        cached: params.cached ?? false,
      },
    });
    return cost;
  }
}
