import type {
  Assistant,
  ChatMessage,
  Conversation,
  Creation,
  ModelId,
  ModerationRecord,
  ReasoningEffort,
  Template,
  UsageBreakdown,
} from "./types";

const BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:3001/api/v1";

const ACCESS_KEY = "wabao_access";
const REFRESH_KEY = "wabao_refresh";

// ---------------- Token 管理 ----------------

export const tokens = {
  get access() {
    return localStorage.getItem(ACCESS_KEY);
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY);
  },
  set(access: string, refresh: string) {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

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
  auth?: boolean;
  retry?: boolean;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, auth = true, retry = true } = opts;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth && tokens.access) {
    headers.Authorization = `Bearer ${tokens.access}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && auth && retry && tokens.refresh) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      return request<T>(path, { ...opts, retry: false });
    }
  }

  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = json.error ?? { code: "unknown", message: `HTTP ${res.status}` };
    throw new ApiError(err.code, err.message, err.details);
  }
  return (json.data ?? json) as T;
}

let refreshing: Promise<boolean> | null = null;
async function tryRefresh(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const res = await fetch(`${BASE_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: tokens.refresh }),
      });
      if (!res.ok) return false;
      const json = await res.json();
      tokens.set(json.data.access_token, json.data.refresh_token);
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

// ---------------- SSE 流式 ----------------

export interface StreamHandlers {
  onStart?: (id: string) => void;
  onDelta?: (text: string) => void;
  onDone?: (data: { finish_reason?: string; usage?: unknown; output_json?: unknown }) => void;
  onError?: (err: ApiError) => void;
  signal?: AbortSignal;
}

async function stream(path: string, body: unknown, handlers: StreamHandlers): Promise<void> {
  const doFetch = (): Promise<Response> =>
    fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...(tokens.access ? { Authorization: `Bearer ${tokens.access}` } : {}),
      },
      body: JSON.stringify(body),
      signal: handlers.signal,
    });

  let res = await doFetch();
  if (res.status === 401 && tokens.refresh && (await tryRefresh())) {
    res = await doFetch();
  }

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

// ---------------- 映射：后端 snake_case → 前端类型 ----------------

interface RawMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  model?: ModelId;
  flagged?: boolean;
  created_at?: string;
}

function mapMessage(m: RawMessage): ChatMessage {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    model: m.model,
    flagged: m.flagged,
    createdAt: m.created_at ? Date.parse(m.created_at) : Date.now(),
  };
}

interface RawConversation {
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

function mapConversation(c: RawConversation): Conversation {
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

interface RawAssistant {
  id: string;
  name: string;
  avatar: string;
  system_prompt: string;
  default_model: ModelId;
}

function mapAssistant(a: RawAssistant): Assistant {
  return {
    id: a.id,
    name: a.name,
    avatar: a.avatar,
    systemPrompt: a.system_prompt,
    defaultModel: a.default_model,
  };
}

interface RawTemplate {
  id: string;
  name: string;
  category: string;
  icon: string;
  description: string;
  input_schema: { fields?: Template["fields"] };
  structured?: boolean;
}

function mapTemplate(t: RawTemplate): Template {
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

interface RawCreation {
  id: string;
  template_id: string;
  template_name: string;
  output: string;
  created_at: string;
}

function mapCreation(c: RawCreation): Creation {
  return {
    id: c.id,
    templateId: c.template_id,
    templateName: c.template_name,
    output: c.output,
    createdAt: Date.parse(c.created_at),
  };
}

// ---------------- 业务 API ----------------

export interface AuthResult {
  user: { id: string; email: string; name: string };
  access_token: string;
  refresh_token: string;
}

export const api = {
  auth: {
    async register(email: string, password: string, name?: string): Promise<AuthResult> {
      const data = await request<AuthResult>("/auth/register", {
        method: "POST",
        auth: false,
        body: { email, password, name },
      });
      tokens.set(data.access_token, data.refresh_token);
      return data;
    },
    async login(email: string, password: string): Promise<AuthResult> {
      const data = await request<AuthResult>("/auth/login", {
        method: "POST",
        auth: false,
        body: { email, password },
      });
      tokens.set(data.access_token, data.refresh_token);
      return data;
    },
    async logout(): Promise<void> {
      const refresh = tokens.refresh;
      if (refresh) {
        await request("/auth/logout", { method: "POST", body: { refresh_token: refresh } }).catch(
          () => undefined,
        );
      }
      tokens.clear();
    },
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

  moderation: {
    async records(params?: { page?: number; flagged?: boolean }): Promise<ModerationRecord[]> {
      const q = new URLSearchParams();
      if (params?.page) q.set("page", String(params.page));
      if (params?.flagged !== undefined) q.set("flagged", String(params.flagged));
      const qs = q.toString();
      // 后端返回 { data: [...], pagination }，request 已解包出 data 数组
      const rows = await request<
        {
          id: string;
          ref_type: "input" | "output";
          flagged: boolean;
          categories: string[];
          action: "block" | "warn";
          created_at: string;
        }[]
      >(`/admin/moderation-records${qs ? `?${qs}` : ""}`);
      return rows.map((r) => ({
        id: r.id,
        refType: r.ref_type,
        flagged: r.flagged,
        categories: Array.isArray(r.categories) ? r.categories : [],
        action: r.action,
        createdAt: Date.parse(r.created_at),
      }));
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
      return (await request<RawConversation[]>("/conversations")).map(mapConversation);
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
