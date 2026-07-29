"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useCreations } from "@/lib/hooks";
import { Markdown } from "@/components/Markdown";
import { ExportMenu } from "@/components/ExportMenu";

export function StudioHistoryView() {
  const router = useRouter();
  const { creations, mutate: mutateCreations } = useCreations();
  const [expanded, setExpanded] = useState<string | null>(null);

  const deleteCreation = async (id: string) => {
    mutateCreations((list) => (list ?? []).filter((c) => c.id !== id), { revalidate: false });
    await api.creations.remove(id).catch(() => undefined);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-6 py-8">
        <div className="flex items-center justify-between">
          <div>
            <button
              onClick={() => router.push("/app/studio")}
              className="text-sm text-slate-400 hover:text-slate-600"
            >
              ← 模板库
            </button>
            <h1 className="mt-1 text-2xl font-bold text-slate-800">创作历史</h1>
          </div>
          <div className="text-sm text-slate-400">共 {creations.length} 条</div>
        </div>

        {creations.length === 0 ? (
          <div className="mt-20 text-center text-slate-400">
            还没有创作记录，去
            <button className="mx-1 text-brand-600 hover:underline" onClick={() => router.push("/app/studio")}>
              创作工作室
            </button>
            生成第一篇内容吧 ✨
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            {creations.map((c) => {
              const open = expanded === c.id;
              return (
                <div key={c.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-800">{c.templateName}</div>
                      <div className="mt-0.5 text-xs text-slate-400">
                        {new Date(c.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 text-sm">
                      <button
                        onClick={() => setExpanded(open ? null : c.id)}
                        className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100"
                      >
                        {open ? "收起" : "查看"}
                      </button>
                      <button
                        onClick={() => navigator.clipboard?.writeText(c.output)}
                        className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100"
                      >
                        📋
                      </button>
                      <ExportMenu filename={c.templateName} content={c.output} />
                      <button
                        onClick={() => {
                          if (confirm("确定删除这条创作记录？")) void deleteCreation(c.id);
                        }}
                        className="rounded-lg px-2 py-1 text-slate-400 hover:bg-red-50 hover:text-red-500"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>

                  {open ? (
                    <div className="mt-3 rounded-xl bg-slate-50 p-4">
                      <Markdown text={c.output} />
                    </div>
                  ) : (
                    <div className="mt-2 line-clamp-2 whitespace-pre-wrap text-sm text-slate-400">
                      {c.output}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
