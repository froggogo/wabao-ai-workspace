import { Injectable } from '@nestjs/common';
import { Prisma, Template } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppException } from '../../common/errors';
import { SseEvent } from '../../common/sse';
import { AiService } from '../../ai/ai.service';
import { RouterService } from '../../ai/router.service';
import { PromptService } from '../../ai/prompt.service';
import { estimateCost, estimateTokens } from '../../ai/models';
import { ModerationService } from '../moderation/moderation.service';
import { UsageService } from '../users/usage.service';
import { CreateCreationDto } from './dto/creations.dto';

interface TemplateField {
  key: string;
  label: string;
  type: string;
  required?: boolean;
}

@Injectable()
export class CreationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly router: RouterService,
    private readonly prompt: PromptService,
    private readonly moderation: ModerationService,
    private readonly usage: UsageService,
  ) {}

  // ---------- 模板 ----------

  async listTemplates(category?: string) {
    const items = await this.prisma.template.findMany({
      where: { enabled: true, ...(category ? { category } : {}) },
      orderBy: { id: 'asc' },
    });
    return items.map((t) => this.toTemplateDto(t));
  }

  async getTemplate(id: string) {
    const t = await this.prisma.template.findUnique({ where: { id } });
    if (!t || !t.enabled) {
      throw new AppException('not_found', '模板不存在');
    }
    return this.toTemplateDto(t);
  }

  // ---------- 创作历史 ----------

  async listCreations(userId: string) {
    const items = await this.prisma.creation.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return items.map((c) => this.toCreationDto(c));
  }

  async getCreation(userId: string, id: string) {
    const c = await this.prisma.creation.findUnique({ where: { id } });
    if (!c) throw new AppException('not_found', '创作记录不存在');
    if (c.userId !== userId) throw new AppException('forbidden', '无权访问该创作');
    return this.toCreationDto(c);
  }

  async removeCreation(userId: string, id: string): Promise<void> {
    const c = await this.prisma.creation.findUnique({ where: { id } });
    if (!c) throw new AppException('not_found', '创作记录不存在');
    if (c.userId !== userId) throw new AppException('forbidden', '无权访问该创作');
    await this.prisma.creation.delete({ where: { id } });
  }

  // ---------- 执行创作（流式） ----------

  async *create(userId: string, dto: CreateCreationDto): AsyncGenerator<SseEvent> {
    const template = await this.prisma.template.findUnique({ where: { id: dto.template_id } });
    if (!template || !template.enabled) {
      throw new AppException('not_found', '模板不存在');
    }

    const fields = this.parseFields(template);
    this.validateInputs(fields, dto.inputs);

    // 配额校验（超额抛 429）
    await this.usage.assertQuota(userId);

    const structured = template.outputSchema !== null && template.outputSchema !== undefined;
    const model = this.router.resolve('gpt-5.6-terra');

    // 输入审核
    const inputText = Object.values(dto.inputs).map(String).join('\n');
    const inMod = await this.moderation.check(inputText, 'input', { userId });

    // 预建创作记录以获取 id
    const creation = await this.prisma.creation.create({
      data: {
        userId,
        templateId: template.id,
        templateName: template.name,
        inputs: dto.inputs as Prisma.InputJsonValue,
        output: '',
      },
    });

    yield { event: 'message.start', data: { creation_id: creation.id, role: 'assistant' } };

    if (inMod.action === 'block') {
      yield {
        event: 'error',
        data: {
          code: 'content_flagged',
          message: '内容不符合规范，已被拦截',
          details: { categories: inMod.categories },
        },
      };
      return;
    }

    const turns = this.prompt.buildCreationMessages({
      templatePrompt: template.prompt,
      fields,
      inputs: dto.inputs,
      structured,
      outputSchema: template.outputSchema,
    });

    let acc = '';
    try {
      if (structured && this.ai.isMock) {
        // mock 模式下结构化模板：直接产出示例 JSON，保证 output_json 有效
        const sample = this.sampleJson(template.outputSchema);
        const text = JSON.stringify(sample, null, 2);
        for (const piece of text.match(/[\s\S]{1,3}/g) ?? [text]) {
          acc += piece;
          yield { event: 'message.delta', data: { text: piece } };
        }
      } else {
        for await (const delta of this.ai.stream(turns, model)) {
          acc += delta;
          yield { event: 'message.delta', data: { text: delta } };
        }
      }
    } catch (err) {
      yield {
        event: 'error',
        data: { code: 'upstream_error', message: `模型服务异常：${(err as Error).message}` },
      };
      return;
    }

    // 输出审核
    await this.moderation.check(acc, 'output', { userId, refId: creation.id });

    let outputJson: Prisma.InputJsonValue | undefined;
    if (structured) {
      outputJson = this.tryParseJson(acc);
    }

    const inputTokens = turns.reduce((s, t) => s + estimateTokens(t.content), 0);
    const outputTokens = estimateTokens(acc);

    await this.prisma.creation.update({
      where: { id: creation.id },
      data: {
        output: acc,
        outputJson: outputJson ?? Prisma.DbNull,
        inputTokens,
        outputTokens,
        cost: estimateCost(model, inputTokens, outputTokens),
      },
    });

    await this.usage.record({ userId, feature: 'studio', model, inputTokens, outputTokens });

    yield {
      event: 'message.done',
      data: {
        finish_reason: 'stop',
        creation_id: creation.id,
        output_json: outputJson ?? null,
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
      },
    };
  }

  // ---------- 辅助 ----------

  private parseFields(template: Template): TemplateField[] {
    const schema = template.inputSchema as { fields?: TemplateField[] };
    return schema?.fields ?? [];
  }

  private validateInputs(fields: TemplateField[], inputs: Record<string, unknown>): void {
    const missing = fields
      .filter((f) => f.required && (inputs[f.key] === undefined || inputs[f.key] === ''))
      .map((f) => f.label);
    if (missing.length > 0) {
      throw new AppException('invalid_request', `缺少必填项：${missing.join('、')}`);
    }
  }

  private tryParseJson(text: string): Prisma.InputJsonValue | undefined {
    try {
      const cleaned = text
        .trim()
        .replace(/^```(?:json)?/i, '')
        .replace(/```$/, '')
        .trim();
      return JSON.parse(cleaned) as Prisma.InputJsonValue;
    } catch {
      return undefined;
    }
  }

  private sampleJson(schema: unknown): Record<string, unknown> {
    const s = schema as { properties?: Record<string, { type?: string }> };
    const out: Record<string, unknown> = {};
    const demo: Record<string, string> = {
      name: '张三',
      phone: '13800000000',
      region: '华东区',
      role: '销售',
    };
    if (s?.properties) {
      for (const [key, def] of Object.entries(s.properties)) {
        if (def.type === 'number') out[key] = 0;
        else if (def.type === 'boolean') out[key] = true;
        else out[key] = demo[key] ?? '示例';
      }
    }
    return out;
  }

  private toTemplateDto(t: Template) {
    return {
      id: t.id,
      name: t.name,
      category: t.category,
      icon: t.icon,
      description: t.description,
      input_schema: t.inputSchema,
      output_schema: t.outputSchema,
      structured: t.outputSchema !== null,
    };
  }

  private toCreationDto(c: {
    id: string;
    templateId: string;
    templateName: string;
    inputs: unknown;
    output: string;
    outputJson: unknown;
    createdAt: Date;
  }) {
    return {
      id: c.id,
      template_id: c.templateId,
      template_name: c.templateName,
      inputs: c.inputs,
      output: c.output,
      output_json: c.outputJson,
      created_at: c.createdAt,
    };
  }
}
