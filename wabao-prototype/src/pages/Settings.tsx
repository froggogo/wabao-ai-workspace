import { useEffect, useState } from "react";
import { useApp } from "../store/appStore";
import { api } from "../lib/api";
import type { UsageBreakdown } from "../lib/types";

const PLAN_LABEL: Record<string, string> = { free: "免费版", pro: "专业版", team: "团队版" };

interface UsageState {
  plan: string;
  usedTokens: number;
  quotaTokens: number;
  breakdown: UsageBreakdown[];
}

export function Settings() {
  const [tab, setTab] = useState<"profile" | "usage">("usage");
  const { userName, userEmail } = useApp();
  const [usage, setUsage] = useState<UsageState>({
    plan: "free",
    usedTokens: 0,
    quotaTokens: 100000,
    breakdown: [],
  });

  useEffect(() => {
    api.users
      .usage()
      .then((u) =>
        setUsage({
          plan: u.plan,
          usedTokens: u.used_tokens,
          quotaTokens: u.quota_tokens,
          breakdown: u.breakdown,
        }),
      )
      .catch(() => undefined);
  }, []);

  const USAGE = {
    plan: PLAN_LABEL[usage.plan] ?? usage.plan,
    usedTokens: usage.usedTokens,
    quotaTokens: usage.quotaTokens,
    breakdown: usage.breakdown,
  };
  const pct = USAGE.quotaTokens ? Math.round((USAGE.usedTokens / USAGE.quotaTokens) * 100) : 0;
  const near = pct >= 80;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <h1 className="text-2xl font-bold text-slate-800">设置</h1>

        <div className="mt-5 flex gap-1 border-b border-slate-200">
          <TabBtn active={tab === "usage"} onClick={() => setTab("usage")}>用量与配额</TabBtn>
          <TabBtn active={tab === "profile"} onClick={() => setTab("profile")}>个人信息</TabBtn>
        </div>

        {tab === "usage" ? (
          <div className="mt-6 space-y-5">
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-500">当前套餐</span>
                <span className="rounded-full bg-brand-50 px-3 py-1 text-sm font-medium text-brand-700">
                  {USAGE.plan}
                </span>
              </div>
              <div className="mt-4">
                <div className="mb-1.5 flex justify-between text-sm">
                  <span className="text-slate-500">本月 Token 用量</span>
                  <span className={near ? "font-medium text-amber-600" : "text-slate-600"}>
                    {USAGE.usedTokens.toLocaleString()} / {USAGE.quotaTokens.toLocaleString()}
                  </span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full ${near ? "bg-amber-500" : "bg-brand-500"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                {near && (
                  <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    ⚠️ 已使用 {pct}%，接近本月配额，可考虑升级套餐
                  </div>
                )}
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-slate-400">
                    <th className="px-5 py-3 font-medium">功能</th>
                    <th className="px-5 py-3 font-medium">调用次数</th>
                    <th className="px-5 py-3 font-medium">Tokens</th>
                    <th className="px-5 py-3 font-medium">占比</th>
                  </tr>
                </thead>
                <tbody>
                  {USAGE.breakdown.map((b) => (
                    <tr key={b.feature} className="border-b border-slate-50 last:border-0">
                      <td className="px-5 py-3 text-slate-700">{b.label}</td>
                      <td className="px-5 py-3 text-slate-500">{b.calls}</td>
                      <td className="px-5 py-3 text-slate-500">{b.tokens.toLocaleString()}</td>
                      <td className="px-5 py-3 text-slate-500">
                        {USAGE.usedTokens ? Math.round((b.tokens / USAGE.usedTokens) * 100) : 0}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-100 text-2xl font-medium text-brand-700">
                {userName.slice(0, 1).toUpperCase()}
              </div>
              <div>
                <div className="text-lg font-medium text-slate-800">{userName}</div>
                <div className="text-sm text-slate-400">{userEmail}</div>
              </div>
            </div>
            <div className="mt-6 space-y-4">
              <Row label="昵称" value={userName} />
              <Row label="邮箱" value={userEmail} />
              <Row label="套餐" value={USAGE.plan} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px border-b-2 px-4 py-2 text-sm transition ${
        active ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-slate-400 hover:text-slate-600"
      }`}
    >
      {children}
    </button>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-50 pb-3">
      <span className="text-sm text-slate-400">{label}</span>
      <span className="text-sm text-slate-700">{value}</span>
    </div>
  );
}
