"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useAssistants } from "@/lib/hooks";
import { MODELS } from "@/lib/mockData";
import type { Assistant, ModelId } from "@/lib/types";

let seq = 100;
const genId = (p: string) => `${p}_${++seq}`;

const EMOJIS = ["🤖", "💻", "✍️", "🎯", "📊", "🧠", "🎨", "🗂️"];

export function AssistantsView() {
  const { assistants, mutate } = useAssistants();
  const [editing, setEditing] = useState<Assistant | null>(null);

  const startNew = () =>
    setEditing({
      id: genId("as"),
      name: "",
      avatar: "🤖",
      systemPrompt: "",
      defaultModel: "gpt-5.6-terra",
    });

  const upsertAssistant = async (a: Assistant) => {
    const exists = assistants.some((x) => x.id === a.id);
    if (exists) {
      const updated = await api.assistants.update(a.id, {
        name: a.name,
        system_prompt: a.systemPrompt,
        default_model: a.defaultModel,
        avatar: a.avatar,
      });
      mutate((list) => (list ?? []).map((x) => (x.id === a.id ? updated : x)), { revalidate: false });
    } else {
      const created = await api.assistants.create({
        name: a.name,
        system_prompt: a.systemPrompt,
        default_model: a.defaultModel,
        avatar: a.avatar,
      });
      mutate((list) => [...(list ?? []), created], { revalidate: false });
    }
  };

  const deleteAssistant = async (id: string) => {
    mutate((list) => (list ?? []).filter((a) => a.id !== id), { revalidate: false });
    await api.assistants.remove(id).catch(() => undefined);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-6 py-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">我的助手</h1>
            <p className="mt-1 text-sm text-slate-400">为不同场景定制专属人设（system prompt）</p>
          </div>
          <button
            onClick={startNew}
            className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            ＋ 新建助手
          </button>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {assistants.map((a) => (
            <div key={a.id} className="group rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-50 text-xl">
                    {a.avatar}
                  </div>
                  <div>
                    <div className="font-medium text-slate-800">{a.name}</div>
                    <div className="text-[11px] text-slate-400">
                      {MODELS.find((m) => m.id === a.defaultModel)?.name}
                    </div>
                  </div>
                </div>
                <div className="hidden gap-1 group-hover:flex">
                  <button onClick={() => setEditing(a)} className="rounded-lg px-2 py-1 text-sm hover:bg-slate-100">
                    ✏️
                  </button>
                  <button
                    onClick={() => deleteAssistant(a.id)}
                    className="rounded-lg px-2 py-1 text-sm hover:bg-slate-100"
                  >
                    🗑️
                  </button>
                </div>
              </div>
              <p className="mt-3 line-clamp-2 text-sm text-slate-500">{a.systemPrompt || "（未设置人设）"}</p>
            </div>
          ))}
        </div>
      </div>

      {editing && (
        <AssistantEditor
          value={editing}
          onCancel={() => setEditing(null)}
          onSave={(a) => {
            void upsertAssistant(a);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function AssistantEditor({
  value,
  onSave,
  onCancel,
}: {
  value: Assistant;
  onSave: (a: Assistant) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Assistant>(value);
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 p-4" onClick={onCancel}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-slate-800">{value.name ? "编辑助手" : "新建助手"}</h2>

        <div className="mt-4 space-y-4">
          <div>
            <span className="mb-1 block text-sm font-medium text-slate-600">头像</span>
            <div className="flex flex-wrap gap-2">
              {EMOJIS.map((e) => (
                <button
                  key={e}
                  onClick={() => setDraft({ ...draft, avatar: e })}
                  className={`flex h-10 w-10 items-center justify-center rounded-xl text-xl transition ${
                    draft.avatar === e ? "bg-brand-100 ring-2 ring-brand-400" : "bg-slate-50 hover:bg-slate-100"
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-600">名称</span>
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="如：产品经理助手"
              className="w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-brand-400"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-600">人设 System Prompt</span>
            <textarea
              rows={4}
              value={draft.systemPrompt}
              onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })}
              placeholder="描述这个助手的角色、语气与专长…"
              className="w-full resize-none rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-brand-400"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-600">默认模型</span>
            <select
              value={draft.defaultModel}
              onChange={(e) => setDraft({ ...draft, defaultModel: e.target.value as ModelId })}
              className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-sm outline-none focus:border-brand-400"
            >
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {m.desc}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-xl px-4 py-2 text-sm text-slate-500 hover:bg-slate-100">
            取消
          </button>
          <button
            onClick={() => onSave(draft)}
            disabled={!draft.name.trim()}
            className="rounded-xl bg-brand-600 px-5 py-2 text-sm font-medium text-white enabled:hover:bg-brand-700 disabled:opacity-40"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
