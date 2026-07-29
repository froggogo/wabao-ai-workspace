import { cookies } from "next/headers";
import { ACCESS_COOKIE, backendUrl } from "./auth";
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
} from "../mappers";
import type {
  Assistant,
  Conversation,
  Creation,
  ModerationRecord,
  PlanId,
  Template,
  UsageResult,
  UserMe,
} from "../types";

/**
 * 服务端组件专用的后端请求：读取 httpOnly cookie 里的 access token，
 * 以 Bearer 方式直连 NestJS（服务端到服务端，绕过浏览器）。
 * 令牌新鲜度由 middleware 负责（导航前按需刷新），此处不再刷新。
 */
async function serverFetch<T>(path: string): Promise<T | null> {
  const store = await cookies();
  const access = store.get(ACCESS_COOKIE)?.value;
  if (!access) return null;
  try {
    const res = await fetch(`${backendUrl()}${path}`, {
      headers: { Authorization: `Bearer ${access}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = await res.json();
    return (json.data ?? json) as T;
  } catch {
    return null;
  }
}

export async function getServerUser(): Promise<UserMe | null> {
  const me = await serverFetch<{
    id: string;
    email: string;
    name: string;
    avatar: string | null;
    plan: string;
  }>("/users/me");
  if (!me) return null;
  return { ...me, plan: (me.plan as PlanId) ?? "free" };
}

export async function getServerConversations(): Promise<Conversation[]> {
  const rows = await serverFetch<RawConversation[]>("/conversations?page=1&page_size=100");
  return (rows ?? []).map(mapConversation);
}

export async function getServerConversation(id: string): Promise<Conversation | undefined> {
  const row = await serverFetch<RawConversation>(`/conversations/${id}`);
  return row ? mapConversation(row) : undefined;
}

export async function getServerAssistants(): Promise<Assistant[]> {
  const rows = await serverFetch<RawAssistant[]>("/assistants");
  return (rows ?? []).map(mapAssistant);
}

export async function getServerTemplates(category?: string): Promise<Template[]> {
  const q = category && category !== "全部" ? `?category=${encodeURIComponent(category)}` : "";
  const rows = await serverFetch<RawTemplate[]>(`/templates${q}`);
  return (rows ?? []).map(mapTemplate);
}

export async function getServerTemplate(id: string): Promise<Template | undefined> {
  const row = await serverFetch<RawTemplate>(`/templates/${id}`);
  return row ? mapTemplate(row) : undefined;
}

export async function getServerCreations(): Promise<Creation[]> {
  const rows = await serverFetch<RawCreation[]>("/creations");
  return (rows ?? []).map(mapCreation);
}

export async function getServerUsage(period?: string): Promise<UsageResult | undefined> {
  const usage = await serverFetch<UsageResult>(`/usage${period ? `?period=${period}` : ""}`);
  return usage ?? undefined;
}

export async function getServerModerationRecords(onlyFlagged: boolean): Promise<ModerationRecord[]> {
  const qs = onlyFlagged ? "?flagged=true" : "";
  const rows = await serverFetch<RawModerationRecord[]>(`/admin/moderation-records${qs}`);
  return (rows ?? []).map(mapModerationRecord);
}
