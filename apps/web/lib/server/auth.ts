import type { NextResponse } from "next/server";

// httpOnly cookie 名称。access/refresh 令牌只存在于服务端可读的 httpOnly cookie 中，
// 浏览器 JS 无法访问，避免 XSS 窃取 token。
export const ACCESS_COOKIE = "wabao_access";
export const REFRESH_COOKIE = "wabao_refresh";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 14; // 14 天（与后端 refresh TTL 对齐）

/** 后端 NestJS 内网地址（仅服务端使用，不暴露给浏览器）。 */
export function backendUrl(): string {
  return process.env.API_INTERNAL_URL ?? "http://localhost:3001/api/v1";
}

/**
 * 向后端透传客户端来源地址。
 *
 * 浏览器请求先落到本 BFF，再由服务端转发给 NestJS，后端因此只能看到 BFF 的地址。
 * 若不透传，后端基于 IP 的限流会把全体用户当成同一个调用方。这里把本进程收到的
 * X-Forwarded-For 原样接力（BFF 前置的网关/CDN 已在其中追加了真实客户端地址），
 * 后端配合 trust proxy 即可还原。
 */
export function forwardedForHeaders(req: Request): Record<string, string> {
  const h: Record<string, string> = {};
  const xff = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip");
  if (xff) h["x-forwarded-for"] = xff;
  const proto = req.headers.get("x-forwarded-proto");
  if (proto) h["x-forwarded-proto"] = proto;
  return h;
}

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  };
}

export function setAuthCookies(res: NextResponse, access: string, refresh: string): void {
  const opts = cookieOptions();
  res.cookies.set(ACCESS_COOKIE, access, opts);
  res.cookies.set(REFRESH_COOKIE, refresh, opts);
}

export function clearAuthCookies(res: NextResponse): void {
  const opts = { ...cookieOptions(), maxAge: 0 };
  res.cookies.set(ACCESS_COOKIE, "", opts);
  res.cookies.set(REFRESH_COOKIE, "", opts);
}

export interface BackendTokens {
  access_token: string;
  refresh_token: string;
}

/** 用 refresh token 向后端换取新令牌（后端会轮换 refresh token）。失败返回 null。 */
export async function refreshTokens(refreshToken: string): Promise<BackendTokens | null> {
  try {
    const res = await fetch(`${backendUrl()}/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = await res.json();
    const data = json.data ?? json;
    if (!data?.access_token || !data?.refresh_token) return null;
    return { access_token: data.access_token, refresh_token: data.refresh_token };
  } catch {
    return null;
  }
}

/**
 * 仅解析 JWT payload 的 exp 判断是否过期（不校验签名，签名由后端负责）。
 * 用于中间件决定是否需要提前刷新。留 5s 余量。
 */
export function isJwtExpired(token: string | undefined): boolean {
  if (!token) return true;
  try {
    const payload = token.split(".")[1];
    if (!payload) return true;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(
      typeof atob === "function"
        ? atob(normalized)
        : Buffer.from(normalized, "base64").toString("utf8"),
    );
    if (!json.exp) return true;
    return json.exp * 1000 < Date.now() + 5000;
  } catch {
    return true;
  }
}
