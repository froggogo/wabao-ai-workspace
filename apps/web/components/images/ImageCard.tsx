"use client";

import { useState } from "react";
import type { MediaAsset } from "@/lib/types";
import { downloadImage } from "@/lib/download";

/**
 * 作品卡片。图片按真实宽高比占位（aspectRatio），
 * 加载完成前显示渐变骨架，避免瀑布流抖动。
 */
export function ImageCard({
  asset,
  onPreview,
  onVariation,
  onCaption,
  onDelete,
  compact,
}: {
  asset: MediaAsset;
  onPreview: () => void;
  onVariation?: () => void;
  onCaption?: () => void;
  onDelete?: () => void;
  compact?: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  const ratio = asset.width && asset.height ? asset.width / asset.height : 1;

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md">
      <button
        onClick={onPreview}
        className="block w-full"
        style={{ aspectRatio: String(ratio) }}
        title={asset.prompt || "查看大图"}
      >
        {!loaded && (
          <span className="absolute inset-0 animate-pulse bg-gradient-to-br from-slate-100 via-slate-200 to-slate-100" />
        )}
        {/* 使用原生 img：图片来自后端 /uploads 动态路径，无需 Next 图片优化 */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset.url}
          alt={asset.prompt || "AI 生成图片"}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          className={`h-full w-full object-cover transition-opacity duration-300 ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
        />
      </button>

      {/* 悬浮操作条 */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-slate-900/70 to-transparent p-3 opacity-0 transition group-hover:opacity-100">
        {!compact && (
          <p className="pointer-events-none line-clamp-2 flex-1 text-left text-[11px] leading-snug text-white/90">
            {asset.prompt}
          </p>
        )}
        <div className="pointer-events-auto flex shrink-0 gap-1">
          <IconBtn
            title="下载"
            onClick={() => downloadImage(asset.url, asset.prompt || "wabao-image")}
          >
            ⬇
          </IconBtn>
          {onVariation && (
            <IconBtn title="生成变体" onClick={onVariation}>
              🔄
            </IconBtn>
          )}
          {onCaption && (
            <IconBtn title="用这张图写文案" onClick={onCaption}>
              📝
            </IconBtn>
          )}
          {onDelete && (
            <IconBtn title="删除" onClick={onDelete}>
              🗑
            </IconBtn>
          )}
        </div>
      </div>

      {/* 变体标记 */}
      {asset.source === "variation" && (
        <span className="absolute left-2 top-2 rounded-full bg-slate-900/60 px-2 py-0.5 text-[10px] text-white backdrop-blur">
          变体
        </span>
      )}
    </div>
  );
}

function IconBtn({
  children,
  title,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/90 text-xs text-slate-700 shadow transition hover:bg-white"
    >
      {children}
    </button>
  );
}
