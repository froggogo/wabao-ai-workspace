"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuthActions, useUser } from "@/lib/hooks";
import { PLAN_LABELS } from "@/lib/mockData";

const NAV = [
  { to: "/app/chat", label: "对话", icon: "💬" },
  { to: "/app/studio", label: "创作", icon: "✨" },
  { to: "/app/images", label: "绘图", icon: "🎨" },
  { to: "/app/assistants", label: "助手", icon: "🎭" },
  { to: "/app/pricing", label: "会员", icon: "👑" },
  { to: "/app/settings", label: "设置", icon: "⚙️" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useUser();
  const { logout } = useAuthActions();

  const plan = user?.plan ?? "free";
  const userName = user?.name ?? "";
  const userEmail = user?.email ?? "";
  const userAvatar = user?.avatar ?? "";

  return (
    <div className="flex h-full w-full bg-slate-50">
      {/* 全局左侧导航 */}
      <aside className="flex w-[68px] shrink-0 flex-col items-center justify-between overflow-y-auto bg-gradient-to-b from-brand-700 to-brand-900 py-4 text-white">
        <div className="flex flex-col items-center gap-6">
          <div className="text-2xl" title="蛙宝 AI">
            ✨
          </div>
          <nav className="flex flex-col gap-2">
            {NAV.map((n) => {
              const isActive = pathname === n.to || pathname.startsWith(`${n.to}/`);
              return (
                <Link
                  key={n.to}
                  href={n.to}
                  className={`flex h-12 w-12 flex-col items-center justify-center rounded-xl text-[11px] transition ${
                    isActive ? "bg-white/20 font-medium" : "text-brand-100 hover:bg-white/10"
                  }`}
                >
                  <span className="text-lg leading-none">{n.icon}</span>
                  <span className="mt-0.5">{n.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="group relative">
          <button
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-sm font-medium hover:bg-white/25"
            title={userEmail}
          >
            {userAvatar || userName.slice(0, 1).toUpperCase()}
          </button>
          <div className="absolute bottom-0 left-14 z-20 hidden w-48 rounded-xl border border-slate-200 bg-white p-2 text-slate-700 shadow-xl group-hover:block">
            <div className="px-2 py-1.5 text-xs text-slate-400">{userEmail}</div>
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="text-xs text-slate-400">当前套餐</span>
              <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                {PLAN_LABELS[plan]}
              </span>
            </div>
            <button
              onClick={() => router.push("/app/pricing")}
              className="w-full rounded-lg px-2 py-1.5 text-left text-sm text-brand-700 hover:bg-brand-50"
            >
              👑 升级会员
            </button>
            <div className="my-1 border-t border-slate-100" />
            <button
              onClick={async () => {
                await logout();
                router.replace("/login");
                router.refresh();
              }}
              className="w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-100"
            >
              退出登录
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
