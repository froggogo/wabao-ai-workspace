import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { ChatTurn } from './prompt.service';
import { ModelId } from './models';

/**
 * AI 编排层核心：统一对外提供「流式生成」能力。
 * - 配置了 OPENAI_API_KEY：调用 OpenAI Responses API（真实流式）。
 * - 未配置：进入 mock 模式，返回模拟流式内容，保证本地无 Key 也能跑通全链路。
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger('AiService');
  private readonly client: OpenAI | null;
  private readonly realModel: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    const baseURL = this.config.get<string>('OPENAI_BASE_URL') || undefined;
    this.realModel = this.config.get<string>('OPENAI_MODEL') || 'gpt-4o-mini';
    this.client = apiKey ? new OpenAI({ apiKey, baseURL }) : null;
    if (!this.client) {
      this.logger.warn('未配置 OPENAI_API_KEY，AI 运行在 mock 模式（返回模拟内容）。');
    }
  }

  get isMock(): boolean {
    return this.client === null;
  }

  /** 统一的流式生成：逐块产出文本增量 */
  async *stream(messages: ChatTurn[], model: ModelId, signal?: AbortSignal): AsyncGenerator<string> {
    if (this.client) {
      yield* this.streamOpenAI(messages, signal);
    } else {
      yield* this.streamMock(messages, model, signal);
    }
  }

  private async *streamOpenAI(messages: ChatTurn[], signal?: AbortSignal): AsyncGenerator<string> {
    const input = messages.map((m) => ({ role: m.role, content: m.content }));
    const response = await this.client!.responses.create(
      { model: this.realModel, input, stream: true },
      { signal },
    );
    for await (const event of response) {
      if (signal?.aborted) return;
      if (event.type === 'response.output_text.delta' && event.delta) {
        yield event.delta;
      }
    }
  }

  // ---- mock 实现（移植自前端原型 mockAI，保证契约一致的演示体验）----

  private async *streamMock(
    messages: ChatTurn[],
    model: ModelId,
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const full = this.mockReply(lastUser?.content ?? '', model);
    await this.sleep(200);
    for (const piece of full.match(/[\s\S]{1,2}/g) ?? [full]) {
      if (signal?.aborted) return;
      await this.sleep(14);
      yield piece;
    }
  }

  private mockReply(input: string, model: ModelId): string {
    const tag =
      model === 'gpt-5.6-sol'
        ? '（Sol · 深度推理）'
        : model === 'gpt-5.6-luna'
          ? '（Luna · 高速）'
          : '（Terra）';

    if (/你好|hi|hello|在吗/i.test(input)) {
      return `你好！我是蛙宝 AI 助手 ${tag}。我可以帮你写作、总结、答疑、写代码。试试问我一个问题，或去「创作」用模板一键生成内容 ✨`;
    }
    if (/周报/.test(input)) {
      return `${tag} 好的，这是一份周报草稿：\n\n# 本周工作周报\n\n## 本周完成\n- 完成 P1 后端核心链路\n- 打通对话 / 创作两条流式管线\n\n## 下周计划\n- 接入真实 OpenAI Key\n- 输出 OpenAPI 契约\n\n## 风险与需要支持\n- 需确认多模态成本预算`;
    }
    if (/代码|函数|bug|react|typescript/i.test(input)) {
      return `${tag} 参考实现：\n\n\`\`\`ts\nfunction sum(nums: number[]): number {\n  return nums.reduce((a, b) => a + b, 0);\n}\n\`\`\`\n\n思路：用 \`reduce\` 累加，时间复杂度 O(n)。`;
    }
    return `${tag} 收到你的问题：“${input.slice(0, 40)}${input.length > 40 ? '…' : ''}”。\n\n这是 mock 模式的模拟回答，用于演示**流式输出**与全链路。配置 OPENAI_API_KEY 后即可返回真实结果。`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
