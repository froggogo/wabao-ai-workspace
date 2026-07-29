import { NextResponse, type NextRequest } from "next/server";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  clearAuthCookies,
  isJwtExpired,
  refreshTokens,
  setAuthCookies,
} from "@/lib/server/auth";

/**
 * 保护 /app/* 路由：
 * - access 令牌有效 → 放行；
 * - access 缺失/过期但 refresh 有效 → 服务端换取新令牌，写回 cookie，并把新令牌注入本次请求
 *   头，让同一请求的 RSC 立即读到新令牌（避免刚刷新又被守卫踢到登录页）；
 * - 都无效 → 重定向到 /login 并清理残留 cookie。
 */
export async function middleware(req: NextRequest) {
  const access = req.cookies.get(ACCESS_COOKIE)?.value;
  const refresh = req.cookies.get(REFRESH_COOKIE)?.value;

  if (access && !isJwtExpired(access)) {
    return NextResponse.next();
  }

  if (refresh) {
    const rotated = await refreshTokens(refresh);
    if (rotated) {
      const others = req.cookies
        .getAll()
        .filter((c) => c.name !== ACCESS_COOKIE && c.name !== REFRESH_COOKIE)
        .map((c) => `${c.name}=${c.value}`);
      const cookieHeader = [
        ...others,
        `${ACCESS_COOKIE}=${rotated.access_token}`,
        `${REFRESH_COOKIE}=${rotated.refresh_token}`,
      ].join("; ");

      const requestHeaders = new Headers(req.headers);
      requestHeaders.set("cookie", cookieHeader);

      const res = NextResponse.next({ request: { headers: requestHeaders } });
      setAuthCookies(res, rotated.access_token, rotated.refresh_token);
      return res;
    }
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  const res = NextResponse.redirect(url);
  clearAuthCookies(res);
  return res;
}

export const config = {
  matcher: ["/app/:path*"],
};
