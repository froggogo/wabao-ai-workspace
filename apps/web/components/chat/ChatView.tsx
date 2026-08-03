"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import { api } from "@/lib/api";
import { MODELS, PLAN_ALLOWED_MODELS } from "@/lib/mockData";
import { swrKeys } from "@/lib/swr-keys";
import { useAssistants, useConversation, useConversations, useImageOptions, useUser } from "@/lib/hooks";
import { Markdown } from "@/components/Markdown";
import type { ChatMessage, Conversation, ModelId, ReasoningEffort } from "@/lib/types";

let seq = 100;
const genId = (p: string) => `${p}_${++seq}`;

const REASONING_OPTIONS: { id: ReasoningEffort; label: string }[] = [
  { id: "low", label: "快速" },
  { id: "medium", label: "均衡" },
  { id: "high", label: "深度" },
];
export function ChatView({ conversationId }: { conversationId?: string }) {
  const router = useRouter();
  const { mutate: globalMutate } = useSWRConfig();
  const { conversations, mutate: mutateList } = useConversations();
  const { assistants } = useAssistants();
  const { user } = useUser();
  const { options: imageOptions } = useImageOptions();
  const userPlan = user?.plan ?? "free";
  // 看图问答属进阶权益，免费版仅展示升级引导
  const canVision = imageOptions?.limits.vision ?? false;

  // 无会话 id 时自动跳到第一个会话
  useEffect(() => {
    if (!conversationId && conversations.length > 0) {
      router.replace(`/app/chat/${conversations[0].id}`);
    }
  }, [conversationId, conversations, router]);

  const activeId = conversationId ?? null;
  const { conversation: active, mutate: mutateConv } = useConversation(activeId);

  const [query, setQuery] = useState("");
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const currentAiRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showSettings, setShowSettings] = useState(true);
  // 多模态附件（图片 URL），发送后随消息一起走 Vision 看图问答
  const [attachments, setAttachments] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const grouped = useMemo(() => groupConversations(conversations, query), [conversations, query]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [active?.messages.length, streaming]);

  // ---------------- 会话缓存更新工具（SWR） ----------------

  const patchMessages = (fn: (msgs: ChatMessage[]) => ChatMessage[]) =>
    mutateConv(
      (prev) => (prev ? { ...prev, messages: fn(prev.messages) } : prev),
      { revalidate: false },
    );

  const addMessage = (msg: ChatMessage) => patchMessages((msgs) => [...msgs, msg]);
  const updateMessage = (id: string, patch: Partial<ChatMessage>) =>
    patchMessages((msgs) => msgs.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const replaceMessageId = (oldId: string, newId: string) =>
    patchMessages((msgs) => msgs.map((m) => (m.id === oldId ? { ...m, id: newId } : m)));

  const patchList = (id: string, patch: Partial<Conversation>) =>
    mutateList(
      (list) => (list ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c)),
      { revalidate: false },
    );
  const patchActive = (patch: Partial<Conversation>) =>
    mutateConv((prev) => (prev ? { ...prev, ...patch } : prev), { revalidate: false });

  // ---------------- 会话操作 ----------------

  const newConversation = async () => {
    const conv = await api.conversations.create({ model: "gpt-5.6-terra" });
    await mutateList((list) => [conv, ...(list ?? [])], { revalidate: false });
    globalMutate(swrKeys.conversation(conv.id), conv, { revalidate: false });
    router.push(`/app/chat/${conv.id}`);
  };

  const removeConversation = async (id: string) => {
    await api.conversations.remove(id).catch(() => undefined);
    await mutateList((list) => (list ?? []).filter((c) => c.id !== id), { revalidate: false });
    router.replace("/app/chat");
  };

  const renameConversation = async (id: string, title: string) => {
    patchList(id, { title });
    if (id === activeId) patchActive({ title });
    await api.conversations.update(id, { title }).catch(() => undefined);
  };

  const togglePin = async (id: string) => {
    const conv = conversations.find((c) => c.id === id);
    const pinned = !conv?.pinned;
    patchList(id, { pinned });
    await api.conversations.update(id, { pinned }).catch(() => undefined);
  };

  const setConversationModel = async (id: string, model: ModelId) => {
    patchActive({ model });
    patchList(id, { model });
    await api.conversations.update(id, { model }).catch(() => undefined);
  };
  const setConversationAssistant = async (id: string, assistantId: string) => {
    patchActive({ assistantId });
    await api.conversations.update(id, { assistant_id: assistantId }).catch(() => undefined);
  };
  const setConversationTemperature = async (id: string, temperature: number) => {
    patchActive({ temperature });
    await api.conversations.update(id, { temperature }).catch(() => undefined);
  };
  const setConversationReasoning = async (id: string, reasoningEffort: ReasoningEffort) => {
    patchActive({ reasoningEffort });
    await api.conversations.update(id, { reasoning_effort: reasoningEffort }).catch(() => undefined);
  };

  const rateMessage = (msgId: string, rating: "up" | "down") => {
    updateMessage(msgId, { rating });
    api.messages.feedback(msgId, rating).catch(() => undefined);
  };

  // ---------------- 附件（图像理解） ----------------

  const pickFiles = () => fileRef.current?.click();

  const onFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadError("");
    setUploading(true);
    try {
      // 逐个上传，成功的立即进入待发送附件列表
      for (const file of Array.from(files).slice(0, 4)) {
        const asset = await api.images.upload(file);
        setAttachments((prev) => [...prev, asset.url]);
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "图片上传失败");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeAttachment = (url: string) =>
    setAttachments((prev) => prev.filter((u) => u !== url));

  // ---------------- 发送 / 停止 / 重新生成 ----------------

  const send = async () => {
    const text = input.trim();
    if ((!text && attachments.length === 0) || streaming || !active) return;
    const convId = active.id;
    const model = active.model;
    const imgs = attachments;
    // 带图时走 Vision 看图问答；没写问题则给一个默认提问
    const isVision = imgs.length > 0;
    const question = text || (isVision ? "请描述并解读这张图片" : "");
    setInput("");
    setAttachments([]);

    const isFirstUserMsg = active.messages.filter((m) => m.role === "user").length === 0;
    addMessage({
      id: genId("m"),
      role: "user",
      content: question,
      attachments: isVision ? imgs : undefined,
      createdAt: Date.now(),
    });
    if (isFirstUserMsg) {
      const title = question.slice(0, 18);
      patchActive({ title });
      patchList(convId, { title });
    }

    const tempAiId = genId("m");
    currentAiRef.current = tempAiId;
    addMessage({
      id: tempAiId,
      role: "assistant",
      content: "",
      model,
      streaming: true,
      createdAt: Date.now(),
    });

    setStreaming(true);
    const ac = new AbortController();
    abortRef.current = ac;
    let acc = "";

    const handlers = {
      signal: ac.signal,
      onStart: (id: string) => {
        if (!id) return;
        replaceMessageId(currentAiRef.current!, id);
        currentAiRef.current = id;
      },
      onDelta: (t: string) => {
        acc += t;
        updateMessage(currentAiRef.current!, { content: acc });
      },
      onDone: (data: {
        flagged?: boolean;
        filtered_content?: string;
        message_id?: string;
      }) => {
        // 看图问答的真实消息 id 在 done 事件中返回（start 时尚未落库），
        // 这里同步过来，保证后续重新生成 / 评分等操作作用于正确的消息。
        if (data.message_id && currentAiRef.current !== data.message_id) {
          replaceMessageId(currentAiRef.current!, data.message_id);
          currentAiRef.current = data.message_id;
        }
        if (data.flagged) {
          updateMessage(currentAiRef.current!, {
            content: data.filtered_content ?? "⚠️ 该回复包含不符合规范的内容，已被拦截。",
            flagged: true,
            streaming: false,
          });
        }
      },
      onError: (err: { message: string }) => {
        updateMessage(currentAiRef.current!, {
          content: `⚠️ ${err.message}`,
          flagged: true,
          streaming: false,
        });
      },
    };

    try {
      if (isVision) {
        // 传入会话 id，让后端把带图提问与回复一并落库，刷新后可回看
        await api.images.analyze(
          { imageUrls: imgs, question, conversationId: convId },
          handlers,
        );
      } else {
        await api.messages.send(convId, { content: question, model }, handlers);
      }
    } finally {
      if (currentAiRef.current) updateMessage(currentAiRef.current, { streaming: false });
      setStreaming(false);
      abortRef.current = null;
      // 后端可能更新了标题/时间，回源刷新列表
      mutateList();
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    if (currentAiRef.current) api.messages.stop(currentAiRef.current).catch(() => undefined);
  };

  const regenerate = async (aiId: string) => {
    if (!active || streaming) return;
    currentAiRef.current = aiId;
    updateMessage(aiId, { content: "", streaming: true, flagged: false });
    setStreaming(true);
    const ac = new AbortController();
    abortRef.current = ac;
    let acc = "";
    try {
      await api.messages.regenerate(aiId, {
        signal: ac.signal,
        onStart: (id) => {
          replaceMessageId(currentAiRef.current!, id);
          currentAiRef.current = id;
        },
        onDelta: (t) => {
          acc += t;
          updateMessage(currentAiRef.current!, { content: acc });
        },
        onDone: (data) => {
          if (data.flagged) {
            updateMessage(currentAiRef.current!, {
              content: data.filtered_content ?? "⚠️ 该回复包含不符合规范的内容，已被拦截。",
              flagged: true,
              streaming: false,
            });
          }
        },
        onError: (err) => {
          updateMessage(currentAiRef.current!, {
            content: `⚠️ ${err.message}`,
            flagged: true,
            streaming: false,
          });
        },
      });
    } finally {
      if (currentAiRef.current) updateMessage(currentAiRef.current, { streaming: false });
      setStreaming(false);
      abortRef.current = null;
    }
  };

  return (
    <div className="flex h-full">
      {/* 会话列表 */}
      <div className="flex w-72 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="p-3">
          <button
            onClick={() => newConversation()}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-2.5 text-sm font-medium text-white shadow-md shadow-brand-600/25 transition hover:bg-brand-700"
          >
            <span className="text-lg leading-none">＋</span> 新建会话
          </button>
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2">
            <span className="text-slate-400">🔍</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索会话"
              className="w-full bg-transparent text-sm outline-none"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {grouped.map((g) => (
            <div key={g.label} className="mb-2">
              <div className="px-2 py-1 text-xs font-medium text-slate-400">{g.label}</div>
              {g.items.map((c) => (
                <ConversationItem
                  key={c.id}
                  conv={c}
                  active={c.id === activeId}
                  onOpen={() => router.push(`/app/chat/${c.id}`)}
                  onDelete={() => removeConversation(c.id)}
                  onPin={() => togglePin(c.id)}
                  onRename={(t) => renameConversation(c.id, t)}
                />
              ))}
            </div>
          ))}
          {grouped.length === 0 && (
            <div className="px-3 py-8 text-center text-sm text-slate-400">没有匹配的会话</div>
          )}
        </div>
      </div>

      {/* 消息区 */}
      <div className="flex min-w-0 flex-1 flex-col bg-slate-50">
        {active ? (
          <>
            <header className="flex items-center justify-between border-b border-slate-200 bg-white/80 px-5 py-3 backdrop-blur">
              <div className="truncate font-medium text-slate-800">{active.title}</div>
              <button
                onClick={() => setShowSettings((v) => !v)}
                className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
              >
                ⚙️ 会话设置
              </button>
            </header>

            <div ref={scrollRef} className="flex-1 space-y-5 overflow-y-auto px-4 py-6 md:px-10">
              {active.messages.length === 0 && <EmptyChat />}
              {active.messages.map((m) => (
                <div key={m.id} className="animate-in">
                  {m.role === "user" ? (
                    <div className="flex justify-end">
                      <div className="max-w-[75%] rounded-2xl rounded-br-md bg-brand-600 px-4 py-2.5 text-[15px] text-white shadow-sm">
                        {m.attachments && m.attachments.length > 0 && (
                          <div
                            className={`mb-2 grid gap-1.5 ${
                              m.attachments.length > 1 ? "grid-cols-2" : "grid-cols-1"
                            }`}
                          >
                            {m.attachments.map((url) => (
                              <a
                                key={url}
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                className="block overflow-hidden rounded-xl ring-1 ring-white/25"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={url}
                                  alt="上传的图片"
                                  loading="lazy"
                                  className="max-h-48 w-full object-cover"
                                />
                              </a>
                            ))}
                          </div>
                        )}
                        {m.content}
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-3">
                      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-lg shadow ring-1 ring-slate-100">
                        🤖
                      </div>
                      <div className="max-w-[80%]">
                        <div
                          className={`rounded-2xl rounded-tl-md bg-white px-4 py-3 shadow-sm ring-1 ring-slate-100 ${
                            m.flagged ? "text-amber-600" : ""
                          } ${m.streaming ? "cursor-blink" : ""}`}
                        >
                          {m.content ? (
                            <Markdown text={m.content} />
                          ) : (
                            <span className="text-slate-400">思考中…</span>
                          )}
                        </div>
                        {!m.streaming && !m.flagged && m.content && (
                          <div className="mt-1 flex items-center gap-1 text-slate-400">
                            <IconBtn title="复制" onClick={() => navigator.clipboard?.writeText(m.content)}>
                              📋
                            </IconBtn>
                            <IconBtn title="重新生成" onClick={() => regenerate(m.id)}>
                              🔄
                            </IconBtn>
                            <IconBtn title="赞" active={m.rating === "up"} onClick={() => rateMessage(m.id, "up")}>
                              👍
                            </IconBtn>
                            <IconBtn
                              title="踩"
                              active={m.rating === "down"}
                              onClick={() => rateMessage(m.id, "down")}
                            >
                              👎
                            </IconBtn>
                            {m.model && (
                              <span className="ml-1 text-[11px] text-slate-300">
                                {MODELS.find((x) => x.id === m.model)?.name}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* 输入框 */}
            <div className="border-t border-slate-200 bg-white px-4 py-3 md:px-10">
              {/* 待发送附件预览 */}
              {(attachments.length > 0 || uploading || uploadError) && (
                <div className="mx-auto mb-2 flex max-w-3xl flex-wrap items-center gap-2">
                  {attachments.map((url) => (
                    <div
                      key={url}
                      className="group relative h-16 w-16 overflow-hidden rounded-xl ring-1 ring-slate-200"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="附件" className="h-full w-full object-cover" />
                      <button
                        onClick={() => removeAttachment(url)}
                        title="移除"
                        className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900/70 text-[10px] text-white opacity-0 transition group-hover:opacity-100"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  {uploading && (
                    <div className="flex h-16 w-16 animate-pulse items-center justify-center rounded-xl bg-slate-100 text-xs text-slate-400">
                      上传中
                    </div>
                  )}
                  {uploadError && (
                    <span className="text-xs text-red-500">⚠️ {uploadError}</span>
                  )}
                  {attachments.length > 0 && (
                    <span className="text-[11px] text-slate-400">
                      已附 {attachments.length} 张图，发送后将进行看图问答
                    </span>
                  )}
                </div>
              )}

              <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  multiple
                  hidden
                  onChange={(e) => onFilesSelected(e.target.files)}
                />
                <button
                  onClick={() => (canVision ? pickFiles() : router.push("/app/pricing"))}
                  disabled={streaming || uploading}
                  title={
                    canVision
                      ? "上传图片提问（看图问答）"
                      : "看图问答需升级套餐，点击查看"
                  }
                  className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg transition hover:bg-slate-200 disabled:opacity-40 ${
                    canVision ? "text-slate-400 hover:text-slate-600" : "text-slate-300"
                  }`}
                >
                  🖼️
                  {!canVision && (
                    <span className="absolute -right-0.5 -top-0.5 text-[9px]">🔒</span>
                  )}
                </button>
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  rows={1}
                  placeholder={
                    attachments.length > 0
                      ? "问问这张图片…（留空则默认解读图片）"
                      : "输入消息，Enter 发送 / Shift+Enter 换行"
                  }
                  className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] outline-none"
                />
                {streaming ? (
                  <button
                    onClick={stop}
                    className="rounded-xl bg-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-300"
                  >
                    ⏹ 停止
                  </button>
                ) : (
                  <button
                    onClick={send}
                    disabled={!input.trim() && attachments.length === 0}
                    className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white transition enabled:hover:bg-brand-700 disabled:opacity-40"
                  >
                    发送 ➤
                  </button>
                )}
              </div>
              <div className="mx-auto mt-1.5 max-w-3xl text-center text-[11px] text-slate-300">
                内容由 AI 生成，仅供参考 · 支持文字与图片输入（多模态）
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-slate-400">
            请在左侧选择或新建一个会话
          </div>
        )}
      </div>

      {/* 会话设置 */}
      {active && showSettings && (
        <div className="w-64 shrink-0 space-y-5 border-l border-slate-200 bg-white p-4">
          <div>
            <div className="mb-2 text-xs font-medium text-slate-400">模型</div>
            <div className="space-y-1.5">
              {MODELS.map((mo) => {
                const locked = !PLAN_ALLOWED_MODELS[userPlan].includes(mo.id);
                return (
                  <button
                    key={mo.id}
                    onClick={() =>
                      locked ? router.push("/app/pricing") : setConversationModel(active.id, mo.id)
                    }
                    title={locked ? "当前套餐不可用，点击升级解锁" : undefined}
                    className={`w-full rounded-xl border p-2.5 text-left transition ${
                      locked
                        ? "border-slate-200 bg-slate-50 opacity-70 hover:border-brand-200"
                        : active.model === mo.id
                          ? "border-brand-400 bg-brand-50"
                          : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-700">{mo.name}</span>
                      {locked && <span className="text-xs text-amber-500">🔒 升级解锁</span>}
                    </div>
                    <div className="text-[11px] text-slate-400">{mo.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs font-medium text-slate-400">助手 / 人设</div>
            <select
              value={active.assistantId}
              onChange={(e) => setConversationAssistant(active.id, e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-sm outline-none focus:border-brand-400"
            >
              {assistants.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.avatar} {a.name}
                </option>
              ))}
            </select>
            <p className="mt-2 rounded-lg bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-400">
              {assistants.find((a) => a.id === active.assistantId)?.systemPrompt}
            </p>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between text-xs font-medium text-slate-400">
              <span>温度（创造性）</span>
              <span className="text-slate-500">{active.temperature.toFixed(1)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={active.temperature}
              onChange={(e) => setConversationTemperature(active.id, Number(e.target.value))}
              className="w-full accent-brand-600"
            />
            <div className="mt-1 flex justify-between text-[10px] text-slate-300">
              <span>严谨</span>
              <span>发散</span>
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs font-medium text-slate-400">推理强度（高级）</div>
            <div className="grid grid-cols-3 gap-1.5">
              {REASONING_OPTIONS.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setConversationReasoning(active.id, r.id)}
                  className={`rounded-lg border py-1.5 text-xs transition ${
                    active.reasoningEffort === r.id
                      ? "border-brand-400 bg-brand-50 text-brand-700"
                      : "border-slate-200 text-slate-500 hover:border-slate-300"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ConversationItem({
  conv,
  active,
  onOpen,
  onDelete,
  onPin,
  onRename,
}: {
  conv: Conversation;
  active: boolean;
  onOpen: () => void;
  onDelete: () => void;
  onPin: () => void;
  onRename: (t: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(conv.title);
  return (
    <div
      onClick={onOpen}
      className={`group flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm ${
        active ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100"
      }`}
    >
      <span className="text-slate-400">{conv.pinned ? "📌" : "💬"}</span>
      {editing ? (
        <input
          autoFocus
          value={val}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setVal(e.target.value)}
          onBlur={() => {
            onRename(val || conv.title);
            setEditing(false);
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
          className="flex-1 rounded border border-brand-300 px-1 text-sm outline-none"
        />
      ) : (
        <span className="flex-1 truncate">{conv.title}</span>
      )}
      <div className="hidden shrink-0 gap-0.5 group-hover:flex" onClick={(e) => e.stopPropagation()}>
        <button title="置顶" onClick={onPin} className="rounded px-1 hover:bg-slate-200">
          📌
        </button>
        <button title="重命名" onClick={() => setEditing(true)} className="rounded px-1 hover:bg-slate-200">
          ✏️
        </button>
        <button title="删除" onClick={onDelete} className="rounded px-1 hover:bg-slate-200">
          🗑️
        </button>
      </div>
    </div>
  );
}

function IconBtn({
  children,
  title,
  onClick,
  active,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`rounded-md px-1.5 py-0.5 text-sm transition hover:bg-slate-100 ${
        active ? "bg-brand-50" : ""
      }`}
    >
      {children}
    </button>
  );
}

function EmptyChat() {
  const suggestions = [
    "帮我写一段本周周报",
    "解释一下什么是多模态 AI",
    "用 TypeScript 写一个求和函数",
  ];
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <div className="text-5xl">✨</div>
      <div className="mt-3 text-lg font-medium text-slate-700">开始和蛙宝对话吧</div>
      <div className="mt-1 text-sm text-slate-400">试试下面的问题：</div>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {suggestions.map((s) => (
          <span
            key={s}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-500"
          >
            {s}
          </span>
        ))}
      </div>
      <div className="mt-4 rounded-xl bg-white/60 px-4 py-2 text-xs text-slate-400 ring-1 ring-slate-200">
        🖼️ 也可以点击输入框左侧图标上传图片，让蛙宝看图回答
      </div>
    </div>
  );
}
function groupConversations(list: Conversation[], q: string) {
  const filtered = list.filter((c) => c.title.toLowerCase().includes(q.toLowerCase()));
  const sorted = [...filtered].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt,
  );
  const now = Date.now();
  const groups: { label: string; items: Conversation[] }[] = [
    { label: "置顶", items: [] },
    { label: "今天", items: [] },
    { label: "更早", items: [] },
  ];
  for (const c of sorted) {
    if (c.pinned) groups[0].items.push(c);
    else if (now - c.updatedAt < 86_400_000) groups[1].items.push(c);
    else groups[2].items.push(c);
  }
  return groups.filter((g) => g.items.length > 0);
}
