// 模型 / 套餐等契约类型来自前后端共享包 @wabao/shared
import type {
  ModelId,
  ModelInfo,
  PlanId,
  BillingCycle,
  PlanCatalogEntry,
  ImageModelId,
  ImageSizeId,
  ImageStyleId,
  ImageModelInfo,
  ImageSizeInfo,
  ImageStyleInfo,
} from "@wabao/shared";
export type {
  ModelId,
  ModelInfo,
  PlanId,
  BillingCycle,
  ImageModelId,
  ImageSizeId,
  ImageStyleId,
  ImageModelInfo,
  ImageSizeInfo,
  ImageStyleInfo,
};
/** 套餐目录条目（等价于共享包的 PlanCatalogEntry） */
export type Plan = PlanCatalogEntry;

export type ReasoningEffort = "low" | "medium" | "high";

export interface UserMe {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
  plan: PlanId;
}

export interface Assistant {
  id: string;
  name: string;
  avatar: string;
  systemPrompt: string;
  defaultModel: ModelId;
}

export type MessageRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  model?: ModelId;
  streaming?: boolean;
  flagged?: boolean;
  rating?: "up" | "down";
  /** 多模态附件（图片 URL），用于看图问答 */
  attachments?: string[];
  createdAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  model: ModelId;
  assistantId: string;
  pinned: boolean;
  temperature: number;
  reasoningEffort: ReasoningEffort;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export type TemplateField =
  | { key: string; label: string; type: "text" | "textarea"; required?: boolean; placeholder?: string }
  | { key: string; label: string; type: "select"; options: string[]; default?: string };

export interface Template {
  id: string;
  name: string;
  category: string;
  icon: string;
  description: string;
  fields: TemplateField[];
  structured?: boolean;
}

export interface Creation {
  id: string;
  templateId: string;
  templateName: string;
  output: string;
  createdAt: number;
}

export interface UsageBreakdown {
  feature: string;
  label: string;
  calls: number;
  tokens: number;
}

export interface UsageResult {
  period: string;
  plan: string;
  quota_tokens: number;
  used_tokens: number;
  remaining_tokens: number;
  breakdown: UsageBreakdown[];
  /** 图像按张数独立计量（P2） */
  images?: {
    quota: number;
    used: number;
    remaining: number | null;
    vision: boolean;
  };
}

export interface ModerationRecord {
  id: string;
  refType: "input" | "output";
  flagged: boolean;
  categories: string[];
  action: "block" | "warn";
  createdAt: number;
}

// ---------------- 会员 / 套餐（UI 专用类型） ----------------

export type PlanCellValue = boolean | string;

export interface PlanMatrixRow {
  /** 权益名称 */
  label: string;
  /** 分组标题（用于表格分区） */
  group: string;
  /** 各套餐对应的取值：true=✓，false=✗，字符串=具体说明 */
  values: Record<PlanId, PlanCellValue>;
}

// ---------------- 图像与多模态（P2 · M5） ----------------

export type MediaSourceKind = "generation" | "variation" | "upload";

/** 一张媒体资产（AI 生成图 / 变体 / 用户上传） */
export interface MediaAsset {
  id: string;
  source: MediaSourceKind;
  url: string;
  prompt: string;
  revisedPrompt?: string | null;
  model: string;
  size: string;
  style: string;
  width: number;
  height: number;
  bytes: number;
  mimeType: string;
  sourceId?: string | null;
  flagged: boolean;
  createdAt: number;
}

/** 生图参数目录（含当前套餐可用性标记） */
export interface ImageOptions {
  models: (ImageModelInfo & { allowed: boolean })[];
  sizes: ImageSizeInfo[];
  styles: (ImageStyleInfo & { allowed: boolean })[];
  defaults: {
    model: ImageModelId;
    size: ImageSizeId;
    style: ImageStyleId;
  };
  limits: {
    plan: PlanId;
    monthlyImages: number;
    usedImages: number;
    /** null 表示不限量 */
    remainingImages: number | null;
    maxBatch: number;
    vision: boolean;
  };
  /** 后端是否运行在 mock 模式（无 OPENAI_API_KEY） */
  mock: boolean;
}

/** 生图表单参数 */
export interface ImageGenerateParams {
  prompt: string;
  model: ImageModelId;
  size: ImageSizeId;
  style: ImageStyleId;
  n: number;
}

export interface ImageQuotaSnapshot {
  quota: number;
  used: number;
  remaining: number | null;
}

// ---------------- 图 → 文案（P2 · M5 × M3） ----------------

export type { CaptionPurposeId, CaptionToneId, CaptionPurposeInfo } from "@wabao/shared";

/** 图 → 文案的可选项目录 */
export interface CaptionOptions {
  purposes: readonly {
    id: string;
    label: string;
    icon: string;
    desc: string;
    promptHint: string;
  }[];
  tones: readonly { id: string; label: string; promptHint: string }[];
  defaults: { purpose: string; tone: string };
  limits: { plan: PlanId; vision: boolean; maxImages: number };
  mock: boolean;
}

/** 一次图生文案的结果 */
export interface CaptionResult {
  creationId: string;
  content: string;
  purpose: string;
  tone: string;
  flagged?: boolean;
}
