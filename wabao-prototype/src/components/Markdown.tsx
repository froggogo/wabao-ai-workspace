import { Fragment, type ReactNode } from "react";

/** 极简 Markdown 渲染：支持标题、加粗、行内代码、代码块、无序列表。仅用于原型演示。 */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split("\n");
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 代码块
    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3);
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        code.push(lines[i]);
        i++;
      }
      i++;
      blocks.push(
        <pre
          key={key++}
          className="my-2 overflow-x-auto rounded-lg bg-slate-900 p-3 text-[13px] leading-relaxed text-slate-100"
        >
          {lang && <div className="mb-1 text-[11px] text-slate-400">{lang}</div>}
          <code>{code.join("\n")}</code>
        </pre>
      );
      continue;
    }

    // 无序列表
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={key++} className="my-1 list-disc space-y-0.5 pl-5">
          {items.map((it, idx) => (
            <li key={idx}>{inline(it)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // 标题
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const cls = level === 1 ? "text-lg font-bold" : level === 2 ? "text-base font-semibold" : "text-sm font-semibold";
      blocks.push(
        <div key={key++} className={`${cls} mt-2 mb-1 text-slate-800`}>
          {inline(h[2])}
        </div>
      );
      i++;
      continue;
    }

    // 引用
    if (line.startsWith(">")) {
      blocks.push(
        <blockquote key={key++} className="my-1 border-l-2 border-brand-300 pl-3 text-slate-500">
          {inline(line.replace(/^>\s?/, ""))}
        </blockquote>
      );
      i++;
      continue;
    }

    // 空行
    if (line.trim() === "") {
      blocks.push(<div key={key++} className="h-2" />);
      i++;
      continue;
    }

    blocks.push(
      <p key={key++} className="my-0.5 leading-relaxed">
        {inline(line)}
      </p>
    );
    i++;
  }

  return <div className="text-[15px] text-slate-700">{blocks}</div>;
}

/** 行内：**加粗** 和 `代码` */
function inline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, idx) => {
    if (p.startsWith("**") && p.endsWith("**")) {
      return (
        <strong key={idx} className="font-semibold text-slate-900">
          {p.slice(2, -2)}
        </strong>
      );
    }
    if (p.startsWith("`") && p.endsWith("`")) {
      return (
        <code key={idx} className="rounded bg-slate-100 px-1 py-0.5 text-[13px] text-brand-700">
          {p.slice(1, -1)}
        </code>
      );
    }
    return <Fragment key={idx}>{p}</Fragment>;
  });
}
