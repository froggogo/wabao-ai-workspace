"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useCaptionOptions, useMediaAssets } from "@/lib/hooks";
import { Markdown } from "@/components/Markdown";
import { ImagesTabs } from "@/components/images/ImagesTabs";
import { ImagePickerDialog } from "@/components/images/ImagePickerDialog";
import type { MediaAsset } from "@/lib/types";

/** 参考图来源：从作品画廊挑选，或本地上传 */
interface PickedImage {
  url: string;
  /** 缩略展示用 */
  from: "gallery" | "upload";
}

export function ImageCaptionView({ initialImageUrl }: { initialImageUrl?: string }) {
  const router = useRouter();
  const { options } = useCaptionOptions();
  const { assets } = useMediaAssets();

  // 由作品页「写文案」带入的图片，直接作为首张参考图
  const [picked, setPicked] = useState<PickedImage[]>(
    initialImageUrl ? [{ url: initialImageUrl, from: "gallery" }] : [],
  );
  const [purpose, setPurpose] = useState("xiaohongshu");
  const [tone, setTone] = useState("friendly");
  const [brief, setBrief] = useState("");

  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState("");
  const [flagged, setFlagged] = useState(false);
  const [error, setError] = useState<{ message: string; upgrade?: boolean } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const maxImages = options?.limits.maxImages ?? 4;
  const canUse = options?.limits.vision ?? false;

  useEffect(() => {
    if (!options) return;
    setPurpose(options.defaults.purpose);
    setTone(options.defaults.tone);
  }, [options]);

  const toggleGalleryImage = (asset: MediaAsset) => {
    setPicked((prev) => {
      const exists = prev.find((p) => p.url === asset.url);
      if (exists) return prev.filter((p) => p.url !== asset.url);
      if (prev.length >= maxImages) return prev;
      return [...prev, { url: asset.url, from: "gallery" }];
    });
  };

  const onFilesSelected = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    setUploading(true);
    try {
      const room = maxImages - picked.length;
      for (const file of Array.from(files).slice(0, Math.max(0, room))) {
        const asset = await api.images.upload(file);
        setPicked((prev) => [...prev, { url: asset.url, from: "upload" }]);
      }
    } catch (err) {
      setError({ message: err instanceof Error ? err.message : "图片上传失败" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const generate = async () => {
    if (picked.length === 0 || running) return;
    if (!canUse) {
      router.push("/app/pricing");
      return;
    }
    setError(null);
    setOutput("");
    setFlagged(false);
    setRunning(true);
    const ac = new AbortController();
    abortRef.current = ac;
    let acc = "";

    try {
      await api.images.caption(
        {
          imageUrls: picked.map((p) => p.url),
          purpose,
          tone,
          brief: brief.trim() || undefined,
        },
        {
          signal: ac.signal,
          onDelta: (t) => {
            acc += t;
            setOutput(acc);
          },
          onDone: (data) => {
            if (data.flagged) {
              setFlagged(true);
              setOutput(
                (data.filtered_content as string) ?? "⚠️ 生成的文案包含不符合规范的内容，已被拦截。",
              );
            }
          },
          onError: (err: ApiError) =>
            setError({
              message: err.message,
              upgrade: err.code === "forbidden" || err.code === "rate_limited",
            }),
        },
      );
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const copy = () => {
    navigator.clipboard?.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="flex h-full flex-col bg-slate-50">
      <ImagesTabs />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        {/* ── 左侧参数 ── */}
        <aside className="w-full shrink-0 border-b border-slate-200 bg-white lg:w-[360px] lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <div className="p-5">
            <p className="text-xs text-slate-400">
              上传或选择图片，一键生成小红书笔记 / 营销文案 / alt 描述
            </p>

            {!canUse && (
              <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
                <span>🔒 图生文案为进阶权益</span>
                <button
                  onClick={() => router.push("/app/pricing")}
                  className="rounded-lg bg-amber-600 px-2.5 py-1 font-medium text-white hover:bg-amber-700"
                >
                  升级解锁
                </button>
              </div>
            )}

            {/* 参考图 */}
            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between text-sm font-medium text-slate-600">
                <span>参考图</span>
                <span className="text-[11px] font-normal text-slate-400">
                  {picked.length}/{maxImages}
                </span>
              </div>

              <div className="flex flex-wrap gap-2">
                {picked.map((p) => (
                  <div
                    key={p.url}
                    className="group relative h-16 w-16 overflow-hidden rounded-xl ring-1 ring-slate-200"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt="参考图" className="h-full w-full object-cover" />
                    <button
                      onClick={() => setPicked((prev) => prev.filter((x) => x.url !== p.url))}
                      className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900/70 text-[10px] text-white opacity-0 transition group-hover:opacity-100"
                      title="移除"
                    >
                      ✕
                    </button>
                  </div>
                ))}

                {picked.length < maxImages && (
                  <>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      multiple
                      hidden
                      onChange={(e) => onFilesSelected(e.target.files)}
                    />
                    <button
                      onClick={() => fileRef.current?.click()}
                      disabled={uploading}
                      className="flex h-16 w-16 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 text-slate-400 transition hover:border-brand-400 hover:text-brand-500 disabled:opacity-50"
                    >
                      <span className="text-lg">{uploading ? "…" : "+"}</span>
                      <span className="text-[10px]">上传</span>
                    </button>
                  </>
                )}
              </div>

              {/* 从画廊选择：仅横向展示最近 8 张，更多走弹窗，保证左栏高度恒定 */}
              {assets.length > 0 && (
                <div className="mt-3">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-slate-400">或从我的作品中选择</span>
                    <button
                      onClick={() => setPickerOpen(true)}
                      className="text-[11px] font-medium text-brand-600 transition hover:underline"
                    >
                      浏览全部 →
                    </button>
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {assets.slice(0, 8).map((a) => {
                      const active = picked.some((p) => p.url === a.url);
                      const disabled = !active && picked.length >= maxImages;
                      return (
                        <button
                          key={a.id}
                          onClick={() => toggleGalleryImage(a)}
                          disabled={disabled}
                          title={disabled ? `最多选择 ${maxImages} 张` : a.prompt}
                          className={`relative h-14 w-14 shrink-0 overflow-hidden rounded-lg ring-2 transition ${
                            active ? "ring-brand-500" : "ring-transparent hover:ring-slate-300"
                          } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={a.url} alt={a.prompt} className="h-full w-full object-cover" />
                          {active && (
                            <span className="absolute inset-0 flex items-center justify-center bg-brand-600/40 text-xs text-white">
                              ✓
                            </span>
                          )}
                        </button>
                      );
                    })}
                    {assets.length > 8 && (
                      <button
                        onClick={() => setPickerOpen(true)}
                        title="浏览全部作品"
                        className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 text-slate-400 transition hover:border-brand-400 hover:text-brand-500"
                      >
                        <span className="text-base leading-none">⋯</span>
                        <span className="mt-0.5 text-[10px]">更多</span>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* 用途 */}
            <div className="mt-5">
              <div className="mb-2 text-sm font-medium text-slate-600">文案用途</div>
              <div className="grid grid-cols-1 gap-1.5">
                {options?.purposes.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setPurpose(p.id)}
                    className={`flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition ${
                      purpose === p.id
                        ? "border-brand-400 bg-brand-50"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <span className="text-lg">{p.icon}</span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-slate-700">{p.label}</span>
                      <span className="block truncate text-[11px] text-slate-400">{p.desc}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* 语气 */}
            <div className="mt-5">
              <div className="mb-2 text-sm font-medium text-slate-600">语气</div>
              <div className="grid grid-cols-2 gap-2">
                {options?.tones.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTone(t.id)}
                    className={`rounded-xl border py-2 text-xs transition ${
                      tone === t.id
                        ? "border-brand-400 bg-brand-50 text-brand-700"
                        : "border-slate-200 text-slate-500 hover:border-slate-300"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 补充要求 */}
            <label className="mt-5 block">
              <span className="mb-1.5 block text-sm font-medium text-slate-600">
                补充要求（选填）
              </span>
              <textarea
                rows={3}
                maxLength={1000}
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder="例如：产品名叫「蛙宝水杯」，目标人群是通勤白领，必须提到保温 12 小时"
                className="w-full resize-none rounded-xl border border-slate-200 p-3 text-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
              />
            </label>

            <div className="mt-5 flex gap-2">
              {running ? (
                <button
                  onClick={() => abortRef.current?.abort()}
                  className="flex-1 rounded-xl bg-slate-200 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-300"
                >
                  ⏹ 停止
                </button>
              ) : (
                <button
                  onClick={generate}
                  disabled={picked.length === 0}
                  className="flex-1 rounded-xl bg-brand-600 py-2.5 text-sm font-medium text-white shadow-lg shadow-brand-600/25 transition enabled:hover:bg-brand-700 disabled:opacity-40"
                >
                  ✨ 生成文案
                </button>
              )}
            </div>
          </div>
        </aside>

        {/* ── 右侧结果 ── */}
        <section className="flex min-w-0 flex-1 flex-col lg:overflow-hidden">
          <header className="flex items-center justify-between border-b border-slate-200 bg-white/80 px-5 py-3 backdrop-blur">
            <span className="text-sm font-medium text-slate-500">
              {running ? "正在生成文案…" : output ? "生成结果" : "文案预览"}
            </span>
            {output && !running && (
              <div className="flex gap-2">
                <button
                  onClick={copy}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 transition hover:border-brand-300 hover:text-brand-600"
                >
                  {copied ? "已复制 ✓" : "📋 复制"}
                </button>
                <button
                  onClick={() => router.push("/app/studio")}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 transition hover:border-brand-300 hover:text-brand-600"
                  title="本次结果已保存到创作历史"
                >
                  📁 我的创作
                </button>
              </div>
            )}
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

            {output ? (
              <div
                className={`rounded-2xl border bg-white p-5 shadow-sm ${
                  flagged ? "border-red-200" : "border-slate-200"
                }`}
              >
                <Markdown text={output} />
                {running && <span className="ml-0.5 animate-pulse text-brand-500">▋</span>}
              </div>
            ) : running ? (
              <div className="space-y-2.5 rounded-2xl border border-slate-200 bg-white p-5">
                {[...Array(4)].map((_, i) => (
                  <div
                    key={i}
                    className="h-3.5 animate-pulse rounded bg-slate-100"
                    style={{ width: `${90 - i * 12}%` }}
                  />
                ))}
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center py-16 text-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-brand-400 to-indigo-600 text-4xl shadow-lg shadow-brand-500/25">
                  📝
                </div>
                <div className="mt-4 text-lg font-medium text-slate-700">让图片自己开口说话</div>
                <p className="mt-1 max-w-sm text-sm text-slate-400">
                  选择参考图与文案用途，AI 会读图并按渠道口吻撰写文案，结果自动保存到创作历史
                </p>
              </div>
            )}
          </div>
        </section>
      </div>

      {pickerOpen && (
        <ImagePickerDialog
          selectedUrls={picked.map((p) => p.url)}
          max={maxImages}
          onToggle={toggleGalleryImage}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
