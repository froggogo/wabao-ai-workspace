import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useApp } from "../store/appStore";
import type { Template } from "../lib/types";

const CATEGORIES = ["全部", "办公", "营销", "写作", "代码"];

export function Studio() {
  const [cat, setCat] = useState("全部");
  const navigate = useNavigate();
  const creations = useApp((s) => s.creations);
  const loadCreations = useApp((s) => s.loadCreations);
  const [templates, setTemplates] = useState<Template[]>([]);

  useEffect(() => {
    void loadCreations();
    void api.templates.list().then(setTemplates).catch(() => undefined);
  }, [loadCreations]);

  const list = useMemo(
    () => (cat === "全部" ? templates : templates.filter((t) => t.category === cat)),
    [cat, templates]
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">创作工作室</h1>
            <p className="mt-1 text-sm text-slate-400">选择模板，填几个关键词即可一键生成内容</p>
          </div>
          <button
            onClick={() => navigate("/app/studio/history")}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 transition hover:border-brand-300 hover:text-brand-600"
          >
            📚 创作历史 {creations.length > 0 ? `(${creations.length})` : ""}
          </button>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`rounded-full px-4 py-1.5 text-sm transition ${
                cat === c ? "bg-brand-600 text-white" : "bg-white text-slate-500 ring-1 ring-slate-200 hover:ring-slate-300"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((t) => (
            <button
              key={t.id}
              onClick={() => navigate(`/app/studio/${t.id}`)}
              className="group flex flex-col items-start rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-2xl">
                {t.icon}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <span className="font-medium text-slate-800">{t.name}</span>
                {t.structured && (
                  <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-600">
                    结构化
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-slate-400">{t.description}</p>
              <span className="mt-3 text-sm font-medium text-brand-600 opacity-0 transition group-hover:opacity-100">
                使用模板 →
              </span>
            </button>
          ))}
        </div>

        {creations.length > 0 && (
          <div className="mt-10">
            <h2 className="mb-3 text-sm font-medium text-slate-500">最近创作</h2>
            <div className="space-y-2">
              {creations.slice(0, 5).map((c) => (
                <div key={c.id} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="text-sm font-medium text-slate-700">{c.templateName}</div>
                  <div className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-slate-400">
                    {c.output}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
