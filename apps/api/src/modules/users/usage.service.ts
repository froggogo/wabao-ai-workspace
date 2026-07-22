import { Injectable } from '@nestjs/common';
import { UsageFeature } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { estimateCost, ModelId } from '../../ai/models';

@Injectable()
export class UsageService {
  constructor(private readonly prisma: PrismaService) {}

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
