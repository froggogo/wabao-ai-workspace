import { RouterService } from './router.service';
import { DEFAULT_MODEL } from './models';

describe('RouterService', () => {
  const router = new RouterService();

  it('保留合法模型', () => {
    expect(router.resolve('gpt-5.6-sol')).toBe('gpt-5.6-sol');
    expect(router.resolve('gpt-5.6-luna')).toBe('gpt-5.6-luna');
  });

  it('非法或缺省时兜底为默认模型（Terra）', () => {
    expect(router.resolve(undefined)).toBe(DEFAULT_MODEL);
    expect(router.resolve('unknown-model')).toBe(DEFAULT_MODEL);
    expect(router.resolve('')).toBe(DEFAULT_MODEL);
  });
});
