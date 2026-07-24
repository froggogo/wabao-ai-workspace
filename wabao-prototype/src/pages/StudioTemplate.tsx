import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useApp } from "../store/appStore";
import { Markdown } from "../components/Markdown";
import { downloadText, safeFilename } from "../lib/download";
import type { Template } from "../lib/types";

export function StudioTemplate() {
  const { templateId } = useParams();
  const navigate = useNavigate();
  const addCreation = useApp((s) => s.addCreation);

  const [tpl, setTpl] = useState<Template | null | undefined>(undefined);
  const [values, setValues] = useState<Record<string, string>>({});
  const [output, setOutput] = useState("");
  const [generating, setGenerating] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!templateId) return;
    api.templates
      .get(templateId)
      .then((t) => {
        setTpl(t);
        const init: Record<string, string> = {};
        t.fields.forEach((f) => {
          if (f.type === "select") init[f.key] = f.default ?? f.options[0];
        });
        setValues(init);
      })
      .catch(() => setTpl(null));
  }, [templateId]);

  if (tpl === undefined) {
    return <div className="flex h-full items-center justify-center text-slate-400">加载模板中…</div>;
  }

  if (!tpl) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400">
        模板不存在，
        <button className="ml-1 text-brand-600" onClick={() => navigate("/app/studio")}>
          返回模板库
        </button>
      </div>
    );
  }

  const missingRequired = tpl.fields.some(
    (f) => "required" in f && f.required && !values[f.key]?.trim()
  );

  const generate = async () => {
    if (generating || missingRequired) return;
    setOutput("");
    setGenerating(true);
    const ac = new AbortController();
    abortRef.current = ac;
    let acc = "";
    try {
      await api.creations.create(
        { template_id: tpl.id, inputs: values },
        {
          signal: ac.signal,
          onDelta: (t) => {
            acc += t;
            setOutput(acc);
          },
          onError: (err) => setOutput(`⚠️ ${err.message}`),
          onDone: () => {
            addCreation({
              id: `cr_${Date.now()}`,
              templateId: tpl.id,
              templateName: tpl.name,
              output: acc,
              createdAt: Date.now(),
            });
          },
        },
      );
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="h-full overflow-hidden">
      <div className="border-b border-slate-200 bg-white px-6 py-3">
        <button onClick={() => navigate("/app/studio")} className="text-sm text-slate-400 hover:text-slate-600">
          ← 模板库
        </button>
      </div>

      <div className="grid h-[calc(100%-49px)] grid-cols-1 md:grid-cols-2">
        {/* 表单 */}
        <div className="overflow-y-auto border-r border-slate-200 bg-white p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-2xl">
              {tpl.icon}
            </div>
            <div>
              <h1 className="font-semibold text-slate-800">{tpl.name}</h1>
              <p className="text-xs text-slate-400">{tpl.description}</p>
            </div>
          </div>

          <div className="mt-6 space-y-4">
            {tpl.fields.map((f) => (
              <label key={f.key} className="block">
                <span className="mb-1 flex items-center gap-1 text-sm font-medium text-slate-600">
                  {f.label}
                  {"required" in f && f.required && <span className="text-red-400">*</span>}
                </span>
                {f.type === "textarea" ? (
                  <textarea
                    rows={4}
                    value={values[f.key] ?? ""}
                    placeholder={"placeholder" in f ? f.placeholder : ""}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    className="w-full resize-none rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                  />
                ) : f.type === "select" ? (
                  <select
                    value={values[f.key] ?? f.default ?? f.options[0]}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-sm outline-none focus:border-brand-400"
                  >
                    {f.options.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={values[f.key] ?? ""}
                    placeholder={"placeholder" in f ? f.placeholder : ""}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                  />
                )}
              </label>
            ))}
          </div>

          <div className="mt-6 flex gap-2">
            <button
              onClick={generate}
              disabled={generating || missingRequired}
              className="flex-1 rounded-xl bg-brand-600 py-2.5 text-sm font-medium text-white transition enabled:hover:bg-brand-700 disabled:opacity-40"
            >
              {generating ? "生成中…" : "✨ 生成"}
            </button>
            <button
              onClick={() => setValues({})}
              className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-500 hover:bg-slate-50"
            >
              重置
            </button>
          </div>
        </div>

        {/* 结果 */}
        <div className="flex flex-col overflow-hidden bg-slate-50">
          <div className="flex items-center justify-between border-b border-slate-200 px-6 py-3">
            <span className="text-sm font-medium text-slate-500">生成结果</span>
            {output && !generating && (
              <div className="flex items-center gap-2 text-sm">
                <button
                  onClick={() => navigator.clipboard?.writeText(output)}
                  className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-200"
                >
                  📋 复制
                </button>
                <ExportMenu filename={tpl.name} content={output} />
                <button onClick={generate} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-200">
                  🔄 重新生成
                </button>
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-6">
            {output ? (
              tpl.structured ? (
                <pre className="overflow-x-auto rounded-xl bg-slate-900 p-4 text-[13px] text-emerald-200">
                  {output}
                  {generating && <span className="cursor-blink" />}
                </pre>
              ) : (
                <div className={generating ? "cursor-blink" : ""}>
                  <Markdown text={output} />
                </div>
              )
            ) : (
              <div className="flex h-full items-center justify-center text-center text-sm text-slate-400">
                {generating ? "正在生成…" : "填写左侧表单后点击「生成」"}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ExportMenu({ filename, content }: { filename: string; content: string }) {
  const [open, setOpen] = useState(false);
  const base = safeFilename(filename);
  const item = "block w-full rounded-lg px-3 py-1.5 text-left text-sm text-slate-600 hover:bg-slate-100";
  return (
    <div className="relative" onMouseLeave={() => setOpen(false)}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-200"
      >
        ⬇ 导出 ▾
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-40 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
          <button
            className={item}
            onClick={() => {
              downloadText(`${base}.md`, content, "text/markdown");
              setOpen(false);
            }}
          >
            Markdown (.md)
          </button>
          <button
            className={item}
            onClick={() => {
              downloadText(`${base}.txt`, content, "text/plain");
              setOpen(false);
            }}
          >
            纯文本 (.txt)
          </button>
          <button
            className={item}
            onClick={() => {
              navigator.clipboard?.writeText(content);
              setOpen(false);
            }}
          >
            复制到剪贴板
          </button>
        </div>
      )}
    </div>
  );
}
