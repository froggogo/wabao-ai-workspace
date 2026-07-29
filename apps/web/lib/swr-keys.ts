// SWR 缓存键集中管理。全部使用「字符串键」，这样服务端组件可以直接用同名键
// 播种 SWRConfig 的 fallback（首屏服务端取数），无需 unstable_serialize。
export const swrKeys = {
  user: "user:me" as const,
  conversations: "conversations" as const,
  conversation: (id: string) => `conversation:${id}`,
  assistants: "assistants" as const,
  templates: (category?: string) => `templates:${category ?? "全部"}`,
  template: (id: string) => `template:${id}`,
  creations: "creations" as const,
  usage: (period?: string) => `usage:${period ?? "current"}`,
  subscription: "subscription" as const,
  moderation: (onlyFlagged: boolean) => `moderation:${onlyFlagged}`,
};
