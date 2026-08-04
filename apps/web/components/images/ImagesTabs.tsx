"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useImageOptions, useMediaAssets } from "@/lib/hooks";
import type { ImageQuotaSnapshot } from "@/lib/types";

const TABS = [
  { href: "/app/images", label: "绘图工作台", icon: "🎨" },
  { href: "/app/images/caption", label: "图生文案", icon: "📝" },
  { href: "/app/images/gallery", label: "我的作品", icon: "🖼️" },
];

/**
 * 图像模块共用顶栏：品牌标题 + 二级导航 + 本月额度。
 * 三个子页面共用，避免各页面在内容区里塞互相跳转的按钮。
 */
export function ImagesTabs({ quota: override }: { quota?: ImageQuotaSnapshot | null }) {
  const pathname = usePathname();
  const { assets } = useMediaAssets();
  const { options } = useImageOptions();

  // 生成过程中由调用方传入实时额度，未传则以后端目录为准
  const quota =
    override ??
    (options
      ? {
          quota: options.limits.monthlyImages,
          used: options.limits.usedImages,
          remaining: options.limits.remainingImages,
        }
      : null);

  return (
    <header className="shrink-0 border-b border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-2.5">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-indigo-600 text-base shadow-sm shadow-brand-500/25">
            🎨
          </span>
          <span className="font-semibold text-slate-800">AI 绘图</span>
          {options?.mock && (
            <span
              className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600"
              title="后端未配置 OPENAI_API_KEY，当前返回占位内容用于演示全链路"
            >
              mock
            </span>
          )}
        </div>

        <nav className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
          {TABS.map((t) => {
            const active = pathname === t.href;
            const badge = t.href === "/app/images/gallery" ? assets.length : 0;
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition ${
                  active
                    ? "bg-white font-medium text-brand-700 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                <span className="text-base leading-none">{t.icon}</span>
                <span className="hidden sm:inline">{t.label}</span>
                {badge > 0 && (
                  <span
                    className={`rounded-full px-1.5 text-[10px] ${
                      active ? "bg-brand-50 text-brand-600" : "bg-slate-200 text-slate-500"
                    }`}
                  >
                    {badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {quota && <QuotaMeter quota={quota} />}
      </div>
    </header>
  );
}

function QuotaMeter({ quota }: { quota: ImageQuotaSnapshot }) {
  const unlimited = quota.remaining === null;
  const percent = unlimited || quota.quota <= 0 ? 0 : Math.min(100, (quota.used / quota.quota) * 100);
  const low = !unlimited && (quota.remaining ?? 0) <= 3;

  return (
    <div className="ml-auto flex items-center gap-2 text-[11px] text-slate-400">
      <span className="hidden sm:inline">本月额度</span>
      <span className={`font-medium ${low ? "text-amber-600" : "text-slate-600"}`}>
        {unlimited ? "不限量" : `${quota.used} / ${quota.quota} 张`}
      </span>
      {!unlimited && quota.quota > 0 && (
        <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
          <span
            className={`block h-full rounded-full transition-all ${low ? "bg-amber-500" : "bg-brand-500"}`}
            style={{ width: `${percent}%` }}
          />
        </span>
      )}
      {low && (
        <Link href="/app/pricing" className="font-medium text-brand-600 hover:underline">
          升级 →
        </Link>
      )}
    </div>
  );
}
