import { ConfigService } from '@nestjs/config';
import { AiService } from './ai.service';
import { ChatTurn } from './prompt.service';

function makeConfig(values: Record<string, string | undefined>): ConfigService {
  return { get: (k: string) => values[k] } as unknown as ConfigService;
}

async function collect(gen: AsyncGenerator<string>): Promise<string> {
  let out = '';
  for await (const c of gen) out += c;
  return out;
}

describe('AiService (mock 模式)', () => {
  const ai = new AiService(makeConfig({}));

  it('未配置 Key 时进入 mock 模式', () => {
    expect(ai.isMock).toBe(true);
  });

  it('流式产出完整文本', async () => {
    const turns: ChatTurn[] = [{ role: 'user', content: '你好' }];
    const text = await collect(ai.stream(turns, 'gpt-5.6-terra'));
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain('蛙宝');
  });

  it('针对“周报”返回周报模板内容', async () => {
    const turns: ChatTurn[] = [{ role: 'user', content: '帮我写一份周报' }];
    const text = await collect(ai.stream(turns, 'gpt-5.6-sol'));
    expect(text).toContain('周报');
  });

  it('AbortSignal 触发后提前停止', async () => {
    const ac = new AbortController();
    ac.abort();
    const turns: ChatTurn[] = [{ role: 'user', content: '写一段很长的文字' }];
    const text = await collect(ai.stream(turns, 'gpt-5.6-terra', ac.signal));
    expect(text).toBe('');
  });
});
