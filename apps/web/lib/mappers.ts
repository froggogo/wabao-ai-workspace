// 后端 snake_case → 前端 camelCase 的纯映射函数。
// 不依赖任何浏览器/Node 专有 API，客户端 api.ts 与服务端 server/backend.ts 共用，
// 保证 SSR 首屏数据与客户端 SWR 数据形状完全一致。
import type {
  Assistant,
  ChatMessage,
  Conversation,
  Creation,
  ImageOptions,
  MediaAsset,
  MediaSourceKind,
  ModelId,
  ModerationRecord,
  ReasoningEffort,
  Template,
} from "./types";

export interface RawMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  model?: ModelId;
  flagged?: boolean;
  attachments?: string[] | null;
  created_at?: string;
}

export function mapMessage(m: RawMessage): ChatMessage {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    model: m.model,
    flagged: m.flagged,
    attachments: Array.isArray(m.attachments) ? m.attachments : undefined,
    createdAt: m.created_at ? Date.parse(m.created_at) : Date.now(),
  };
}

export interface RawConversation {
  id: string;
  title: string;
  model: ModelId;
  assistant_id: string | null;
  pinned: boolean;
  temperature?: number;
  reasoning_effort?: ReasoningEffort;
  created_at: string;
  updated_at: string;
  messages?: RawMessage[];
}

export function mapConversation(c: RawConversation): Conversation {
  return {
    id: c.id,
    title: c.title,
    model: c.model,
    assistantId: c.assistant_id ?? "",
    pinned: c.pinned,
    temperature: c.temperature ?? 0.7,
    reasoningEffort: c.reasoning_effort ?? "medium",
    messages: (c.messages ?? []).map(mapMessage),
    createdAt: Date.parse(c.created_at),
    updatedAt: Date.parse(c.updated_at),
  };
}

export interface RawAssistant {
  id: string;
  name: string;
  avatar: string;
  system_prompt: string;
  default_model: ModelId;
}

export function mapAssistant(a: RawAssistant): Assistant {
  return {
    id: a.id,
    name: a.name,
    avatar: a.avatar,
    systemPrompt: a.system_prompt,
    defaultModel: a.default_model,
  };
}

export interface RawTemplate {
  id: string;
  name: string;
  category: string;
  icon: string;
  description: string;
  input_schema: { fields?: Template["fields"] };
  structured?: boolean;
}

export function mapTemplate(t: RawTemplate): Template {
  return {
    id: t.id,
    name: t.name,
    category: t.category,
    icon: t.icon,
    description: t.description,
    fields: t.input_schema?.fields ?? [],
    structured: t.structured,
  };
}

export interface RawCreation {
  id: string;
  template_id: string;
  template_name: string;
  output: string;
  created_at: string;
}

export function mapCreation(c: RawCreation): Creation {
  return {
    id: c.id,
    templateId: c.template_id,
    templateName: c.template_name,
    output: c.output,
    createdAt: Date.parse(c.created_at),
  };
}

export interface RawModerationRecord {
  id: string;
  ref_type: "input" | "output";
  flagged: boolean;
  categories: string[];
  action: "block" | "warn";
  created_at: string;
}

export function mapModerationRecord(r: RawModerationRecord): ModerationRecord {
  return {
    id: r.id,
    refType: r.ref_type,
    flagged: r.flagged,
    categories: Array.isArray(r.categories) ? r.categories : [],
    action: r.action,
    createdAt: Date.parse(r.created_at),
  };
}

// ---------------- 图像与多模态（P2 · M5） ----------------

export interface RawMediaAsset {
  id: string;
  source: MediaSourceKind;
  url: string;
  prompt: string;
  revised_prompt?: string | null;
  model: string;
  size: string;
  style: string;
  width: number;
  height: number;
  bytes: number;
  mime_type: string;
  source_id?: string | null;
  flagged: boolean;
  created_at: string;
}

export function mapMediaAsset(a: RawMediaAsset): MediaAsset {
  return {
    id: a.id,
    source: a.source,
    url: a.url,
    prompt: a.prompt,
    revisedPrompt: a.revised_prompt,
    model: a.model,
    size: a.size,
    style: a.style,
    width: a.width,
    height: a.height,
    bytes: a.bytes,
    mimeType: a.mime_type,
    sourceId: a.source_id,
    flagged: a.flagged,
    createdAt: Date.parse(a.created_at),
  };
}

export interface RawImageOptions {
  models: ImageOptions["models"];
  sizes: ImageOptions["sizes"];
  styles: ImageOptions["styles"];
  defaults: ImageOptions["defaults"];
  limits: {
    plan: ImageOptions["limits"]["plan"];
    monthly_images: number;
    used_images: number;
    remaining_images: number | null;
    max_batch: number;
    vision: boolean;
  };
  mock: boolean;
}

export function mapImageOptions(o: RawImageOptions): ImageOptions {
  return {
    models: o.models,
    sizes: o.sizes,
    styles: o.styles,
    defaults: o.defaults,
    limits: {
      plan: o.limits.plan,
      monthlyImages: o.limits.monthly_images,
      usedImages: o.limits.used_images,
      remainingImages: o.limits.remaining_images,
      maxBatch: o.limits.max_batch,
      vision: o.limits.vision,
    },
    mock: o.mock,
  };
}
