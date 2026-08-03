import {
  mapAssistant,
  mapConversation,
  mapCreation,
  mapImageOptions,
  mapMediaAsset,
  mapModerationRecord,
  mapTemplate,
  type RawAssistant,
  type RawConversation,
  type RawCreation,
  type RawImageOptions,
  type RawMediaAsset,
  type RawModerationRecord,
  type RawTemplate,
} from "./mappers";
import type {
  Assistant,
  CaptionOptions,
  Conversation,
  Creation,
  ImageGenerateParams,
  ImageOptions,
  ImageQuotaSnapshot,
  ImageSizeId,
  MediaAsset,
  MediaSourceKind,
  ModelId,
  ModerationRecord,
  PlanId,
  ReasoningEffort,
  Template,
  UsageResult,
} from "./types";

// 所有请求走同源 BFF（Next.js Route Handlers）。BFF 负责从 httpOnly cookie 取出
// access token 加到 Authorization，并在 401 时用 refresh 令牌刷新。浏览器端不再持有 token。
const BASE_URL = "/bff";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

// ---------------- 基础请求 ----------------

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** 兼容旧调用点；鉴权已由 BFF 依据 cookie 处理，这里不再生效。 */
  auth?: boolean;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body } = opts;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = json.error ?? { code: "unknown", message: `HTTP ${res.status}` };
    throw new ApiError(err.code, err.message, err.details);
  }
  return (json.data ?? json) as T;
}

// ---------------- SSE 流式 ----------------

export interface StreamHandlers {
  onStart?: (id: string) => void;
  onDelta?: (text: string) => void;
  onDone?: (data: {
    finish_reason?: string;
    usage?: unknown;
    output_json?: unknown;
    flagged?: boolean;
    filtered_content?: string;
  }) => void;
  onError?: (err: ApiError) => void;
  signal?: AbortSignal;
}

async function stream(path: string, body: unknown, handlers: StreamHandlers): Promise<void> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
    signal: handlers.signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    let code = "internal_error";
    let message = `HTTP ${res.status}`;
    try {
      const json = JSON.parse(text);
      code = json.error?.code ?? code;
      message = json.error?.message ?? message;
    } catch {
      /* ignore */
    }
    handlers.onError?.(new ApiError(code, message));
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        dispatchEvent(raw, handlers);
      }
    }
  } catch (e) {
    if ((e as Error).name !== "AbortError") {
      handlers.onError?.(new ApiError("stream_error", (e as Error).message));
    }
  }
}

function dispatchEvent(raw: string, handlers: StreamHandlers): void {
  let event = "message";
  let dataStr = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
  }
  if (!dataStr) return;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(dataStr);
  } catch {
    return;
  }
  switch (event) {
    case "message.start":
      handlers.onStart?.((data.message_id as string) ?? (data.creation_id as string));
      break;
    case "message.delta":
      handlers.onDelta?.((data.text as string) ?? "");
      break;
    case "message.done":
      handlers.onDone?.(data);
      break;
    case "error":
      handlers.onError?.(
        new ApiError((data.code as string) ?? "error", (data.message as string) ?? "生成失败", data.details),
      );
      break;
  }
}

// ---------------- 图像 SSE 流式 ----------------

export interface ImageStreamHandlers {
  /** 任务开始：返回本次将生成的张数 */
  onStart?: (info: { count: number; mock?: boolean }) => void;
  /** 单张生成完成，可立即上屏 */
  onItem?: (asset: MediaAsset) => void;
  /** 全部完成，附带最新配额 */
  onDone?: (info: { images: MediaAsset[]; quota?: ImageQuotaSnapshot }) => void;
  onError?: (err: ApiError) => void;
  signal?: AbortSignal;
}

/**
 * 图像生成流：事件为 image.start / image.item / image.done / error。
 * 与文本流复用同一套 SSE 解析逻辑，仅事件语义不同。
 */
async function imageStream(
  path: string,
  body: unknown,
  handlers: ImageStreamHandlers,
): Promise<void> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal: handlers.signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    let code = "internal_error";
    let message = `HTTP ${res.status}`;
    let details: unknown;
    try {
      const json = JSON.parse(text);
      code = json.error?.code ?? code;
      message = json.error?.message ?? message;
      details = json.error?.details;
    } catch {
      /* ignore */
    }
    handlers.onError?.(new ApiError(code, message, details));
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const handleFrame = (raw: string) => {
    let event = "message";
    let dataStr = "";
    for (const line of raw.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
    }
    if (!dataStr) return;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(dataStr);
    } catch {
      return;
    }
    switch (event) {
      case "image.start":
        handlers.onStart?.({
          count: (data.count as number) ?? 1,
          mock: data.mock as boolean | undefined,
        });
        break;
      case "image.item":
        handlers.onItem?.(mapMediaAsset(data as unknown as RawMediaAsset));
        break;
      case "image.done": {
        const rawImages = (data.images as RawMediaAsset[]) ?? [];
        const q = data.quota as
          | { quota: number; used: number; remaining: number | null }
          | undefined;
        handlers.onDone?.({
          images: rawImages.map(mapMediaAsset),
          quota: q ? { quota: q.quota, used: q.used, remaining: q.remaining } : undefined,
        });
        break;
      }
      case "error":
        handlers.onError?.(
          new ApiError(
            (data.code as string) ?? "error",
            (data.message as string) ?? "生成失败",
            data.details,
          ),
        );
        break;
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        handleFrame(raw);
      }
    }
  } catch (e) {
    if ((e as Error).name !== "AbortError") {
      handlers.onError?.(new ApiError("stream_error", (e as Error).message));
    }
  }
}

