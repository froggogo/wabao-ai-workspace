import {
  mapAssistant,
  mapConversation,
  mapCreation,
  mapModerationRecord,
  mapTemplate,
  type RawAssistant,
  type RawConversation,
  type RawCreation,
  type RawModerationRecord,
  type RawTemplate,
} from "./mappers";
import type {
  Assistant,
  Conversation,
  Creation,
  ModelId,
  ModerationRecord,
  ReasoningEffort,
  Template,
  UsageBreakdown,
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
      request<{
        period: string;
        plan: string;
        quota_tokens: number;
        used_tokens: number;
        remaining_tokens: number;
        breakdown: UsageBreakdown[];
      }>(`/usage${period ? `?period=${period}` : ""}`),
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
};
