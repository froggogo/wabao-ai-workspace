import { ConfigService } from '@nestjs/config';
import { IMAGE_SIZES, imageStyleHint } from '@wabao/shared';
import { ImageAiService } from './image.service';

/** 用固定配置构造服务，便于分别测试 mock 模式与真实模式 */
function makeService(env: Record<string, string> = {}): ImageAiService {
  const config = {
    get: <T>(key: string): T | undefined => env[key] as unknown as T,
  } as ConfigService;
  return new ImageAiService(config);
}

/** 把 base64 结果还原为 SVG 文本 */
const toSvg = (b64: string) => Buffer.from(b64, 'base64').toString('utf8');

describe('ImageAiService（mock 模式）', () => {
  let service: ImageAiService;

  beforeEach(() => {
    service = makeService();
  });

  it('未配置 OPENAI_API_KEY 时进入 mock 模式', () => {
    expect(service.isMock).toBe(true);
  });

  it('配置了 API Key 则不是 mock 模式', () => {
    expect(makeService({ OPENAI_API_KEY: 'sk-test' }).isMock).toBe(false);
  });

  describe('buildPrompt', () => {
    it('auto 风格不追加提示词', () => {
      expect(service.buildPrompt('一只青蛙', 'auto')).toBe('一只青蛙');
    });

    it('具体风格追加对应的风格提示词', () => {
      const out = service.buildPrompt('一只青蛙', 'photo');
      expect(out).toContain('一只青蛙');
      expect(out).toContain(imageStyleHint('photo'));
    });
  });

  describe('generate', () => {
    it('按请求张数返回对应数量的图片', async () => {
      const out = await service.generate({
        prompt: '星云中的青蛙',
        model: 'gpt-image-2-mini',
        size: '1024x1024',
        style: 'auto',
        count: 3,
      });
      expect(out).toHaveLength(3);
      for (const img of out) {
        expect(img.mimeType).toBe('image/svg+xml');
        expect(img.b64.length).toBeGreaterThan(0);
      }
    });

    it('产出结构合法的 SVG，且尺寸与所选比例一致', async () => {
      const size = '1536x1024';
      const dim = IMAGE_SIZES.find((s) => s.id === size)!;
      const [img] = await service.generate({
        prompt: '横版风景',
        model: 'gpt-image-2-mini',
        size,
        style: 'auto',
        count: 1,
      });
      const svg = toSvg(img.b64);
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
      expect(svg).toContain(`viewBox="0 0 ${dim.width} ${dim.height}"`);
      expect(svg).toContain(`width="${dim.width}"`);
      expect(svg).toContain(`height="${dim.height}"`);
    });

    it('同一 prompt 生成结果确定性一致（便于回归比对）', async () => {
      const params = {
        prompt: '确定性测试',
        model: 'gpt-image-2-mini' as const,
        size: '1024x1024' as const,
        style: 'auto' as const,
        count: 1,
      };
      const [a] = await service.generate(params);
      const [b] = await service.generate(params);
      expect(a.b64).toBe(b.b64);
    });

    it('不同 prompt 产出不同图片', async () => {
      const base = {
        model: 'gpt-image-2-mini' as const,
        size: '1024x1024' as const,
        style: 'auto' as const,
        count: 1,
      };
      const [a] = await service.generate({ ...base, prompt: '青蛙' });
      const [b] = await service.generate({ ...base, prompt: '宇航员' });
      expect(a.b64).not.toBe(b.b64);
    });

    it('批量生成时每张图片各不相同（避免重复出图）', async () => {
      const out = await service.generate({
        prompt: '同一描述批量出图',
        model: 'gpt-image-2-mini',
        size: '1024x1024',
        style: 'auto',
        count: 3,
      });
      expect(new Set(out.map((o) => o.b64)).size).toBe(3);
    });

    it('revisedPrompt 包含风格提示词（体现最终送模型的 prompt）', async () => {
      const [img] = await service.generate({
        prompt: '水墨山水',
        model: 'gpt-image-2-mini',
        size: '1024x1024',
        style: 'inkwash',
        count: 1,
      });
      expect(img.revisedPrompt).toContain('水墨山水');
      expect(img.revisedPrompt).toContain(imageStyleHint('inkwash'));
    });

    it('图中标注尺寸与风格，便于肉眼核对参数传递', async () => {
      const [img] = await service.generate({
        prompt: '标注校验',
        model: 'gpt-image-2-mini',
        size: '1024x1536',
        style: 'anime',
        count: 1,
      });
      const svg = toSvg(img.b64);
      expect(svg).toContain('1024x1536');
      expect(svg).toContain('anime');
      expect(svg).toContain('mock');
    });

    it('对 XML 特殊字符做转义，避免生成非法 SVG', async () => {
      // 注意：图中标签只取 prompt 前 28 个字符，故特殊字符需落在前缀内才会出现在 SVG 里
      const [img] = await service.generate({
        prompt: 'A & B <script>alert("x")</script>',
        model: 'gpt-image-2-mini',
        size: '1024x1024',
        style: 'auto',
        count: 1,
      });
      const svg = toSvg(img.b64);
      expect(svg).not.toContain('<script>');
      expect(svg).toContain('&lt;script&gt;');
      expect(svg).toContain('&amp;');
      expect(svg).toContain('&quot;');
    });

    it('非法尺寸回退到默认尺寸而非抛错', async () => {
      const [img] = await service.generate({
        prompt: '回退测试',
        model: 'gpt-image-2-mini',
        size: '4096x4096' as never,
        style: 'auto',
        count: 1,
      });
      const fallback = IMAGE_SIZES[0];
      expect(toSvg(img.b64)).toContain(`viewBox="0 0 ${fallback.width} ${fallback.height}"`);
    });
  });

  describe('variation', () => {
    it('返回 1 张变体图，且与源图不同', async () => {
      const [origin] = await service.generate({
        prompt: '源图',
        model: 'gpt-image-2-mini',
        size: '1024x1024',
        style: 'auto',
        count: 1,
      });
      const out = await service.variation({
        image: Buffer.from(origin.b64, 'base64'),
        mimeType: 'image/svg+xml',
        prompt: '源图',
        model: 'gpt-image-2-mini',
        size: '1024x1024',
      });
      expect(out).toHaveLength(1);
      expect(out[0].b64).not.toBe(origin.b64);
    });

    it('变体沿用请求的尺寸', async () => {
      const out = await service.variation({
        image: Buffer.from('fake'),
        mimeType: 'image/png',
        prompt: '竖版变体',
        model: 'gpt-image-2-mini',
        size: '1024x1536',
      });
      expect(toSvg(out[0].b64)).toContain('viewBox="0 0 1024 1536"');
    });
  });

  describe('analyzeStream（看图问答）', () => {
    it('流式产出非空文本，且包含问题摘要', async () => {
      let text = '';
      for await (const delta of service.analyzeStream({
        imageUrls: ['/uploads/a.png'],
        question: '这张图表说明了什么？',
      })) {
        text += delta;
      }
      expect(text.length).toBeGreaterThan(0);
      expect(text).toContain('这张图表说明了什么？');
      // mock 模式应明确标注，避免被误认为真实模型输出
      expect(text).toContain('mock');
    });

    it('回显图片张数', async () => {
      let text = '';
      for await (const delta of service.analyzeStream({
        imageUrls: ['/uploads/a.png', '/uploads/b.png'],
        question: '对比这两张图',
      })) {
        text += delta;
      }
      expect(text).toContain('2 张图片');
    });

    it('过长问题被截断并加省略号', async () => {
      const long = '很长的问题'.repeat(20);
      let text = '';
      for await (const delta of service.analyzeStream({
        imageUrls: ['/uploads/a.png'],
        question: long,
      })) {
        text += delta;
      }
      expect(text).toContain('…');
      expect(text).not.toContain(long);
    });

    it('signal 中断后停止产出', async () => {
      const ac = new AbortController();
      let count = 0;
      for await (const _ of service.analyzeStream({
        imageUrls: ['/uploads/a.png'],
        question: '中断测试',
        signal: ac.signal,
      })) {
        count++;
        if (count === 3) ac.abort();
        if (count > 20) break;
      }
      // 中断后生成器应尽快结束，不会跑完全文
      expect(count).toBeLessThanOrEqual(4);
    });
  });

  describe('analyzeStream（图 → 文案）', () => {
    /** 收集完整输出 */
    async function run(systemPrompt: string): Promise<string> {
      let text = '';
      for await (const d of service.analyzeStream({
        imageUrls: ['/uploads/a.png'],
        question: '请根据我提供的图片撰写文案。',
        systemPrompt,
      })) {
        text += d;
      }
      return text;
    }

    it('带 systemPrompt 时产出文案，而非画面解读', async () => {
      const text = await run('写成小红书风格笔记');
      // 不应再出现看图问答的固定结构
      expect(text).not.toContain('画面主体');
      expect(text.length).toBeGreaterThan(0);
    });

    it('小红书体裁包含话题标签', async () => {
      const text = await run('写成小红书风格笔记：标题、正文、话题标签');
      expect(text).toContain('#');
    });

    it('电商体裁输出卖点清单', async () => {
      const text = await run('写成电商商品详情文案，用要点列出卖点');
      expect(text).toContain('- ');
    });

    it('无障碍描述保持客观、不含营销语言与话题标签', async () => {
      const text = await run('写成无障碍替代文本（alt text）：客观描述画面');
      expect(text).not.toContain('#');
      expect(text).toContain('画面');
    });

    it('短文案体裁产出简短内容', async () => {
      const text = await run('写成社交平台短文案：50 字以内');
      expect(text.length).toBeLessThan(100);
    });

    it('未匹配到特定体裁时回退为通用文案', async () => {
      const text = await run('写成某种未知体裁');
      expect(text.length).toBeGreaterThan(0);
      expect(text).toContain('mock');
    });
  });
});