// ---------------- 业务 API ----------------

export interface AuthResult {
  user: { id: string; email: string; name: string };
}

export const api = {
  auth: {
    register: (email: string, password: string, name?: string) =>
      request<AuthResult>("/auth/register", { method: "POST", body: { email, password, name } }),
    login: (email: string, password: string) =>
      request<AuthResult>("/auth/login", { method: "POST", body: { email, password } }),
    logout: () => request("/auth/logout", { method: "POST" }).catch(() => undefined),
    changePassword: (oldPassword: string, newPassword: string) =>
      request<{ success: boolean }>("/auth/change-password", {
        method: "POST",
        body: { old_password: oldPassword, new_password: newPassword },
      }),
  },

  users: {
    me: () =>
      request<{ id: string; email: string; name: string; avatar: string | null; plan: string }>(
        "/users/me",
      ),
    update: (input: { name?: string; avatar?: string }) =>
      request<{ id: string; email: string; name: string; avatar: string | null }>("/users/me", {
        method: "PATCH",
        body: input,
      }),
    usage: (period?: string) =>
      request<UsageResult>(`/usage${period ? `?period=${period}` : ""}`),
  },

  billing: {
    /** 创建 / 变更订阅（原型：无支付立即生效，企业版走联系销售由前端拦截） */
    subscribe: (plan: string, cycle: "monthly" | "yearly" = "monthly") =>
      request<{
        plan: string;
        name: string;
        cycle: string;
        status: string;
        quota_tokens: number;
        allowed_models: string[];
      }>("/billing/subscriptions", {
        method: "POST",
        body: { plan, cycle },
      }),
    subscription: () =>
      request<{
        plan: string;
        name: string;
        status: string;
        quota_tokens: number;
        allowed_models: string[];
      }>("/billing/subscription"),
  },

  moderation: {
    async records(params?: { page?: number; flagged?: boolean }): Promise<ModerationRecord[]> {
      const q = new URLSearchParams();
      if (params?.page) q.set("page", String(params.page));
      if (params?.flagged !== undefined) q.set("flagged", String(params.flagged));
      const qs = q.toString();
      // 后端返回 { data: [...], pagination }，request 已解包出 data 数组
      const rows = await request<RawModerationRecord[]>(
        `/admin/moderation-records${qs ? `?${qs}` : ""}`,
      );
      return rows.map(mapModerationRecord);
    },
  },

  assistants: {
    async list(): Promise<Assistant[]> {
      return (await request<RawAssistant[]>("/assistants")).map(mapAssistant);
    },
    async create(input: {
      name: string;
      system_prompt: string;
      default_model: ModelId;
      avatar: string;
    }): Promise<Assistant> {
      return mapAssistant(await request<RawAssistant>("/assistants", { method: "POST", body: input }));
    },
    async update(
      id: string,
      input: Partial<{ name: string; system_prompt: string; default_model: ModelId; avatar: string }>,
    ): Promise<Assistant> {
      return mapAssistant(
        await request<RawAssistant>(`/assistants/${id}`, { method: "PATCH", body: input }),
      );
    },
    remove: (id: string) => request(`/assistants/${id}`, { method: "DELETE" }),
  },

  conversations: {
    async list(): Promise<Conversation[]> {
      return (await request<RawConversation[]>("/conversations?page=1&page_size=100")).map(
        mapConversation,
      );
    },
    async create(input: { title?: string; model?: ModelId; assistant_id?: string }): Promise<Conversation> {
      return mapConversation(
        await request<RawConversation>("/conversations", { method: "POST", body: input }),
      );
    },
    async get(id: string): Promise<Conversation> {
      return mapConversation(await request<RawConversation>(`/conversations/${id}`));
    },
    async update(
      id: string,
      input: Partial<{
        title: string;
        pinned: boolean;
        model: ModelId;
        assistant_id: string;
        temperature: number;
        reasoning_effort: ReasoningEffort;
      }>,
    ): Promise<Conversation> {
      return mapConversation(
        await request<RawConversation>(`/conversations/${id}`, { method: "PATCH", body: input }),
      );
    },
    remove: (id: string) => request(`/conversations/${id}`, { method: "DELETE" }),
  },

  messages: {
    send: (
      conversationId: string,
      input: { content: string; model?: ModelId },
      handlers: StreamHandlers,
    ) => stream(`/conversations/${conversationId}/messages`, { ...input, stream: true }, handlers),
    regenerate: (messageId: string, handlers: StreamHandlers) =>
      stream(`/messages/${messageId}/regenerate`, { stream: true }, handlers),
    stop: (messageId: string) => request(`/messages/${messageId}/stop`, { method: "POST" }),
    feedback: (messageId: string, rating: "up" | "down") =>
      request(`/messages/${messageId}/feedback`, { method: "POST", body: { rating } }),
  },

  templates: {
    async list(category?: string): Promise<Template[]> {
      const q = category && category !== "全部" ? `?category=${encodeURIComponent(category)}` : "";
      return (await request<RawTemplate[]>(`/templates${q}`, { auth: false })).map(mapTemplate);
    },
    async get(id: string): Promise<Template> {
      return mapTemplate(await request<RawTemplate>(`/templates/${id}`, { auth: false }));
    },
  },

  creations: {
    create: (
      input: { template_id: string; inputs: Record<string, unknown> },
      handlers: StreamHandlers,
    ) => stream("/creations", { ...input, stream: true }, handlers),
    async list(): Promise<Creation[]> {
      return (await request<RawCreation[]>("/creations")).map(mapCreation);
    },
    remove: (id: string) => request(`/creations/${id}`, { method: "DELETE" }),
  },

  images: {
    /** 生图参数目录 + 当前套餐权益与余量 */
    async options(): Promise<ImageOptions> {
      return mapImageOptions(await request<RawImageOptions>("/images/options"));
    },

    /** 我的作品（默认仅生成与变体） */
    async list(params?: {
      page?: number;
      pageSize?: number;
      source?: MediaSourceKind;
    }): Promise<MediaAsset[]> {
      const q = new URLSearchParams();
      if (params?.page) q.set("page", String(params.page));
      if (params?.pageSize) q.set("page_size", String(params.pageSize));
      if (params?.source) q.set("source", params.source);
      const qs = q.toString();
      const rows = await request<RawMediaAsset[]>(`/images${qs ? `?${qs}` : ""}`);
      return rows.map(mapMediaAsset);
    },

    /** 文生图（SSE 流式，逐张回调） */
    generate: (params: ImageGenerateParams, handlers: ImageStreamHandlers) =>
      imageStream("/images/generations", { ...params, stream: true }, handlers),

    /** 变体重绘 */
    variation: (
      id: string,
      input: { prompt?: string; size?: ImageSizeId },
      handlers: ImageStreamHandlers,
    ) => imageStream(`/images/${id}/variations`, input, handlers),

    remove: (id: string) => request(`/images/${id}`, { method: "DELETE" }),

    /** 上传图片（multipart/form-data，供看图问答使用） */
    async upload(file: File): Promise<MediaAsset> {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${BASE_URL}/images/uploads`, { method: "POST", body: form });
      const text = await res.text();
      const json = text ? JSON.parse(text) : {};
      if (!res.ok) {
        const err = json.error ?? { code: "unknown", message: `HTTP ${res.status}` };
        throw new ApiError(err.code, err.message, err.details);
      }
      return mapMediaAsset((json.data ?? json) as RawMediaAsset);
    },

    /** 看图问答（SSE 文本流，事件结构与对话一致）。传 conversationId 时后端会落库 */
    analyze: (
      input: { imageUrls: string[]; question: string; conversationId?: string },
      handlers: StreamHandlers,
    ) =>
      stream(
        "/images/analyses",
        {
          image_urls: input.imageUrls,
          question: input.question,
          ...(input.conversationId ? { conversation_id: input.conversationId } : {}),
          stream: true,
        },
        handlers,
      ),

    /** 图 → 文案的用途与语气目录 */
    async captionOptions(): Promise<CaptionOptions> {
      const raw = await request<{
        purposes: CaptionOptions["purposes"];
        tones: CaptionOptions["tones"];
        defaults: CaptionOptions["defaults"];
        limits: { plan: PlanId; vision: boolean; max_images: number };
        mock: boolean;
      }>("/images/caption-options");
      return {
        purposes: raw.purposes,
        tones: raw.tones,
        defaults: raw.defaults,
        limits: {
          plan: raw.limits.plan,
          vision: raw.limits.vision,
          maxImages: raw.limits.max_images,
        },
        mock: raw.mock,
      };
    },

    /** 图 → 文案（SSE 文本流） */
    caption: (
      input: {
        imageUrls: string[];
        purpose?: string;
        tone?: string;
        brief?: string;
      },
      handlers: StreamHandlers,
    ) =>
      stream(
        "/images/captions",
        {
          image_urls: input.imageUrls,
          ...(input.purpose ? { purpose: input.purpose } : {}),
          ...(input.tone ? { tone: input.tone } : {}),
          ...(input.brief ? { brief: input.brief } : {}),
          stream: true,
        },
        handlers,
      ),
  },
};
