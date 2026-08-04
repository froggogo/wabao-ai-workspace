"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { MediaAsset } from "@/lib/types";

const PAGE_SIZE = 40;

/**
 * 作品选择器：分页加载全部作品，避免左侧栏只能选到最近若干张。
 * 已选状态由调用方持有（以 url 为准），弹窗只负责浏览与勾选。
 */
export function ImagePickerDialog({
  selectedUrls,
  max,
  onToggle,
  onClose,
}: {
  selectedUrls: string[];
  max: number;
  onToggle: (asset: MediaAsset) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<MediaAsset[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState("");

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

  useEffect(() => {
    let cancelled = false;
    api.images
      .list({ page: 1, pageSize: PAGE_SIZE })
      .then((list) => {
        if (cancelled) return;
        setItems(list);
        setHasMore(list.length >= PAGE_SIZE);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const next = page + 1;
    try {
      const list = await api.images.list({ page: next, pageSize: PAGE_SIZE });
      setItems((prev) => [...prev, ...list]);
      setPage(next);
      setHasMore(list.length >= PAGE_SIZE);
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, page]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((a) => a.prompt.toLowerCase().includes(q));
  }, [items, query]);

  const full = selectedUrls.length >= max;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-h-[85vh] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-5 py-3">
          <div>
            <h2 className="font-semibold text-slate-800">从我的作品中选择</h2>
            <p className="text-[11px] text-slate-400">
              已选 {selectedUrls.length} / {max} 张{full ? " · 已达上限，取消一张后可继续选" : ""}
            </p>
          </div>

          <div className="ml-auto flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5">
            <span className="text-slate-400">🔍</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索描述"
              className="w-32 bg-transparent text-sm outline-none sm:w-48"
            />
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            title="关闭（Esc）"
          >
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
              {Array.from({ length: 10 }).map((_, i) => (
                <div
                  key={i}
                  className="aspect-square animate-pulse rounded-xl bg-gradient-to-br from-slate-100 via-slate-200 to-slate-100"
                />
              ))}
            </div>
          ) : list.length === 0 ? (
            <div className="py-16 text-center">
              <div className="text-3xl">🖼️</div>
              <p className="mt-3 text-sm text-slate-400">
                {items.length === 0
                  ? "还没有作品，先去绘图工作台生成几张"
                  : "没有匹配的作品，试试别的关键词"}
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
                {list.map((a) => {
                  const active = selectedUrls.includes(a.url);
                  const disabled = full && !active;
                  return (
                    <button
                      key={a.id}
                      onClick={() => !disabled && onToggle(a)}
                      disabled={disabled}
                      title={disabled ? `最多选择 ${max} 张` : a.prompt}
                      className={`group relative overflow-hidden rounded-xl ring-2 transition ${
                        active ? "ring-brand-500" : "ring-transparent hover:ring-slate-300"
                      } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={a.url}
                        alt={a.prompt}
                        loading="lazy"
                        className="aspect-square w-full object-cover"
                      />
                      {active && (
                        <span className="absolute inset-0 flex items-center justify-center bg-brand-600/40 text-lg text-white">
                          ✓
                        </span>
                      )}
                      <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-slate-900/80 to-transparent px-2 pb-1 pt-4 text-left text-[10px] text-white opacity-0 transition group-hover:opacity-100">
                        {a.prompt || "（无描述）"}
                      </span>
                    </button>
                  );
                })}
              </div>

              {hasMore && !query && (
                <div className="mt-4 text-center">
                  <button
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 transition hover:border-brand-300 hover:text-brand-600 disabled:opacity-50"
                  >
                    {loadingMore ? "加载中…" : "加载更多"}
                  </button>
                </div>
              )}
              {query && hasMore && (
                <p className="mt-4 text-center text-[11px] text-slate-400">
                  仅在已加载的 {items.length} 张中搜索，可先「加载更多」再搜
                </p>
              )}
            </>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-slate-200 px-5 py-3">
          <span className="text-[11px] text-slate-400">共 {items.length} 张已加载</span>
          <button
            onClick={onClose}
            className="rounded-xl bg-brand-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-brand-700"
          >
            完成
          </button>
        </footer>
      </div>
    </div>
  );
}
