import { Injectable } from '@nestjs/common';
import { imageLimitsForPlan, PlanId } from '@wabao/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AppException } from '../../common/errors';
import { UpdateMeDto } from './dto/users.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AppException('not_found', '用户不存在');
    }
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      plan: user.plan,
      quota_tokens: user.quotaTokens,
      created_at: user.createdAt,
    };
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.avatar !== undefined ? { avatar: dto.avatar } : {}),
      },
    });
    return { id: user.id, email: user.email, name: user.name, avatar: user.avatar };
  }

  /** GET /usage?period=YYYY-MM */
  async usage(userId: string, period?: string) {
    const { start, end, label } = this.resolvePeriod(period);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AppException('not_found', '用户不存在');
    }

    const records = await this.prisma.usageRecord.groupBy({
      by: ['feature'],
      where: { userId, createdAt: { gte: start, lt: end } },
      _sum: { inputTokens: true, outputTokens: true, cost: true },
      _count: { _all: true },
    });

    const featureLabel: Record<string, string> = {
      chat: '对话',
      studio: '创作',
      image: 'AI 绘图',
      vision: '看图问答',
    };
    let usedTokens = 0;
    const breakdown = records.map((r) => {
      const tokens = (r._sum.inputTokens ?? 0) + (r._sum.outputTokens ?? 0);
      usedTokens += tokens;
      return {
        feature: r.feature,
        label: featureLabel[r.feature] ?? r.feature,
        calls: r._count._all,
        tokens,
        cost: Math.round((r._sum.cost ?? 0) * 100) / 100,
      };
    });

    // 图像按「张数/月」独立计量（与 Token 配额并列展示）
    const imageLimits = imageLimitsForPlan(user.plan as unknown as PlanId);
    const usedImages = await this.prisma.mediaAsset.count({
      where: {
        userId,
        source: { in: ['generation', 'variation'] },
        createdAt: { gte: start, lt: end },
      },
    });

    return {
      period: label,
      plan: user.plan,
      quota_tokens: user.quotaTokens,
      used_tokens: usedTokens,
      remaining_tokens: Math.max(0, user.quotaTokens - usedTokens),
      breakdown,
      images: {
        quota: imageLimits.monthlyImages,
        used: usedImages,
        remaining:
          imageLimits.monthlyImages === 0
            ? null
            : Math.max(0, imageLimits.monthlyImages - usedImages),
        vision: imageLimits.vision,
      },
    };
  }

  private resolvePeriod(period?: string): { start: Date; end: Date; label: string } {
    const now = new Date();
    let year = now.getUTCFullYear();
    let month = now.getUTCMonth(); // 0-based
    if (period && /^\d{4}-\d{2}$/.test(period)) {
      const [y, m] = period.split('-').map(Number);
      year = y;
      month = m - 1;
    }
    const start = new Date(Date.UTC(year, month, 1));
    const end = new Date(Date.UTC(year, month + 1, 1));
    const label = `${year}-${String(month + 1).padStart(2, '0')}`;
    return { start, end, label };
  }
}
