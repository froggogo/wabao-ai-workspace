import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useApp, genId } from "../store/appStore";
import { MODELS, PLAN_ALLOWED_MODELS } from "../lib/mockData";
import { api } from "../lib/api";
import { Markdown } from "../components/Markdown";
import type { Conversation, ReasoningEffort } from "../lib/types";

const REASONING_OPTIONS: { id: ReasoningEffort; label: string }[] = [
  { id: "low", label: "快速" },
  { id: "medium", label: "均衡" },
  { id: "high", label: "深度" },
];

export function Chat() {
  const {
    conversations,
    activeConversationId,
    assistants,
    openConversation,
    createConversation,
    deleteConversation,
    renameConversation,
    togglePin,
    setConversationModel,
    setConversationAssistant,
    setConversationTemperature,
    setConversationReasoning,
    userPlan,
    addMessage,
    updateMessage,
    replaceMessageId,
    rateMessage,
  } = useApp();

  const { conversationId } = useParams();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const currentAiRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showSettings, setShowSettings] = useState(true);

  const active = conversations.find((c) => c.id === activeConversationId) ?? null;

  const grouped = useMemo(() => groupConversations(conversations, query), [conversations, query]);

  // URL ↔ 当前会话 同步（支持深链 /app/chat/:conversationId）
  useEffect(() => {
    if (conversationId) {
      if (conversationId !== activeConversationId) void openConversation(conversationId);
    } else if (activeConversationId) {
      navigate(`/app/chat/${activeConversationId}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, activeConversationId]);

  const openConv = (id: string) => navigate(`/app/chat/${id}`);

  const newConversation = async () => {
    const id = await createConversation();
    navigate(`/app/chat/${id}`);
  };

  const removeConversation = async (id: string) => {
    await deleteConversation(id);
    navigate("/app/chat", { replace: true });
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [active?.messages.length, streaming]);

  const send = async () => {
    const text = input.trim();
    if (!text || streaming || !active) return;
    const convId = active.id;
    const model = active.model;
    setInput("");

    addMessage(convId, { id: genId("m"), role: "user", content: text, createdAt: Date.now() });

    // 助手占位气泡（onStart 时替换为真实 message_id）
    const tempAiId = genId("m");
    currentAiRef.current = tempAiId;
    addMessage(convId, {
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
    try {
      await api.messages.send(
        convId,
        { content: text, model },
        {
          signal: ac.signal,
          onStart: (id) => {
            replaceMessageId(convId, currentAiRef.current!, id);
            currentAiRef.current = id;
          },
          onDelta: (t) => {
            acc += t;
            updateMessage(convId, currentAiRef.current!, { content: acc });
          },
          onDone: (data) => {
            if (data.flagged) {
              updateMessage(convId, currentAiRef.current!, {
                content: data.filtered_content ?? "⚠️ 该回复包含不符合规范的内容，已被拦截。",
                flagged: true,
                streaming: false,
              });
            }
          },
          onError: (err) => {
            updateMessage(convId, currentAiRef.current!, {
              content: `⚠️ ${err.message}`,
              flagged: true,
              streaming: false,
            });
          },
        },
      );
    } finally {
      if (currentAiRef.current) updateMessage(convId, currentAiRef.current, { streaming: false });
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    if (currentAiRef.current) api.messages.stop(currentAiRef.current).catch(() => undefined);
  };

  const regenerate = async (aiId: string) => {
    if (!active || streaming) return;
    const convId = active.id;
    currentAiRef.current = aiId;
    updateMessage(convId, aiId, { content: "", streaming: true, flagged: false });
    setStreaming(true);
    const ac = new AbortController();
    abortRef.current = ac;
    let acc = "";
    try {
      await api.messages.regenerate(aiId, {
        signal: ac.signal,
        onStart: (id) => {
          replaceMessageId(convId, currentAiRef.current!, id);
          currentAiRef.current = id;
        },
        onDelta: (t) => {
          acc += t;
          updateMessage(convId, currentAiRef.current!, { content: acc });
        },
        onDone: (data) => {
          if (data.flagged) {
            updateMessage(convId, currentAiRef.current!, {
              content: data.filtered_content ?? "⚠️ 该回复包含不符合规范的内容，已被拦截。",
              flagged: true,
              streaming: false,
            });
          }
        },
        onError: (err) => {
          updateMessage(convId, currentAiRef.current!, {
            content: `⚠️ ${err.message}`,
            flagged: true,
            streaming: false,
          });
        },
      });
    } finally {
      if (currentAiRef.current) updateMessage(convId, currentAiRef.current, { streaming: false });
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
                  active={c.id === activeConversationId}
                  onOpen={() => openConv(c.id)}
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
                          {m.content ? <Markdown text={m.content} /> : <span className="text-slate-400">思考中…</span>}
                        </div>
                        {!m.streaming && !m.flagged && m.content && (
                          <div className="mt-1 flex items-center gap-1 text-slate-400">
                            <IconBtn title="复制" onClick={() => navigator.clipboard?.writeText(m.content)}>📋</IconBtn>
                            <IconBtn title="重新生成" onClick={() => regenerate(m.id)}>🔄</IconBtn>
                            <IconBtn
                              title="赞"
                              active={m.rating === "up"}
                              onClick={() => rateMessage(active.id, m.id, "up")}
                            >
                              👍
                            </IconBtn>
                            <IconBtn
                              title="踩"
                              active={m.rating === "down"}
                              onClick={() => rateMessage(active.id, m.id, "down")}
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
              <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100">
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
                  placeholder="输入消息，Enter 发送 / Shift+Enter 换行"
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
                    disabled={!input.trim()}
                    className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white transition enabled:hover:bg-brand-700 disabled:opacity-40"
                  >
                    发送 ➤
                  </button>
                )}
              </div>
              <div className="mx-auto mt-1.5 max-w-3xl text-center text-[11px] text-slate-300">
                内容由 AI 生成，仅供参考 · 已接入真实后端（SSE 流式）
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
                      locked ? navigate("/app/pricing") : setConversationModel(active.id, mo.id)
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
        <button title="置顶" onClick={onPin} className="rounded px-1 hover:bg-slate-200">📌</button>
        <button title="重命名" onClick={() => setEditing(true)} className="rounded px-1 hover:bg-slate-200">✏️</button>
        <button title="删除" onClick={onDelete} className="rounded px-1 hover:bg-slate-200">🗑️</button>
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
  const suggestions = ["帮我写一段本周周报", "解释一下什么是多模态 AI", "用 TypeScript 写一个求和函数"];
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <div className="text-5xl">✨</div>
      <div className="mt-3 text-lg font-medium text-slate-700">开始和蛙宝对话吧</div>
      <div className="mt-1 text-sm text-slate-400">试试下面的问题：</div>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {suggestions.map((s) => (
          <span key={s} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-500">
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}

function groupConversations(list: Conversation[], q: string) {
  const filtered = list.filter((c) => c.title.toLowerCase().includes(q.toLowerCase()));
  const sorted = [...filtered].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
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
