import { Injectable } from '@nestjs/common';
import { Plan } from '@prisma/client';
import { PlanId, imageLimitsForPlan, PlanImageLimit } from '@wabao/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AppException } from '../../common/errors';

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
 * 与 Token 配额分开统计：图像按「张数/月」计费，Token 按「量/月」计费。
 * 统计口径为当月 media_assets 中 source != upload 的记录数（生成 + 变体）。
 */
@Injectable()
export class ImageQuotaService {
  constructor(private readonly prisma: PrismaService) {}

  private monthRange(at: Date = new Date()): { start: Date; end: Date } {
    return {
      start: new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)),
      end: new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1)),
    };
  }

  /** 当月已生成图片张数（不含用户上传） */
  async monthlyGeneratedCount(userId: string, at: Date = new Date()): Promise<number> {
    const { start, end } = this.monthRange(at);
    return this.prisma.mediaAsset.count({
      where: {
        userId,
        source: { in: ['generation', 'variation'] },
        createdAt: { gte: start, lt: end },
      },
    });
  }

  async info(userId: string): Promise<ImageQuotaInfo> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AppException('not_found', '用户不存在');
    }
    const plan = user.plan as unknown as PlanId;
    const limits = imageLimitsForPlan(plan);
    const used = await this.monthlyGeneratedCount(userId);
    const quota = limits.monthlyImages;
    return {
      plan,
      limits,
      quota,
      used,
      remaining: quota === 0 ? Number.MAX_SAFE_INTEGER : Math.max(0, quota - used),
    };
  }

  /**
   * 生成前校验：配额是否够本次请求的张数。
   * 超额抛 429 rate_limited，前端据此引导升级套餐。
   */
  async assertQuota(userId: string, count: number): Promise<ImageQuotaInfo> {
    const info = await this.info(userId);
    if (info.quota > 0 && info.used + count > info.quota) {
      throw new AppException(
        'rate_limited',
        `本月 AI 绘图额度不足（已用 ${info.used}/${info.quota} 张），请升级套餐或等待次月重置`,
        { quota: { quota: info.quota, used: info.used, remaining: info.remaining } },
      );
    }
    return info;
  }

  /** 取用户套餐（用于模型/风格/批量数的权限校验） */
  async planOf(userId: string): Promise<PlanId> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true },
    });
    return (user?.plan ?? Plan.free) as unknown as PlanId;
  }
}
