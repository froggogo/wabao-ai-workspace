"use client";

import { SWRConfig } from "swr";
import type { ReactNode } from "react";

/**
 * 由服务端组件渲染，把首屏在服务端取到的数据作为 SWR 的初始缓存（fallback）注入，
 * 客户端 hooks 首帧直接命中，无 loading 闪烁，随后再后台重验证。
 * 嵌套在根部 SWRProvider 之下，配置会自动合并。
 */
export function SWRFallback({
  fallback,
  children,
}: {
  fallback: Record<string, unknown>;
  children: ReactNode;
}) {
  return <SWRConfig value={{ fallback }}>{children}</SWRConfig>;
}
