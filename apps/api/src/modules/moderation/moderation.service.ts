import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { PrismaService } from '../../prisma/prisma.service';
import { ModerationAction, ModerationRefType } from '@prisma/client';

export interface ModerationResult {
  flagged: boolean;
  categories: string[];
  action: ModerationAction;
}

/**
 * M9 审核（后端内嵌能力）：对话/创作在调用模型前后自动执行。
 * - 有 Key：调用 OpenAI Moderation。
 * - 无 Key：本地关键词回退（演示）。
 * 命中 block 策略时上层应返回 content_flagged。
 */
@Injectable()
export class ModerationService {
  private readonly logger = new Logger('Moderation');
  private readonly client: OpenAI | null;
  private readonly blockWords = ['暴力', '违法', '血腥', '恐怖袭击'];

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    const baseURL = this.config.get<string>('OPENAI_BASE_URL') || undefined;
    this.client = apiKey ? new OpenAI({ apiKey, baseURL }) : null;
  }

  async check(
    text: string,
    refType: ModerationRefType,
    opts?: { userId?: string; refId?: string },
  ): Promise<ModerationResult> {
    const result = this.client ? await this.checkRemote(text) : this.checkLocal(text);

    await this.prisma.moderationRecord.create({
      data: {
        userId: opts?.userId,
        refType,
        refId: opts?.refId,
        flagged: result.flagged,
        categories: result.categories,
        action: result.action,
      },
    });

    return result;
  }

  /** 审核记录只读查询（M9 审计）：默认查当前用户，可按 flagged / ref_type 过滤 */
  async listRecords(
    userId: string,
    opts: { page?: number; pageSize?: number; flagged?: boolean; refType?: ModerationRefType } = {},
  ) {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
    const where = {
      userId,
      ...(opts.flagged !== undefined ? { flagged: opts.flagged } : {}),
      ...(opts.refType ? { refType: opts.refType } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.moderationRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.moderationRecord.count({ where }),
    ]);
    return {
      data: items.map((r) => ({
        id: r.id,
        ref_type: r.refType,
        ref_id: r.refId,
        flagged: r.flagged,
        categories: r.categories,
        action: r.action,
        created_at: r.createdAt,
      })),
      pagination: { page, page_size: pageSize, total },
    };
  }

  private checkLocal(text: string): ModerationResult {
    const hit = this.blockWords.filter((w) => text.includes(w));
    return {
      flagged: hit.length > 0,
      categories: hit,
      action: hit.length > 0 ? ModerationAction.block : ModerationAction.warn,
    };
  }

  private async checkRemote(text: string): Promise<ModerationResult> {
    try {
      const resp = await this.client!.moderations.create({
        model: 'omni-moderation-latest',
        input: text,
      });
      const r = resp.results[0];
      const categories = Object.entries(r.categories)
        .filter(([, v]) => v)
        .map(([k]) => k);
      return {
        flagged: r.flagged,
        categories,
        action: r.flagged ? ModerationAction.block : ModerationAction.warn,
      };
    } catch (e) {
      this.logger.warn(`Moderation 上游异常，降级放行：${(e as Error).message}`);
      return { flagged: false, categories: [], action: ModerationAction.warn };
    }
  }
}
