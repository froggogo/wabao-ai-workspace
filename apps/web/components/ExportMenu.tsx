"use client";

import { useState } from "react";
import { downloadText, safeFilename } from "@/lib/download";

export function ExportMenu({ filename, content }: { filename: string; content: string }) {
  const [open, setOpen] = useState(false);
  const base = safeFilename(filename);
  const item = "block w-full rounded-lg px-3 py-1.5 text-left text-sm text-slate-600 hover:bg-slate-100";
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-200"
      >
        ⬇ 导出 ▾
      </button>
      {open && (
        <>
          {/* 透明遮罩：点击空白处关闭菜单，避免鼠标移动误触关闭 */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
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
        </>
      )}
    </div>
  );
}
