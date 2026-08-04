"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useImageOptions, useMediaAssets } from "@/lib/hooks";
import { IMAGE_STYLES } from "@wabao/shared";
import { ImageCard } from "@/components/images/ImageCard";
import { ImageLightbox } from "@/components/images/ImageLightbox";
import { ImagesTabs } from "@/components/images/ImagesTabs";
import type { MediaAsset } from "@/lib/types";

type Filter = "all" | "generation" | "variation";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "generation", label: "原创生成" },
  { id: "variation", label: "变体" },
];

export function ImageGalleryView() {
  const router = useRouter();
  const { assets, isLoading, mutate } = useMediaAssets();
  const { options, mutate: mutateOptions } = useImageOptions();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [styleFilter, setStyleFilter] = useState<string>("all");
  const [preview, setPreview] = useState<MediaAsset | null>(null);
  const [error, setError] = useState<{ message: string; upgrade?: boolean } | null>(null);

  const canVariation = options?.limits.vision ?? false;

  const goCaption = (asset: MediaAsset) =>
    router.push(`/app/images/caption?image=${encodeURIComponent(asset.url)}`);

  // 画廊中出现过的风格，用于动态生成筛选项
  const usedStyles = useMemo(() => {
    const set = new Set(assets.map((a) => a.style).filter(Boolean));
    return IMAGE_STYLES.filter((s) => set.has(s.id));
  }, [assets]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets.filter((a) => {
      if (filter !== "all" && a.source !== filter) return false;
      if (styleFilter !== "all" && a.style !== styleFilter) return false;
      if (q && !a.prompt.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [assets, filter, styleFilter, query]);

  const removeAsset = async (id: string) => {
    mutate((prev) => (prev ?? []).filter((a) => a.id !== id), { revalidate: false });
    await api.images.remove(id).catch(() => undefined);
    mutateOptions();
  };

  const makeVariation = async (asset: MediaAsset) => {
    setError(null);
    await api.images.variation(
      asset.id,
      {},
      {
        onItem: (created) => {
          mutate((prev) => [created, ...(prev ?? [])], { revalidate: false });
        },
        onDone: () => {
          mutate();
          mutateOptions();
        },
        onError: (err) =>
          setError({
            message: err.message,
            upgrade: err.code === "forbidden" || err.code === "rate_limited",
          }),
      },
    );
  };

  return (
    <div className="flex h-full flex-col bg-slate-50">
      <ImagesTabs />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
          <p className="text-sm text-slate-400">
            共 {assets.length} 张 · 支持下载、生成变体与删除
          </p>

        {/* 筛选栏 */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`rounded-full px-4 py-1.5 text-sm transition ${
                filter === f.id
                  ? "bg-brand-600 text-white"
                  : "bg-white text-slate-500 ring-1 ring-slate-200 hover:ring-slate-300"
              }`}
            >
              {f.label}
            </button>
          ))}

          {usedStyles.length > 0 && (
            <select
              value={styleFilter}
              onChange={(e) => setStyleFilter(e.target.value)}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 outline-none focus:border-brand-400"
            >
              <option value="all">全部风格</option>
              {usedStyles.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          )}

          <div className="ml-auto flex min-w-[180px] flex-1 items-center gap-2 rounded-full bg-white px-3 py-1.5 ring-1 ring-slate-200 sm:max-w-xs sm:flex-none">
            <span className="text-slate-400">🔍</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索描述"
              className="w-full bg-transparent text-sm outline-none"
            />
          </div>
        </div>

        {/* 网格 */}
        {error && (
          <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
            <span>⚠️ {error.message}</span>
            {error.upgrade && (
              <button
                onClick={() => router.push("/app/pricing")}
                className="rounded-lg bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700"
              >
                升级套餐
              </button>
            )}
          </div>
        )}

        {isLoading ? (
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="aspect-square animate-pulse rounded-2xl bg-gradient-to-br from-slate-100 via-slate-200 to-slate-100"
              />
            ))}
          </div>
        ) : list.length === 0 ? (
          <EmptyGallery
            hasAssets={assets.length > 0}
            onCreate={() => router.push("/app/images")}
          />
        ) : (
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {list.map((a) => (
              <ImageCard
                key={a.id}
                asset={a}
                compact
                onPreview={() => setPreview(a)}
                onVariation={canVariation ? () => makeVariation(a) : undefined}
                onCaption={canVariation ? () => goCaption(a) : undefined}
                onDelete={() => removeAsset(a.id)}
              />
            ))}
          </div>
        )}
        </div>
      </div>

      {preview && (
        <ImageLightbox
          asset={preview}
          onClose={() => setPreview(null)}
          onVariation={
            canVariation
              ? () => {
                  makeVariation(preview);
                  setPreview(null);
                }
              : undefined
          }
          onCaption={canVariation ? () => goCaption(preview) : undefined}
          onDelete={() => {
            removeAsset(preview.id);
            setPreview(null);
          }}
        />
      )}
    </div>
  );
}

function EmptyGallery({
  hasAssets,
  onCreate,
}: {
  hasAssets: boolean;
  onCreate: () => void;
}) {
  return (
    <div className="mt-16 flex flex-col items-center justify-center text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-brand-400 to-indigo-600 text-4xl shadow-lg shadow-brand-500/25">
        🖼️
      </div>
      <div className="mt-4 text-lg font-medium text-slate-700">
        {hasAssets ? "没有匹配的作品" : "还没有作品"}
      </div>
      <p className="mt-1 max-w-sm text-sm text-slate-400">
        {hasAssets
          ? "试试调整筛选条件或搜索关键词"
          : "去 AI 绘图页面描述你想要的画面，生成的作品会自动收藏在这里"}
      </p>
      {!hasAssets && (
        <button
          onClick={onCreate}
          className="mt-5 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-700"
        >
          ✨ 开始创作
        </button>
      )}
    </div>
  );
}
