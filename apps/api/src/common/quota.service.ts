import { Global, Injectable, Module } from '@nestjs/common';
import { QuotaKind } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 配额的原子预留。
 *
 * 「先聚合 usage_records 求和判断够不够，再去调模型」这种写法在并发下必然超发：
 * N 个请求会同时读到同一个「已用量」并同时通过校验。这里把准入判断收敛成一条
 * 带条件的 UPSERT，由数据库对同一行的写锁天然串行化，从根本上消除竞态窗口。
 *
 * 用法是「先预留、后结算」：
 *   1. 调模型前 reserve() 一个保守估算量，占位失败即拒绝；
 *   2. 拿到真实用量后 settle(实际 - 预留) 修正；
 *   3. 调用失败则 release() 归还。
 * usage_records 仍然逐条记录，用于报表与对账，不再承担准入职责。
 */
@Injectable()
export class QuotaService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 原子预留 amount 个单位。
   *
   * @param period 计量周期标识，由 SubscriptionService 依当前订阅周期给出。
   * @param quota 0 表示不限量，直接放行。
   * @param backfill 计数器行尚不存在时的初始值，用于从历史流水平滑接管计量。
   * @returns 预留成功与否；false 表示会超出配额，调用方应拒绝请求。
   */
  async reserve(params: {
    userId: string;
    period: string;
    kind: QuotaKind;
    amount: number;
    quota: number;
    backfill?: number;
  }): Promise<boolean> {
    const { userId, period, kind, amount, quota, backfill = 0 } = params;
    if (quota <= 0) {
      // 不限量：仍然累加以保留用量视图，但不做上限判断
      await this.bump(userId, period, kind, amount, backfill);
      return true;
    }
    if (amount <= 0) {
      return true;
    }
    // 首次插入走 VALUES 分支，不受 DO UPDATE 的 WHERE 保护，需在此挡住
    if (backfill + amount > quota) {
      return false;
    }

    const affected = await this.prisma.$executeRaw`
      INSERT INTO "quota_counters" ("id", "user_id", "period", "kind", "used", "updated_at")
      VALUES (${randomUUID()}, ${userId}, ${period}, ${kind}::"QuotaKind", ${backfill + amount}, now())
      ON CONFLICT ("user_id", "period", "kind") DO UPDATE
        SET "used" = "quota_counters"."used" + ${amount}, "updated_at" = now()
        WHERE "quota_counters"."used" + ${amount} <= ${quota}
    `;
    return affected > 0;
  }

  /** 结算：把预留量修正为实际用量，delta 可为负 */
  async settle(userId: string, period: string, kind: QuotaKind, delta: number): Promise<void> {
    if (delta === 0) return;
    await this.bump(userId, period, kind, delta);
  }

  /** 归还预留（调用失败时回滚） */
  async release(userId: string, period: string, kind: QuotaKind, amount: number): Promise<void> {
    if (amount <= 0) return;
    await this.bump(userId, period, kind, -amount);
  }

  /** 读取指定周期已占用量；计数器尚未建立时返回 null，由调用方回落到历史流水 */
  async used(userId: string, period: string, kind: QuotaKind): Promise<number | null> {
    const row = await this.prisma.quotaCounter.findUnique({
      where: { userId_period_kind: { userId, period, kind } },
      select: { used: true },
    });
    return row?.used ?? null;
  }

  /** 无上限判断的原子增减，下限截断到 0 */
  private async bump(
    userId: string,
    period: string,
    kind: QuotaKind,
    delta: number,
    backfill = 0,
  ): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO "quota_counters" ("id", "user_id", "period", "kind", "used", "updated_at")
      VALUES (${randomUUID()}, ${userId}, ${period}, ${kind}::"QuotaKind", ${Math.max(0, backfill + delta)}, now())
      ON CONFLICT ("user_id", "period", "kind") DO UPDATE
        SET "used" = GREATEST(0, "quota_counters"."used" + ${delta}), "updated_at" = now()
    `;
  }
}

@Global()
@Module({
  providers: [QuotaService],
  exports: [QuotaService],
})
export class QuotaModule {}
