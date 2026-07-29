"use client";

import { SWRConfig } from "swr";
import type { ReactNode } from "react";

/**
 * 全局 SWR 配置。整个前端的服务端状态都经由 SWR 管理：
 * - 关闭窗口聚焦自动重验证，避免打断 SSE 流式输出与频繁请求；
 * - keepPreviousData 让切换会话/分类时保留上一份数据，减少闪烁。
 */
export function SWRProvider({ children }: { children: ReactNode }) {
  return (
    <SWRConfig
      value={{
        revalidateOnFocus: false,
        keepPreviousData: true,
        shouldRetryOnError: false,
      }}
    >
      {children}
    </SWRConfig>
  );
}
