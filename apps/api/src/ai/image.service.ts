import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import {
  DEFAULT_IMAGE_MODEL,
  ImageModelId,
  ImageSizeId,
  ImageStyleId,
  IMAGE_SIZES,
  imageStyleHint,
} from '@wabao/shared';

export interface GeneratedImage {
  /** base64 编码的图片数据 */
  b64: string;
  mimeType: string;
  /** 模型可能改写过的 prompt */
  revisedPrompt?: string;
}

export interface ImageGenerateParams {
  prompt: string;
  model: ImageModelId;
  size: ImageSizeId;
  style: ImageStyleId;
  count: number;
  signal?: AbortSignal;
}

export interface ImageVariationParams {
  /** 源图片的绝对/相对路径的二进制内容 */
  image: Buffer;
  mimeType: string;
  prompt: string;
  model: ImageModelId;
  size: ImageSizeId;
  signal?: AbortSignal;
}

export interface VisionAnalyzeParams {
  /** 图片可访问 URL 或 data URI */
  imageUrls: string[];
  question: string;
  /** 可选的系统提示词（图 → 文案时用于指定渠道口吻与篇幅） */
  systemPrompt?: string;
  signal?: AbortSignal;
}

/**
 * M5 图像编排层：文生图 / 变体重绘 / 图像理解。
 * 与 AiService 保持一致的双模设计：
 * - 配置 OPENAI_API_KEY：调用 OpenAI Images / Responses(Vision) API。
 * - 未配置：mock 模式，按 prompt 哈希生成确定性的渐变 SVG 占位图，
 *   保证本地无 Key 也能完整演示「生成 → 画廊 → 变体 → 看图问答」全链路。
 */
