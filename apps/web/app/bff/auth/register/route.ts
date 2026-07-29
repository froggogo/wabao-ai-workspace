import { NextResponse } from "next/server";
import { backendUrl, setAuthCookies } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.text();
  const upstream = await fetch(`${backendUrl()}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    cache: "no-store",
  });
  const json = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    return NextResponse.json(json, { status: upstream.status });
  }
  const data = json.data ?? json;
  const res = NextResponse.json({ data: { user: data.user } });
  setAuthCookies(res, data.access_token, data.refresh_token);
  return res;
}
