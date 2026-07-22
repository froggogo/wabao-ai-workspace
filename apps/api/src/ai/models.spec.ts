import { estimateCost, estimateTokens, isValidModel, DEFAULT_MODEL, MODEL_PRICE_PER_1K } from './models';

describe('ai/models', () => {
  describe('isValidModel', () => {
    it('识别合法模型', () => {
      expect(isValidModel('gpt-5.6-sol')).toBe(true);
      expect(isValidModel('gpt-5.6-terra')).toBe(true);
      expect(isValidModel('gpt-5.6-luna')).toBe(true);
    });
    it('拒绝非法模型', () => {
      expect(isValidModel('gpt-4')).toBe(false);
      expect(isValidModel('')).toBe(false);
    });
  });

  describe('estimateTokens', () => {
    it('空字符串为 0', () => {
      expect(estimateTokens('')).toBe(0);
    });
    it('非空至少为 1，且随长度增长', () => {
      expect(estimateTokens('a')).toBeGreaterThanOrEqual(1);
      expect(estimateTokens('这是一段较长的中文文本用于估算')).toBeGreaterThan(estimateTokens('短'));
    });
  });

  describe('estimateCost', () => {
    it('按模型价目计算且非负', () => {
      const cost = estimateCost('gpt-5.6-sol', 1000, 1000);
      const price = MODEL_PRICE_PER_1K['gpt-5.6-sol'];
      expect(cost).toBeCloseTo(price.input + price.output, 4);
    });
    it('0 token 成本为 0', () => {
      expect(estimateCost(DEFAULT_MODEL, 0, 0)).toBe(0);
    });
    it('Sol 比 Luna 更贵', () => {
      expect(estimateCost('gpt-5.6-sol', 1000, 1000)).toBeGreaterThan(
        estimateCost('gpt-5.6-luna', 1000, 1000),
      );
    });
  });
});