@Injectable()
export class ImageAiService {
  private readonly logger = new Logger('ImageAiService');
  private readonly client: OpenAI | null;
  private readonly realImageModel: string;
  private readonly visionModel: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    const baseURL = this.config.get<string>('OPENAI_BASE_URL') || undefined;
    this.realImageModel = this.config.get<string>('OPENAI_IMAGE_MODEL') || 'gpt-image-1';
    this.visionModel = this.config.get<string>('OPENAI_VISION_MODEL') || 'gpt-4o-mini';
    this.client = apiKey ? new OpenAI({ apiKey, baseURL }) : null;
    if (!this.client) {
      this.logger.warn('未配置 OPENAI_API_KEY，图像能力运行在 mock 模式（生成占位图）。');
    }
  }

  get isMock(): boolean {
    return this.client === null;
  }

  /** 组装最终 prompt：用户输入 + 风格提示词 */
  buildPrompt(prompt: string, style: ImageStyleId): string {
    const hint = imageStyleHint(style);
    return hint ? `${prompt}。${hint}` : prompt;
  }

  // ---------------- 文生图 ----------------

  async generate(params: ImageGenerateParams): Promise<GeneratedImage[]> {
    const finalPrompt = this.buildPrompt(params.prompt, params.style);
    if (this.client) {
      return this.generateOpenAI(finalPrompt, params);
    }
    return this.generateMock(finalPrompt, params);
  }

  private async generateOpenAI(
    finalPrompt: string,
    params: ImageGenerateParams,
  ): Promise<GeneratedImage[]> {
    const res = await this.client!.images.generate(
      {
        model: this.realImageModel,
        prompt: finalPrompt,
        n: params.count,
        size: params.size,
      } as never,
      { signal: params.signal },
    );

    const items = (res as { data?: { b64_json?: string; url?: string; revised_prompt?: string }[] })
      .data;
    if (!items || items.length === 0) {
      throw new Error('图像服务未返回结果');
    }

    const out: GeneratedImage[] = [];
    for (const item of items) {
      if (item.b64_json) {
        out.push({
          b64: item.b64_json,
          mimeType: 'image/png',
          revisedPrompt: item.revised_prompt ?? finalPrompt,
        });
      } else if (item.url) {
        // 少数模型仅返回临时 URL，这里拉取转 base64，交由上层统一落盘
        const r = await fetch(item.url);
        const buf = Buffer.from(await r.arrayBuffer());
        out.push({
          b64: buf.toString('base64'),
          mimeType: r.headers.get('content-type')?.split(';')[0] ?? 'image/png',
          revisedPrompt: item.revised_prompt ?? finalPrompt,
        });
      }
    }
    return out;
  }

  // ---------------- 变体重绘 ----------------

  async variation(params: ImageVariationParams): Promise<GeneratedImage[]> {
    if (this.client) {
      const file = await OpenAI.toFile(params.image, 'source.png', { type: params.mimeType });
      const res = await this.client.images.edit(
        {
          model: this.realImageModel,
          image: file,
          prompt: params.prompt || '在保持主体与构图的基础上生成一个风格一致的变体',
          n: 1,
          size: params.size,
        } as never,
        { signal: params.signal },
      );
      const items = (res as { data?: { b64_json?: string; revised_prompt?: string }[] }).data ?? [];
      return items
        .filter((i) => i.b64_json)
        .map((i) => ({
          b64: i.b64_json as string,
          mimeType: 'image/png',
          revisedPrompt: i.revised_prompt ?? params.prompt,
        }));
    }

    // mock：基于源 prompt 派生一张不同配色的占位图
    return this.generateMock(`${params.prompt} · 变体`, {
      prompt: params.prompt,
      model: params.model,
      size: params.size,
      style: 'auto',
      count: 1,
    });
  }

  // ---------------- 图像理解（Vision） ----------------

  /** 看图问答：流式产出文本增量，与 AiService.stream 的契约保持一致 */
  async *analyzeStream(params: VisionAnalyzeParams): AsyncGenerator<string> {
    if (this.client) {
      yield* this.analyzeOpenAI(params);
      return;
    }
    yield* this.analyzeMock(params);
  }

  private async *analyzeOpenAI(params: VisionAnalyzeParams): AsyncGenerator<string> {
    const content: Record<string, unknown>[] = [{ type: 'input_text', text: params.question }];
    for (const url of params.imageUrls) {
      content.push({ type: 'input_image', image_url: url });
    }

    const input: Record<string, unknown>[] = [];
    // 系统提示词用于约束输出体裁（如小红书笔记 / alt text）
    if (params.systemPrompt?.trim()) {
      input.push({
        role: 'system',
        content: [{ type: 'input_text', text: params.systemPrompt }],
      });
    }
    input.push({ role: 'user', content });

    const response = (await this.client!.responses.create(
      {
        model: this.visionModel,
        input,
        stream: true,
      } as never,
      { signal: params.signal },
    )) as unknown as AsyncIterable<{ type: string; delta?: string }>;

    for await (const event of response) {
      if (params.signal?.aborted) return;
      if (event.type === 'response.output_text.delta' && event.delta) {
        yield event.delta;
      }
    }
  }

  private async *analyzeMock(params: VisionAnalyzeParams): AsyncGenerator<string> {
    const n = params.imageUrls.length;
    // 图 → 文案场景（带 systemPrompt）产出文案体裁，而非画面解读，
    // 否则前端在 mock 下会拿到与需求不符的内容。
    const text = params.systemPrompt?.trim()
      ? this.mockCaptionText(params, n)
      : `（Vision · mock）我已经"看到"你上传的 ${n} 张图片。\n\n` +
        `关于「${this.truncate(params.question, 40)}」，` +
        `这是 mock 模式的模拟解读：\n\n` +
        `- **画面主体**：图片整体构图均衡，主体位于视觉中心。\n` +
        `- **色彩风格**：以品牌紫蓝色系为主，明度适中。\n` +
        `- **可用建议**：适合作为文章配图或社交媒体封面。\n\n` +
        `配置 \`OPENAI_API_KEY\` 后即可获得基于真实视觉模型的分析结果。`;

    await this.sleep(180);
    for (const piece of text.match(/[\s\S]{1,2}/g) ?? [text]) {
      if (params.signal?.aborted) return;
      await this.sleep(12);
      yield piece;
    }
  }

  /** mock 模式下的「图 → 文案」示例输出，尽量贴近真实体裁便于联调 */
  private mockCaptionText(params: VisionAnalyzeParams, imageCount: number): string {
    const hint = params.systemPrompt ?? '';
    // 从 systemPrompt 中识别体裁，给出对应形态的示例文案
    if (hint.includes('无障碍') || hint.includes('alt text')) {
      return (
        `（图 → 文案 · mock）画面中可见一个位于中心位置的主体，背景为紫蓝色渐变，` +
        `整体光线柔和、构图均衡，属于适合用作封面的示意图像。`
      );
    }
    if (hint.includes('小红书')) {
      return (
        `✨ 这个画面我真的可以看一整天！\n\n` +
        `第一眼就被这个配色抓住了，紫蓝色的渐变太有氛围感了，` +
        `随手一拍就是壁纸级别的效果～\n\n` +
        `真心推荐给喜欢这种质感的姐妹，细节拉满，越看越耐看。\n\n` +
        `#氛围感 #高级感配色 #灵感收集 #壁纸分享 #好物记录\n\n` +
        `> （mock 示例文案，配置 OPENAI_API_KEY 后由真实视觉模型基于 ${imageCount} 张图生成）`
      );
    }
    if (hint.includes('电商')) {
      return (
        `质感在线，一眼心动的选择。\n\n` +
        `- 配色高级：紫蓝渐变，耐看不腻\n` +
        `- 细节扎实：做工整齐，边角处理到位\n` +
        `- 场景百搭：日常、送礼都合适\n` +
        `- 视觉出片：随手拍就有氛围感\n\n` +
        `> （mock 示例文案，配置 OPENAI_API_KEY 后由真实视觉模型生成）`
      );
    }
    if (hint.includes('50 字')) {
      return `被这个配色治愈了 ✨ 紫蓝渐变的氛围感，怎么看都不腻。（mock 示例）`;
    }
    return (
      `让好设计自己说话。\n\n` +
      `这一画面以紫蓝渐变构建出沉静而高级的视觉氛围，主体突出、层次分明，` +
      `既适合品牌传播，也能直接用于社交媒体封面。\n\n` +
      `现在就把这份质感，带进你的下一个作品。\n\n` +
      `> （mock 示例文案，配置 OPENAI_API_KEY 后由真实视觉模型生成）`
    );
  }

  private truncate(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }

  // ---------------- mock 占位图 ----------------

  /**
   * 按 prompt 哈希生成确定性的渐变 SVG 占位图：
   * 同一 prompt 始终得到同一张图，便于演示与回归；
   * 图中标注 prompt 摘要与尺寸，肉眼即可确认参数是否正确传递。
   */
  private async generateMock(
    finalPrompt: string,
    params: ImageGenerateParams,
  ): Promise<GeneratedImage[]> {
    const dim = IMAGE_SIZES.find((s) => s.id === params.size) ?? IMAGE_SIZES[0];
    const out: GeneratedImage[] = [];
    for (let i = 0; i < params.count; i++) {
      await this.sleep(320);
      const svg = this.mockSvg(`${finalPrompt}#${i}`, params, dim.width, dim.height);
      out.push({
        b64: Buffer.from(svg, 'utf8').toString('base64'),
        mimeType: 'image/svg+xml',
        revisedPrompt: finalPrompt,
      });
    }
    return out;
  }

  private mockSvg(
    seed: string,
    params: ImageGenerateParams,
    width: number,
    height: number,
  ): string {
    const h = this.simpleHash(seed);
    const hue1 = h % 360;
    const hue2 = (hue1 + 40 + (h % 60)) % 360;
    const c1 = `hsl(${hue1} 78% 62%)`;
    const c2 = `hsl(${hue2} 72% 46%)`;

    // 由哈希派生若干装饰性圆形，营造抽象「AI 生成」观感
    const blobs = Array.from({ length: 5 }, (_, i) => {
      const s = this.simpleHash(`${seed}:${i}`);
      const cx = (s % 100) / 100;
      const cy = ((s >> 7) % 100) / 100;
      const r = 0.08 + ((s >> 13) % 22) / 100;
      const op = 0.12 + ((s >> 17) % 20) / 100;
      return `<circle cx="${(cx * width).toFixed(0)}" cy="${(cy * height).toFixed(0)}" r="${(r * Math.min(width, height)).toFixed(0)}" fill="#ffffff" opacity="${op.toFixed(2)}"/>`;
    }).join('');

    const label = this.escapeXml(params.prompt.slice(0, 28));
    const styleLabel = this.escapeXml(params.style);
    const fontSize = Math.round(Math.min(width, height) * 0.045);
    const smallFont = Math.round(fontSize * 0.62);

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${c1}"/>
      <stop offset="100%" stop-color="${c2}"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#g)"/>
  ${blobs}
  <g font-family="system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif" fill="#ffffff" text-anchor="middle">
    <text x="${width / 2}" y="${height / 2 - fontSize}" font-size="${Math.round(fontSize * 1.5)}" opacity="0.95">✨</text>
    <text x="${width / 2}" y="${height / 2 + fontSize * 0.4}" font-size="${fontSize}" font-weight="600" opacity="0.96">${label}</text>
    <text x="${width / 2}" y="${height / 2 + fontSize * 2}" font-size="${smallFont}" opacity="0.78">${params.size} · ${styleLabel} · mock</text>
  </g>
</svg>`;
  }

  private simpleHash(text: string): number {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return Math.abs(h);
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

export { DEFAULT_IMAGE_MODEL };
