// 模型清单与校验来自前后端共享契约包，避免两端漂移。
import { ModelId, DEFAULT_MODEL } from '@wabao/shared';
export { MODELS, DEFAULT_MODEL, isValidModel } from '@wabao/shared';
export type { ModelId, ModelInfo } from '@wabao/shared';

/** 每 1K token 的估算成本（人民币，示意值，用于用量/计费展示） */
export const MODEL_PRICE_PER_1K: Record<ModelId, { input: number; output: number }> = {
  'gpt-5.6-sol': { input: 0.02, output: 0.06 },
  'gpt-5.6-terra': { input: 0.008, output: 0.024 },
  'gpt-5.6-luna': { input: 0.002, output: 0.006 },
};

export function estimateCost(model: ModelId, inputTokens: number, outputTokens: number): number {
  const price = MODEL_PRICE_PER_1K[model] ?? MODEL_PRICE_PER_1K[DEFAULT_MODEL];
  const cost = (inputTokens / 1000) * price.input + (outputTokens / 1000) * price.output;
  return Math.round(cost * 10000) / 10000;
}

/**
 * 粗略 token 估算（无 tokenizer 依赖，仅在拿不到上游真实 usage 时兜底）：
 * - 中日韩表意文字按 ~1.5 token/字（GPT 系分词器对中文通常 1 字≈1~2 token）；
 * - 其余字符（英文/数字/标点/空格）按 ~4 字符/token。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/gu) ?? []).length;
  const other = [...text].length - cjk;
  return Math.max(1, Math.ceil(cjk * 1.5 + other / 4));
}
