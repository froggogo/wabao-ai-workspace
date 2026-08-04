"use client";

import { useEffect, useState } from "react";
import { IMAGE_STYLES } from "@wabao/shared";
import { downloadImage } from "@/lib/download";
import type { MediaAsset } from "@/lib/types";

/** 大图预览：展示图片与完整参数，支持下载 / 变体 / 删除 / 复制描述 */
export function ImageLightbox({
  asset,
  onClose,
  onVariation,
  onCaption,
  onDelete,
}: {
  asset: MediaAsset;
  onClose: () => void;
  onVariation?: () => void;
  onCaption?: () => void;
  onDelete?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  // Esc 关闭 + 打开时锁定背景滚动
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const styleLabel = IMAGE_STYLES.find((s) => s.id === asset.style)?.label ?? asset.style;

  const copyPrompt = () => {
    navigator.clipboard?.writeText(asset.prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl md:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 图片 */}
        <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-900 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={asset.url}
            alt={asset.prompt || "AI 生成图片"}
            className="max-h-[50vh] w-auto max-w-full rounded-lg object-contain md:max-h-[80vh]"
          />
        </div>

        {/* 信息面板 */}
        <aside className="w-full shrink-0 overflow-y-auto p-5 md:w-80">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-base font-semibold text-slate-800">图片详情</h3>
            <button
              onClick={onClose}
              className="rounded-lg px-2 py-0.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              title="关闭 (Esc)"
            >
              ✕
            </button>
          </div>

          <div className="mt-4">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">画面描述</span>
              <button
                onClick={copyPrompt}
                className="text-[11px] text-brand-600 hover:underline"
              >
                {copied ? "已复制 ✓" : "复制"}
              </button>
            </div>
            <p className="rounded-xl bg-slate-50 p-3 text-sm leading-relaxed text-slate-600">
              {asset.prompt || "（无描述）"}
            </p>
          </div>

          <dl className="mt-4 space-y-2 text-xs">
            <Row label="风格" value={styleLabel || "智能"} />
            <Row label="尺寸" value={`${asset.width} × ${asset.height}`} />
            <Row label="模型" value={asset.model || "—"} />
            <Row
              label="来源"
              value={
                asset.source === "variation"
                  ? "变体重绘"
                  : asset.source === "upload"
                    ? "用户上传"
                    : "AI 生成"
              }
            />
            <Row label="大小" value={formatBytes(asset.bytes)} />
            <Row label="创建时间" value={new Date(asset.createdAt).toLocaleString("zh-CN")} />
          </dl>

          <div className="mt-5 space-y-2">
            <button
              onClick={() => downloadImage(asset.url, asset.prompt || "wabao-image")}
              className="w-full rounded-xl bg-brand-600 py-2.5 text-sm font-medium text-white transition hover:bg-brand-700"
            >
              ⬇ 下载原图
            </button>
            {onVariation && (
              <button
                onClick={onVariation}
                className="w-full rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600 transition hover:bg-slate-50"
              >
                🔄 生成变体
              </button>
            )}
            {onCaption && (
              <button
                onClick={onCaption}
                className="w-full rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600 transition hover:bg-slate-50"
              >
                📝 用这张图写文案
              </button>
            )}
            {onDelete && (
              <button
                onClick={onDelete}
                className="w-full rounded-xl border border-red-200 py-2.5 text-sm text-red-500 transition hover:bg-red-50"
              >
                🗑 删除
              </button>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="shrink-0 text-slate-400">{label}</dt>
      <dd className="truncate text-right text-slate-600">{value}</dd>
    </div>
  );
}

function formatBytes(n: number): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
