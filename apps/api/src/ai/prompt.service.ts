import { Injectable } from '@nestjs/common';

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface TemplateField {
  key: string;
  label: string;
  type: string;
}

/** Prompt 中心化组装（M1 对话上下文 / M3 模板套用） */
@Injectable()
export class PromptService {
  /** 组装对话上下文：system_prompt + 历史消息 + 本条 */
  buildChatMessages(params: {
    systemPrompt?: string | null;
    history: { role: 'user' | 'assistant'; content: string }[];
    userContent: string;
  }): ChatTurn[] {
    const turns: ChatTurn[] = [];
    const sys = params.systemPrompt?.trim();
    turns.push({
      role: 'system',
      content: sys && sys.length > 0 ? sys : '你是蛙宝，一个乐于助人、回答简洁清晰的通用 AI 助手。',
    });
    for (const h of params.history) {
      turns.push({ role: h.role, content: h.content });
    }
    turns.push({ role: 'user', content: params.userContent });
    return turns;
  }

  /** 套用模板 prompt + 用户填写的字段 */
  buildCreationMessages(params: {
    templatePrompt: string;
    fields: TemplateField[];
    inputs: Record<string, unknown>;
    structured: boolean;
    outputSchema?: unknown;
  }): ChatTurn[] {
    const lines = params.fields.map((f) => {
      const val = params.inputs[f.key];
      return `- ${f.label}：${val === undefined || val === '' ? '（未填写）' : String(val)}`;
    });

    let system = params.templatePrompt || '你是内容创作助手，请根据用户输入生成高质量内容。';
    if (params.structured && params.outputSchema) {
      system += `\n\n请严格按以下 JSON Schema 输出，且只输出 JSON，不要包含多余文字：\n${JSON.stringify(
        params.outputSchema,
      )}`;
    }

    return [
      { role: 'system', content: system },
      { role: 'user', content: `请根据以下输入进行创作：\n${lines.join('\n')}` },
    ];
  }
}
