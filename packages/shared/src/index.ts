// 蛙宝 AI · 前后端共享契约
// 唯一事实来源：模型列表、会员套餐目录、可用模型白名单等。
// 后端（NestJS）与前端（React）均从此包引入，避免两端常量漂移。

// ---------------- 模型 ----------------

export type ModelId = 'gpt-5.6-sol' | 'gpt-5.6-terra' | 'gpt-5.6-luna';

export interface ModelInfo {
  id: ModelId;
  name: string;
  desc: string;
}

export const MODELS: ModelInfo[] = [
  { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', desc: '旗舰推理 · 复杂任务' },
  { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', desc: '均衡 · 日常首选' },
  { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', desc: '高性价比 · 高并发' },
];

export const MODEL_IDS: ModelId[] = MODELS.map((m) => m.id);
export const DEFAULT_MODEL: ModelId = 'gpt-5.6-terra';

export function isValidModel(model: string): model is ModelId {
  return (MODEL_IDS as string[]).includes(model);
}

const ALL_MODELS: ModelId[] = ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol'];

// ---------------- 会员套餐 ----------------

export type PlanId = 'free' | 'plus' | 'pro' | 'team' | 'enterprise';
export type BillingCycle = 'monthly' | 'yearly';

/**
 * 套餐目录条目（前后端共用）。
 * 定价参考 OpenAI ChatGPT 价格区间做本地化：
 *   Free($0) / Plus($20) / Pro($200) / Team($25~30/人) / Enterprise(定制)
 * quotaTokens=0 表示不限量（企业版）。
 */
export interface PlanCatalogEntry {
  id: PlanId;
  name: string;
  tagline: string;
  anchor: string;
  priceMonthly: number | null;
  priceYearlyPerMonth: number | null;
  unit: 'account' | 'seat';
  quotaTokens: number;
  allowedModels: ModelId[];
  highlights: string[];
  cta: string;
  featured?: boolean;
  badge?: string;
}

export const PLAN_CATALOG: PlanCatalogEntry[] = [
  {
    id: 'free',
    name: '免费版',
    tagline: '零成本体验多模态 AI 核心能力',
    anchor: '对标 ChatGPT Free（$0）',
    priceMonthly: 0,
    priceYearlyPerMonth: 0,
    unit: 'account',
    quotaTokens: 100_000,
    allowedModels: ['gpt-5.6-luna', 'gpt-5.6-terra'],
    cta: '当前免费使用',
    highlights: [
      '每月 10 万 Token 额度',
      'Luna / Terra 模型',
      '多轮对话 + 基础创作模板',
      '每月 20 张 AI 绘图（基础风格）',
      '会话历史保存 30 天',
    ],
  },
  {
    id: 'plus',
    name: 'Plus 专业版',
    tagline: '个人进阶，解锁旗舰模型与全部模板',
    anchor: '对标 ChatGPT Plus（$20/月）',
    priceMonthly: 98,
    priceYearlyPerMonth: 82,
    unit: 'account',
    quotaTokens: 2_000_000,
    allowedModels: ALL_MODELS,
    cta: '升级 Plus',
    featured: true,
    badge: '最受欢迎',
    highlights: [
      '每月 200 万 Token 额度',
      '解锁 GPT-5.6 Sol 旗舰模型',
      '高峰期优先访问，更快响应',
      '全部创作模板 + 结构化输出',
      '每月 500 张 AI 绘图 + 看图问答',
      '会话历史无限保存 · 导出 Word/PDF',
    ],
  },
  {
    id: 'pro',
    name: 'Pro 旗舰版',
    tagline: '重度专业用户，近乎无限的算力与优先级',
    anchor: '对标 ChatGPT Pro（$200/月）',
    priceMonthly: 998,
    priceYearlyPerMonth: 832,
    unit: 'account',
    quotaTokens: 20_000_000,
    allowedModels: ALL_MODELS,
    cta: '升级 Pro',
    highlights: [
      '每月 2000 万 Token（近乎不限量）',
      'Sol 高算力 · 最高推理强度(high)',
      '批量处理 + 后台长任务 / 深度研究',
      '每月 5000 张 AI 绘图 · 全部风格',
      '最高优先级（Priority）与并发',
      '图像 / 语音等新功能抢先内测',
    ],
  },
  {
    id: 'team',
    name: '团队版',
    tagline: '小团队协作，共享工作空间与统一计费',
    anchor: '对标 ChatGPT Team（$25~30/人·月）',
    priceMonthly: 158,
    priceYearlyPerMonth: 128,
    unit: 'seat',
    quotaTokens: 5_000_000,
    allowedModels: ALL_MODELS,
    cta: '组建团队',
    highlights: [
      '每人 500 万 Token + 团队共享额度池',
      '全部模型 · 协作工作空间',
      '每月 2000 张 AI 绘图（团队共享）',
      '成员管理与角色权限',
      '共享助手 / 模板（P2 起共享知识库）',
      '团队用量看板 · 集中开票',
    ],
  },
  {
    id: 'enterprise',
    name: '企业版',
    tagline: '为组织定制的安全、合规与专属容量',
    anchor: '对标 ChatGPT Enterprise（定制）',
    priceMonthly: null,
    priceYearlyPerMonth: null,
    unit: 'seat',
    quotaTokens: 0,
    allowedModels: ALL_MODELS,
    cta: '联系销售',
    highlights: [
      '定制 / 不限量 Token 与专属限流',
      '不限量 AI 绘图与图像理解',
      'SSO / SAML 单点登录 · SCIM',
      '审计日志 · 数据隔离 · 可私有部署',
      'SLA 99.9% · 专属客户成功经理',
      '数据不用于训练 · 微调定制模型',
    ],
  },
];

export const PLAN_MAP: Record<PlanId, PlanCatalogEntry> = PLAN_CATALOG.reduce(
  (acc, p) => ({ ...acc, [p.id]: p }),
  {} as Record<PlanId, PlanCatalogEntry>,
);

export const PLAN_ALLOWED_MODELS: Record<PlanId, ModelId[]> = PLAN_CATALOG.reduce(
  (acc, p) => ({ ...acc, [p.id]: p.allowedModels }),
  {} as Record<PlanId, ModelId[]>,
);

export const PLAN_LABELS: Record<PlanId, string> = {
  free: '免费版',
  plus: 'Plus 专业版',
  pro: 'Pro 旗舰版',
  team: '团队版',
  enterprise: '企业版',
};

export const PLAN_RANK: Record<PlanId, number> = {
  free: 0,
  plus: 1,
  pro: 2,
  team: 3,
  enterprise: 4,
};

export function isModelAllowed(plan: PlanId, model: ModelId): boolean {
  return (PLAN_MAP[plan] ?? PLAN_MAP.free).allowedModels.includes(model);
}

export function quotaForPlan(plan: PlanId): number {
  return (PLAN_MAP[plan] ?? PLAN_MAP.free).quotaTokens;
}

// ---------------- 图像与多模态（P2 · M5） ----------------

/** 图像模型标识。gpt-image-2 为旗舰生图模型，mini 为成本优化版。 */
export type ImageModelId = 'gpt-image-2' | 'gpt-image-2-mini';

export interface ImageModelInfo {
  id: ImageModelId;
  name: string;
  desc: string;
  /** 单张图的估算成本（人民币，示意值） */
  pricePerImage: number;
}

export const IMAGE_MODELS: ImageModelInfo[] = [
  { id: 'gpt-image-2', name: 'GPT Image 2', desc: '旗舰生图 · 细节丰富', pricePerImage: 0.32 },
  { id: 'gpt-image-2-mini', name: 'GPT Image 2 Mini', desc: '高性价比 · 快速出图', pricePerImage: 0.08 },
];

export const IMAGE_MODEL_IDS: ImageModelId[] = IMAGE_MODELS.map((m) => m.id);
export const DEFAULT_IMAGE_MODEL: ImageModelId = 'gpt-image-2-mini';

export function isValidImageModel(model: string): model is ImageModelId {
  return (IMAGE_MODEL_IDS as string[]).includes(model);
}

/** 出图尺寸。比例用于前端预览占位框，避免布局跳动。 */
export type ImageSizeId = '1024x1024' | '1024x1536' | '1536x1024';

export interface ImageSizeInfo {
  id: ImageSizeId;
  label: string;
  ratio: string;
  width: number;
  height: number;
}

export const IMAGE_SIZES: ImageSizeInfo[] = [
  { id: '1024x1024', label: '方形', ratio: '1:1', width: 1024, height: 1024 },
  { id: '1024x1536', label: '竖版', ratio: '2:3', width: 1024, height: 1536 },
  { id: '1536x1024', label: '横版', ratio: '3:2', width: 1536, height: 1024 },
];

export const IMAGE_SIZE_IDS: ImageSizeId[] = IMAGE_SIZES.map((s) => s.id);
export const DEFAULT_IMAGE_SIZE: ImageSizeId = '1024x1024';

export function isValidImageSize(size: string): size is ImageSizeId {
  return (IMAGE_SIZE_IDS as string[]).includes(size);
}

/**
 * 画面风格。`promptHint` 会被拼接到用户 prompt 之后送给模型，
 * `swatch` 为前端风格卡片的渐变色（Tailwind 类名片段），保证与品牌视觉统一。
 */
export type ImageStyleId =
  | 'auto'
  | 'photo'
  | 'illustration'
  | 'flat'
  | 'anime'
  | 'watercolor'
  | 'render3d'
  | 'inkwash';

export interface ImageStyleInfo {
  id: ImageStyleId;
  label: string;
  promptHint: string;
  swatch: string;
}

export const IMAGE_STYLES: ImageStyleInfo[] = [
  { id: 'auto', label: '智能', promptHint: '', swatch: 'from-slate-300 to-slate-400' },
  {
    id: 'photo',
    label: '写实摄影',
    promptHint: '写实摄影风格，自然光照，浅景深，高细节，35mm 镜头质感',
    swatch: 'from-amber-200 to-orange-400',
  },
  {
    id: 'illustration',
    label: '插画',
    promptHint: '数字插画风格，柔和笔触，细腻光影，富有故事感',
    swatch: 'from-rose-300 to-pink-500',
  },
  {
    id: 'flat',
    label: '扁平矢量',
    promptHint: '扁平矢量插画，几何造型，纯色块，无渐变，现代简洁',
    swatch: 'from-indigo-300 to-violet-500',
  },
  {
    id: 'anime',
    label: '动漫',
    promptHint: '日式动漫风格，干净线条，鲜明色彩，赛璐璐上色',
    swatch: 'from-sky-300 to-blue-500',
  },
  {
    id: 'watercolor',
    label: '水彩',
    promptHint: '水彩画风格，湿润渐层，纸张纹理，边缘自然扩散',
    swatch: 'from-teal-200 to-cyan-400',
  },
  {
    id: 'render3d',
    label: '3D 渲染',
    promptHint: '3D 渲染风格，柔和全局光照，圆润材质，C4D 质感，微缩景观',
    swatch: 'from-fuchsia-300 to-purple-500',
  },
  {
    id: 'inkwash',
    label: '国风水墨',
    promptHint: '中国水墨画风格，留白构图，墨色浓淡变化，宣纸质感',
    swatch: 'from-stone-300 to-neutral-500',
  },
];

export const IMAGE_STYLE_IDS: ImageStyleId[] = IMAGE_STYLES.map((s) => s.id);
export const DEFAULT_IMAGE_STYLE: ImageStyleId = 'auto';

export function isValidImageStyle(style: string): style is ImageStyleId {
  return (IMAGE_STYLE_IDS as string[]).includes(style);
}

export function imageStyleHint(style: ImageStyleId): string {
  return IMAGE_STYLES.find((s) => s.id === style)?.promptHint ?? '';
}

/** 单次请求可生成的最大张数（受套餐限制，见 PLAN_IMAGE_LIMITS） */
export const MAX_IMAGES_PER_REQUEST = 4;

/**
 * 各套餐的图像权益。
 * - monthlyImages：每月可生成张数，0 表示不限量（企业版）。
 * - allowedModels：可用图像模型白名单。
 * - maxBatch：单次最多生成张数。
 * - vision：是否可用图像理解（看图问答）。
 */
export interface PlanImageLimit {
  monthlyImages: number;
  allowedModels: ImageModelId[];
  maxBatch: number;
  vision: boolean;
  allowedStyles: 'basic' | 'all';
}

const BASIC_IMAGE_STYLES: ImageStyleId[] = ['auto', 'photo', 'illustration', 'flat'];

export const PLAN_IMAGE_LIMITS: Record<PlanId, PlanImageLimit> = {
  free: {
    monthlyImages: 20,
    allowedModels: ['gpt-image-2-mini'],
    maxBatch: 1,
    vision: false,
    allowedStyles: 'basic',
  },
  plus: {
    monthlyImages: 500,
    allowedModels: IMAGE_MODEL_IDS,
    maxBatch: 4,
    vision: true,
    allowedStyles: 'all',
  },
  pro: {
    monthlyImages: 5000,
    allowedModels: IMAGE_MODEL_IDS,
    maxBatch: 4,
    vision: true,
    allowedStyles: 'all',
  },
  team: {
    monthlyImages: 2000,
    allowedModels: IMAGE_MODEL_IDS,
    maxBatch: 4,
    vision: true,
    allowedStyles: 'all',
  },
  enterprise: {
    monthlyImages: 0,
    allowedModels: IMAGE_MODEL_IDS,
    maxBatch: 4,
    vision: true,
    allowedStyles: 'all',
  },
};

export function imageLimitsForPlan(plan: PlanId): PlanImageLimit {
  return PLAN_IMAGE_LIMITS[plan] ?? PLAN_IMAGE_LIMITS.free;
}

export function isImageModelAllowed(plan: PlanId, model: ImageModelId): boolean {
  return imageLimitsForPlan(plan).allowedModels.includes(model);
}

export function isImageStyleAllowed(plan: PlanId, style: ImageStyleId): boolean {
  const limit = imageLimitsForPlan(plan);
  return limit.allowedStyles === 'all' || BASIC_IMAGE_STYLES.includes(style);
}

/** 图像生成的估算成本（人民币） */
export function estimateImageCost(model: ImageModelId, count: number): number {
  const price = IMAGE_MODELS.find((m) => m.id === model)?.pricePerImage ?? 0.08;
  return Math.round(price * count * 10000) / 10000;
}

/** 允许上传的图片类型与大小上限（图像理解 / 变体输入） */
export const IMAGE_UPLOAD_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const;

export const IMAGE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

// ---------------- 图 → 文案（P2 · M5 × M3 联动） ----------------

/** 文案用途：决定生成文案的渠道口吻与篇幅 */
export interface CaptionPurposeInfo {
  id: string;
  /** 展示名 */
  label: string;
  /** 图标（前端卡片展示） */
  icon: string;
  /** 场景说明 */
  desc: string;
  /** 送模型的写作要求 */
  promptHint: string;
}

export const CAPTION_PURPOSES = [
  {
    id: 'xiaohongshu',
    label: '小红书笔记',
    icon: '📕',
    desc: '标题 + 正文 + 话题标签',
    promptHint:
      '写成小红书风格笔记：一个吸引点击的标题（可含 emoji）、分段正文（口语化、有代入感）、结尾附 5 个相关话题标签（#开头）。',
  },
  {
    id: 'marketing',
    label: '营销推广',
    icon: '📣',
    desc: '突出卖点与行动号召',
    promptHint:
      '写成营销推广文案：突出核心卖点与用户收益，语言有感染力，结尾给出明确的行动号召（CTA）。',
  },
  {
    id: 'ecommerce',
    label: '电商详情',
    icon: '🛍️',
    desc: '卖点清单 + 规格描述',
    promptHint:
      '写成电商商品详情文案：先一句吸引人的主推语，再用要点列出 4~6 条卖点，语言具体、可信、避免夸大。',
  },
  {
    id: 'social',
    label: '朋友圈/微博',
    icon: '💬',
    desc: '简短有趣，适合社交分享',
    promptHint: '写成社交平台短文案：50 字以内，轻松有趣、有画面感，可适度使用 emoji。',
  },
  {
    id: 'alt_text',
    label: '无障碍描述',
    icon: '♿',
    desc: '客观描述画面，用于 alt 文本',
    promptHint:
      '写成无障碍替代文本（alt text）：客观、准确地描述画面主体、动作与场景，不加主观修饰与营销语言，控制在 100 字以内。',
  },
] as const satisfies readonly CaptionPurposeInfo[];

export type CaptionPurposeId = (typeof CAPTION_PURPOSES)[number]['id'];

export const CAPTION_PURPOSE_IDS = CAPTION_PURPOSES.map((p) => p.id) as CaptionPurposeId[];

export const DEFAULT_CAPTION_PURPOSE: CaptionPurposeId = 'xiaohongshu';

/** 文案语气 */
export const CAPTION_TONES = [
  { id: 'friendly', label: '亲切自然', promptHint: '语气亲切自然，像朋友分享。' },
  { id: 'professional', label: '专业严谨', promptHint: '语气专业严谨，用词准确克制。' },
  { id: 'playful', label: '活泼俏皮', promptHint: '语气活泼俏皮，适度使用网络流行表达。' },
  { id: 'luxury', label: '高级质感', promptHint: '语气克制高级，营造质感与格调。' },
] as const;

export type CaptionToneId = (typeof CAPTION_TONES)[number]['id'];

export const CAPTION_TONE_IDS = CAPTION_TONES.map((t) => t.id) as CaptionToneId[];

export const DEFAULT_CAPTION_TONE: CaptionToneId = 'friendly';

/** 单次「图 → 文案」最多可上传的参考图数量 */
export const MAX_CAPTION_IMAGES = 4;

export function isValidCaptionPurpose(v: string): v is CaptionPurposeId {
  return CAPTION_PURPOSE_IDS.includes(v as CaptionPurposeId);
}

export function isValidCaptionTone(v: string): v is CaptionToneId {
  return CAPTION_TONE_IDS.includes(v as CaptionToneId);
}

export function captionPurposeHint(id: CaptionPurposeId): string {
  return CAPTION_PURPOSES.find((p) => p.id === id)?.promptHint ?? '';
}

export function captionToneHint(id: CaptionToneId): string {
  return CAPTION_TONES.find((t) => t.id === id)?.promptHint ?? '';
}
