"use client";

import useSWR, { useSWRConfig } from "swr";
import { useCallback } from "react";
import { api } from "./api";
import { swrKeys } from "./swr-keys";
import type { PlanId, UserMe } from "./types";

export type { UserMe };

// ---------------- 用户 / 鉴权 ----------------

/**
 * 当前登录用户。/app 子树由服务端守卫保证已登录，并通过 SWR fallback 播种首屏数据，
 * 因此这里始终以 swrKeys.user 拉取（命中 fallback 时无闪烁），失败视为未登录。
 */
export function useUser() {
  const { data, error, isLoading, mutate } = useSWR<UserMe>(swrKeys.user, async () => {
    const me = await api.users.me();
    return { ...me, plan: (me.plan as PlanId) ?? "free" };
  });
  return {
    user: data,
    error,
    isLoading,
    isLoggedIn: !!data,
    mutate,
  };
}

/** 登录 / 注册 / 登出：完成后刷新用户与相关缓存。 */
export function useAuthActions() {
  const { mutate } = useSWRConfig();

  const login = useCallback(
    async (email: string, password: string) => {
      await api.auth.login(email, password);
      await mutate(swrKeys.user);
    },
    [mutate],
  );

  const register = useCallback(
    async (email: string, password: string, name?: string) => {
      await api.auth.register(email, password, name);
      await mutate(swrKeys.user);
    },
    [mutate],
  );

  const logout = useCallback(async () => {
    await api.auth.logout();
    // 清空所有缓存，避免下一个账号看到上一个账号的数据
    await mutate(() => true, undefined, { revalidate: false });
  }, [mutate]);

  return { login, register, logout };
}

// ---------------- 会话 ----------------

export function useConversations() {
  const { data, error, isLoading, mutate } = useSWR(swrKeys.conversations, () =>
    api.conversations.list(),
  );
  return { conversations: data ?? [], error, isLoading, mutate };
}

export function useConversation(id: string | null) {
  const { data, error, isLoading, mutate } = useSWR(
    id ? swrKeys.conversation(id) : null,
    () => api.conversations.get(id as string),
  );
  return { conversation: data, error, isLoading, mutate };
}

// ---------------- 助手 ----------------

export function useAssistants() {
  const { data, error, isLoading, mutate } = useSWR(swrKeys.assistants, () =>
    api.assistants.list(),
  );
  return { assistants: data ?? [], error, isLoading, mutate };
}

// ---------------- 模板 ----------------

export function useTemplates(category?: string) {
  const { data, error, isLoading } = useSWR(swrKeys.templates(category), () =>
    api.templates.list(category),
  );
  return { templates: data ?? [], error, isLoading };
}

export function useTemplate(id: string | null) {
  const { data, error, isLoading } = useSWR(id ? swrKeys.template(id) : null, () =>
    api.templates.get(id as string),
  );
  return { template: data, error, isLoading };
}

// ---------------- 创作 ----------------

export function useCreations() {
  const { data, error, isLoading, mutate } = useSWR(swrKeys.creations, () =>
    api.creations.list(),
  );
  return { creations: data ?? [], error, isLoading, mutate };
}

// ---------------- 用量 / 订阅 ----------------

export function useUsage(period?: string) {
  const { data, error, isLoading } = useSWR(swrKeys.usage(period), () =>
    api.users.usage(period),
  );
  return { usage: data, error, isLoading };
}

export function useSubscription() {
  const { data, error, isLoading, mutate } = useSWR(swrKeys.subscription, () =>
    api.billing.subscription(),
  );
  return { subscription: data, error, isLoading, mutate };
}

// ---------------- 审核记录 ----------------

export function useModerationRecords(onlyFlagged: boolean) {
  const { data, error, isLoading } = useSWR(swrKeys.moderation(onlyFlagged), () =>
    api.moderation.records(onlyFlagged ? { flagged: true } : undefined),
  );
  return { records: data, error, isLoading };
}

// ---------------- 图像与多模态（P2 · M5） ----------------

/** 生图参数目录（模型/尺寸/风格 + 当前套餐权益与余量） */
export function useImageOptions() {
  const { data, error, isLoading, mutate } = useSWR(swrKeys.imageOptions, () =>
    api.images.options(),
  );
  return { options: data, error, isLoading, mutate };
}

/** 我的作品（AI 生成图与变体） */
export function useMediaAssets() {
  const { data, error, isLoading, mutate } = useSWR(swrKeys.images, () =>
    api.images.list({ pageSize: 60 }),
  );
  return { assets: data ?? [], error, isLoading, mutate };
}

/** 图 → 文案的用途与语气目录 */
export function useCaptionOptions() {
  const { data, error, isLoading } = useSWR(swrKeys.captionOptions, () =>
    api.images.captionOptions(),
  );
  return { options: data, error, isLoading };
}
