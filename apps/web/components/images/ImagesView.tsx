"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useImageOptions, useMediaAssets } from "@/lib/hooks";
import { ImageCard } from "@/components/images/ImageCard";
import { ImageLightbox } from "@/components/images/ImageLightbox";
import type {
  ImageModelId,
  ImageQuotaSnapshot,
  ImageSizeId,
  ImageStyleId,
  MediaAsset,
} from "@/lib/types";

/** 灵感提示词：点击即填充，降低首次使用门槛 */
const INSPIRATIONS = [
  "一只戴着宇航头盔的青蛙漂浮在星云中，霓虹紫蓝配色",
  "极简办公桌俯拍，笔记本与咖啡，晨光斜射，柔和阴影",
  "国潮风格的山水楼阁，云雾缭绕，金色描边",
  "科技感数据看板插画，紫蓝渐变，几何图形构成",
];

export function ImagesView() {
  const router = useRouter();
  const { options, mutate: mutateOptions } = useImageOptions();
  const { assets, mutate: mutateAssets } = useMediaAssets();

  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<ImageModelId>("gpt-image-2-mini");
  const [size, setSize] = useState<ImageSizeId>("1024x1024");
  const [style, setStyle] = useState<ImageStyleId>("auto");
  const [count, setCount] = useState(1);

  const [generating, setGenerating] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [results, setResults] = useState<MediaAsset[]>([]);
  const [error, setError] = useState<{ message: string; upgrade?: boolean } | null>(null);
  const [quota, setQuota] = useState<ImageQuotaSnapshot | null>(null);
  const [preview, setPreview] = useState<MediaAsset | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 参数默认值以后端目录为准（套餐不同默认可用模型不同）
  useEffect(() => {
    if (!options) return;
    setModel(options.defaults.model);
    setSize(options.defaults.size);
    setStyle(options.defaults.style);
    setQuota({
      quota: options.limits.monthlyImages,
      used: options.limits.usedImages,
      remaining: options.limits.remainingImages,
    });
  }, [options]);

  const maxBatch = options?.limits.maxBatch ?? 1;
  const canVariation = options?.limits.vision ?? false;
  const styles = options?.styles ?? [];
  const models = options?.models ?? [];
  const sizes = options?.sizes ?? [];

  const currentSize = useMemo(
    () => sizes.find((s) => s.id === size) ?? sizes[0],
    [sizes, size],
  );

  const canSubmit = prompt.trim().length >= 2 && !generating;

  const generate = async () => {
    if (!canSubmit) return;
    setError(null);
    setResults([]);
    setGenerating(true);
    setPendingCount(Math.min(count, maxBatch));
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      await api.images.generate(
        { prompt: prompt.trim(), model, size, style, n: Math.min(count, maxBatch) },
        {
          signal: ac.signal,
          onStart: (info) => setPendingCount(info.count),
          onItem: (asset) => {
            // 逐张上屏：已完成的替换掉一个骨架位
            setResults((prev) => [...prev, asset]);
            setPendingCount((n) => Math.max(0, n - 1));
          },
          onDone: ({ quota: q }) => {
            if (q) setQuota(q);
            setPendingCount(0);
            // 同步画廊与配额
            mutateAssets();
            mutateOptions();
          },
          onError: (err: ApiError) => {
            setPendingCount(0);
            setError({
              message: err.message,
              upgrade: err.code === "forbidden" || err.code === "rate_limited",
            });
          },
        },
      );
    } finally {
      setGenerating(false);
      abortRef.current = null;
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    setPendingCount(0);
  };

  const removeAsset = async (id: string) => {
    setResults((prev) => prev.filter((a) => a.id !== id));
    mutateAssets((list) => (list ?? []).filter((a) => a.id !== id), { revalidate: false });
    await api.images.remove(id).catch(() => undefined);
    mutateOptions();
  };

  const makeVariation = async (asset: MediaAsset) => {
    if (generating) return;
    setError(null);
    setGenerating(true);
    setPendingCount(1);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      await api.images.variation(
        asset.id,
        {},
        {
          signal: ac.signal,
          onItem: (created) => {
            setResults((prev) => [created, ...prev]);
            setPendingCount(0);
          },
          onDone: ({ quota: q }) => {
            if (q) setQuota(q);
            mutateAssets();
            mutateOptions();
          },
          onError: (err) => {
            setPendingCount(0);
            setError({
              message: err.message,
              upgrade: err.code === "forbidden" || err.code === "rate_limited",
            });
          },
        },
      );
    } finally {
      setGenerating(false);
      abortRef.current = null;
    }
  };

  const recent = assets.slice(0, 8);

  return (
    <div className="h-full overflow-y-auto bg-slate-50 lg:overflow-hidden">
      {/* 移动端上下堆叠、桌面端左右分栏 */}
      <div className="flex min-h-full flex-col lg:h-full lg:flex-row">
        {/* ── 左侧参数面板 ── */}
        <aside className="w-full shrink-0 border-b border-slate-200 bg-white lg:w-[340px] lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <div className="p-5">
            <div className="flex items-center gap-2">
              <span className="text-xl">🎨</span>
              <h1 className="text-lg font-bold text-slate-800">AI 绘图</h1>
              {options?.mock && (
                <span
                  className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600"
                  title="后端未配置 OPENAI_API_KEY，当前返回占位图用于演示全链路"
                >
                  mock
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-400">
              用文字描述画面，一键生成配图 / 海报 / 插画
            </p>

            {/* 描述 */}
            <label className="mt-5 block">
              <span className="mb-1.5 flex items-center justify-between text-sm font-medium text-slate-600">
                <span>画面描述</span>
                <span className="text-[11px] font-normal text-slate-400">
                  {prompt.length}/2000
                </span>
              </span>
              <textarea
                rows={5}
                maxLength={2000}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    generate();
                  }
                }}
                placeholder="例如：一只戴着宇航头盔的青蛙漂浮在星云中，霓虹紫蓝配色，电影级光影"
                className="w-full resize-none rounded-xl border border-slate-200 p-3 text-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
              />
            </label>

            {/* 灵感 */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {INSPIRATIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setPrompt(s)}
                  title={s}
                  className="max-w-full truncate rounded-full border border-slate-200 px-2.5 py-1 text-[11px] text-slate-500 transition hover:border-brand-300 hover:text-brand-600"
                >
                  {s.slice(0, 14)}…
                </button>
              ))}
            </div>

            {/* 风格 */}
            <div className="mt-5">
              <div className="mb-2 text-sm font-medium text-slate-600">画面风格</div>
              <div className="grid grid-cols-4 gap-2">
                {styles.map((s) => {
                  const active = style === s.id;
                  return (
                    <button
                      key={s.id}
                      onClick={() => (s.allowed ? setStyle(s.id) : router.push("/app/pricing"))}
                      title={s.allowed ? s.promptHint || s.label : "当前套餐不可用，点击升级解锁"}
                      className={`group relative overflow-hidden rounded-xl border p-1.5 text-center transition ${
                        active
                          ? "border-brand-400 ring-2 ring-brand-100"
                          : "border-slate-200 hover:border-slate-300"
                      } ${s.allowed ? "" : "opacity-60"}`}
                    >
                      <span
                        className={`block h-8 w-full rounded-lg bg-gradient-to-br ${s.swatch}`}
                      />
                      <span className="mt-1 block truncate text-[10px] text-slate-600">
                        {s.label}
                      </span>
                      {!s.allowed && (
                        <span className="absolute right-1 top-1 text-[10px]">🔒</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 尺寸 */}
            <div className="mt-5">
              <div className="mb-2 text-sm font-medium text-slate-600">画面比例</div>
              <div className="grid grid-cols-3 gap-2">
                {sizes.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSize(s.id)}
                    className={`rounded-xl border py-2 text-center transition ${
                      size === s.id
                        ? "border-brand-400 bg-brand-50 text-brand-700"
                        : "border-slate-200 text-slate-500 hover:border-slate-300"
                    }`}
                  >
                    <div className="text-xs font-medium">{s.label}</div>
                    <div className="text-[10px] opacity-70">{s.ratio}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* 模型 */}
            <div className="mt-5">
              <div className="mb-2 text-sm font-medium text-slate-600">生图模型</div>
              <div className="space-y-1.5">
                {models.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => (m.allowed ? setModel(m.id) : router.push("/app/pricing"))}
                    title={m.allowed ? m.desc : "当前套餐不可用，点击升级解锁"}
                    className={`w-full rounded-xl border p-2.5 text-left transition ${
                      model === m.id
                        ? "border-brand-400 bg-brand-50"
                        : "border-slate-200 hover:border-slate-300"
                    } ${m.allowed ? "" : "opacity-70"}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-700">{m.name}</span>
                      {m.allowed ? (
                        <span className="text-[11px] text-slate-400">
                          ¥{m.pricePerImage}/张
                        </span>
                      ) : (
                        <span className="text-xs text-amber-500">🔒 升级解锁</span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400">{m.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* 张数 */}
            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between text-sm font-medium text-slate-600">
                <span>生成张数</span>
                {maxBatch < 4 && (
                  <button
                    onClick={() => router.push("/app/pricing")}
                    className="text-[11px] font-normal text-brand-600 hover:underline"
                  >
                    升级可批量出图 →
                  </button>
                )}
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[1, 2, 3, 4].map((n) => {
                  const locked = n > maxBatch;
                  return (
                    <button
                      key={n}
                      onClick={() => (locked ? router.push("/app/pricing") : setCount(n))}
                      className={`rounded-xl border py-2 text-sm transition ${
                        count === n && !locked
                          ? "border-brand-400 bg-brand-50 text-brand-700"
                          : "border-slate-200 text-slate-500 hover:border-slate-300"
                      } ${locked ? "opacity-50" : ""}`}
                    >
                      {n}
                      {locked && <span className="ml-0.5 text-[10px]">🔒</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 生成按钮 */}
            <div className="mt-6 flex gap-2">
              {generating ? (
                <button
                  onClick={stop}
                  className="flex-1 rounded-xl bg-slate-200 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-300"
                >
                  ⏹ 停止生成
                </button>
              ) : (
                <button
                  onClick={generate}
                  disabled={!canSubmit}
                  className="flex-1 rounded-xl bg-brand-600 py-2.5 text-sm font-medium text-white shadow-lg shadow-brand-600/25 transition enabled:hover:bg-brand-700 disabled:opacity-40"
                >
                  ✨ 生成图片
                </button>
              )}
              <button
                onClick={() => {
                  setPrompt("");
                  setResults([]);
                  setError(null);
                }}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-500 transition hover:bg-slate-50"
              >
                重置
              </button>
            </div>

            {/* 配额 */}
            {quota && (
              <div className="mt-4 rounded-xl bg-slate-50 p-3">
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span>本月绘图额度</span>
                  <span>
                    {quota.remaining === null
                      ? "不限量"
                      : `${quota.used} / ${quota.quota} 张`}
                  </span>
                </div>
                {quota.remaining !== null && quota.quota > 0 && (
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-brand-500 transition-all"
                      style={{
                        width: `${Math.min(100, (quota.used / quota.quota) * 100)}%`,
                      }}
                    />
                  </div>
                )}
                {quota.remaining !== null && quota.remaining <= 3 && (
                  <button
                    onClick={() => router.push("/app/pricing")}
                    className="mt-2 text-[11px] font-medium text-brand-600 hover:underline"
                  >
                    额度即将用尽，升级套餐 →
                  </button>
                )}
              </div>
            )}

            <p className="mt-3 text-center text-[11px] text-slate-300">
              Ctrl / ⌘ + Enter 快速生成
            </p>
          </div>
        </aside>

        {/* ── 右侧结果区 ── */}
        <section className="flex min-w-0 flex-1 flex-col lg:overflow-hidden">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white/80 px-5 py-3 backdrop-blur">
            <span className="text-sm font-medium text-slate-500">
              {generating
                ? "正在生成…"
                : results.length > 0
                  ? `本次生成 ${results.length} 张`
                  : "生成结果"}
            </span>
            <div className="flex flex-wrap gap-2">
            <button
              onClick={() => router.push("/app/images/caption")}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 transition hover:border-brand-300 hover:text-brand-600"
              title="上传或选择图片，生成小红书笔记 / 营销文案"
            >
              📝 图生文案
            </button>
            <button
              onClick={() => router.push("/app/images/gallery")}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 transition hover:border-brand-300 hover:text-brand-600"
            >
              🖼️ 我的作品 {assets.length > 0 ? `(${assets.length})` : ""}
            </button>
            </div>
          </header>

          <div className="flex-1 p-5 lg:overflow-y-auto">
            {error && (
              <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
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

            {results.length === 0 && pendingCount === 0 && !error ? (
              <EmptyState
                recent={recent}
                onPick={(a) => setPreview(a)}
                onGoGallery={() => router.push("/app/images/gallery")}
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {results.map((a) => (
                  <ImageCard
                    key={a.id}
                    asset={a}
                    onPreview={() => setPreview(a)}
                    onVariation={canVariation ? () => makeVariation(a) : undefined}
                    onDelete={() => removeAsset(a.id)}
                  />
                ))}
                {/* 骨架位：与所选比例同宽高，避免出图时布局跳动 */}
                {Array.from({ length: pendingCount }).map((_, i) => (
                  <SkeletonCard
                    key={`sk_${i}`}
                    ratio={
                      currentSize ? currentSize.width / currentSize.height : 1
                    }
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {preview && (
        <ImageLightbox
          asset={preview}
          onClose={() => setPreview(null)}
          onVariation={
            canVariation
              ? () => {
                  setPreview(null);
                  makeVariation(preview);
                }
              : undefined
          }
          onDelete={() => {
            setPreview(null);
            removeAsset(preview.id);
          }}
        />
      )}
    </div>
  );
}

function SkeletonCard({ ratio }: { ratio: number }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div
        className="relative w-full animate-pulse bg-gradient-to-br from-slate-100 via-slate-200 to-slate-100"
        style={{ aspectRatio: String(ratio) }}
      >
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-400">
          <span className="text-2xl">✨</span>
          <span className="text-xs">绘制中…</span>
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  recent,
  onPick,
  onGoGallery,
}: {
  recent: MediaAsset[];
  onPick: (a: MediaAsset) => void;
  onGoGallery: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 flex-col items-center justify-center py-12 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-brand-400 to-indigo-600 text-4xl shadow-lg shadow-brand-500/25">
          🎨
        </div>
        <div className="mt-4 text-lg font-medium text-slate-700">描述你想要的画面</div>
        <p className="mt-1 max-w-sm text-sm text-slate-400">
          在左侧填写描述、选择风格与比例，点击「生成图片」即可获得 AI 创作的配图
        </p>
      </div>

      {recent.length > 0 && (
        <div className="mt-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-slate-500">最近作品</h2>
            <button
              onClick={onGoGallery}
              className="text-xs text-brand-600 hover:underline"
            >
              查看全部 →
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {recent.map((a) => (
              <button
                key={a.id}
                onClick={() => onPick(a)}
                title={a.prompt}
                className="group overflow-hidden rounded-xl border border-slate-200 bg-white transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={a.url}
                  alt={a.prompt}
                  loading="lazy"
                  className="aspect-square w-full object-cover"
                />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
