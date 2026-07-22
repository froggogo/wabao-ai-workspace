export type ModelId = 'gpt-5.6-sol' | 'gpt-5.6-terra' | 'gpt-5.6-luna';

export const MODELS: { id: ModelId; name: string; desc: string }[] = [
  { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', desc: '旗舰推理 · 复杂任务' },
  { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', desc: '均衡 · 日常首选' },
  { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', desc: '高性价比 · 高并发' },
];

const MODEL_IDS = MODELS.map((m) => m.id);

export function isValidModel(model: string): model is ModelId {
  return (MODEL_IDS as string[]).includes(model);
}

export const DEFAULT_MODEL: ModelId = 'gpt-5.6-terra';

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

/** 粗略 token 估算：中英文混合按字符近似，避免额外依赖 tokenizer */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 2.5));
}
