import { NextResponse, type NextRequest } from "next/server";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  backendUrl,
  refreshTokens,
  setAuthCookies,
} from "@/lib/server/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ path: string[] }> };

const RESPONSE_HEADER_ALLOWLIST = ["content-type", "cache-control", "x-quota-remaining"];

async function proxy(req: NextRequest, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params;
  const target = `${backendUrl()}/${path.join("/")}${req.nextUrl.search}`;

  const method = req.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  const body = hasBody ? await req.text() : undefined;

  const forwardHeaders = (access: string | undefined): HeadersInit => {
    const h: Record<string, string> = {};
    const ct = req.headers.get("content-type");
    const accept = req.headers.get("accept");
    if (ct) h["content-type"] = ct;
    if (accept) h["accept"] = accept;
    if (access) h["authorization"] = `Bearer ${access}`;
    return h;
  };

  const call = (access: string | undefined) =>
    fetch(target, {
      method,
      headers: forwardHeaders(access),
      body: body && body.length > 0 ? body : undefined,
      cache: "no-store",
    });

  const access = req.cookies.get(ACCESS_COOKIE)?.value;
  const refresh = req.cookies.get(REFRESH_COOKIE)?.value;

  let upstream = await call(access);
  let rotated: { access_token: string; refresh_token: string } | null = null;

  // access 过期 → 用 refresh 换新令牌后重试一次
  if (upstream.status === 401 && refresh) {
    rotated = await refreshTokens(refresh);
    if (rotated) {
      upstream = await call(rotated.access_token);
    }
  }

  const headers = new Headers();
  for (const name of RESPONSE_HEADER_ALLOWLIST) {
    const v = upstream.headers.get(name);
    if (v) headers.set(name, v);
  }

  const res = new NextResponse(upstream.body, { status: upstream.status, headers });
  if (rotated) {
    setAuthCookies(res, rotated.access_token, rotated.refresh_token);
  }
  return res;
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
