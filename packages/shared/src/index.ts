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
