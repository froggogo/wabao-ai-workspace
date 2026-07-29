"use client";

import { useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useUser } from "@/lib/hooks";
import { PLANS, PLAN_LABELS, PLAN_MATRIX, PLAN_RANK } from "@/lib/mockData";
import type { BillingCycle, Plan, PlanCellValue, PlanId } from "@/lib/types";

export default function PricingPage() {
  const { user, mutate: mutateUser } = useUser();
  const currentPlan: PlanId = user?.plan ?? "free";

  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [pending, setPending] = useState<Plan | null>(null);
  const [processing, setProcessing] = useState(false);
  const [toast, setToast] = useState("");

  const confirm = async () => {
    if (!pending) return;
    // 企业版为定制方案，走联系销售，不在线开通
    if (pending.priceMonthly === null) {
      setPending(null);
      return;
    }
    setProcessing(true);
    try {
      const res = await api.billing.subscribe(pending.id, cycle);
      await mutateUser(
        (u) => (u ? { ...u, plan: (res.plan as PlanId) ?? pending.id } : u),
        { revalidate: false },
      );
      setToast(`已切换到「${pending.name}」（原型演示，未实际扣费）`);
      setPending(null);
      setTimeout(() => setToast(""), 3200);
    } catch (err) {
      setToast(err instanceof ApiError ? err.message : "升级失败，请稍后再试");
      setPending(null);
      setTimeout(() => setToast(""), 3200);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      <div className="mx-auto max-w-6xl px-6 py-10">
        {/* 头部 */}
        <div className="text-center">
          <span className="inline-block rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
            会员升级
          </span>
          <h1 className="mt-3 text-3xl font-bold text-slate-800">选择适合你的套餐</h1>
          <p className="mx-auto mt-2 max-w-xl text-sm text-slate-500">
            定价参考 OpenAI ChatGPT 价格区间做本地化：Free / Plus($20) / Pro($200) / Team / Enterprise。
            套餐越高，配额、模型算力、优先级与协作能力越强。
          </p>

          {/* 计费周期切换 */}
          <div className="mt-6 inline-flex items-center rounded-full border border-slate-200 bg-white p-1 text-sm shadow-sm">
            <CycleBtn active={cycle === "monthly"} onClick={() => setCycle("monthly")}>
              按月
            </CycleBtn>
            <CycleBtn active={cycle === "yearly"} onClick={() => setCycle("yearly")}>
              按年
              <span className="ml-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                省 2 个月
              </span>
            </CycleBtn>
          </div>
        </div>

        {/* 套餐卡片 */}
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {PLANS.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              cycle={cycle}
              currentPlan={currentPlan}
              onChoose={() => setPending(plan)}
            />
          ))}
        </div>

        {/* 权益对比表 */}
        <ComparisonTable currentPlan={currentPlan} />

        {/* 说明 */}
        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 text-xs leading-relaxed text-slate-500">
          <p className="font-medium text-slate-600">定价说明</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              价格区间对标 ChatGPT：Plus 约 $20/月、Pro 约 $200/月、Team 约 $25~30/人·月、Enterprise 定制；
              蛙宝按国内市场本地化定价，并对年付提供折扣。
            </li>
            <li>Token 为对话与创作的计量单位，超出当月配额后可加购或等待次月重置。</li>
            <li>本原型的升级为前端演示，不会真实扣费；正式版将接入支付（如微信 / 支付宝 / Stripe）。</li>
          </ul>
        </div>
      </div>

      {/* 升级确认弹窗 */}
      {pending && (
        <UpgradeModal
          plan={pending}
          cycle={cycle}
          currentPlan={currentPlan}
          processing={processing}
          onCancel={() => setPending(null)}
          onConfirm={confirm}
        />
      )}

      {/* 轻提示 */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-slate-900 px-5 py-3 text-sm text-white shadow-xl">
          ✓ {toast}
        </div>
      )}
    </div>
  );
}

function PlanCard({
  plan,
  cycle,
  currentPlan,
  onChoose,
}: {
  plan: Plan;
  cycle: BillingCycle;
  currentPlan: PlanId;
  onChoose: () => void;
}) {
  const isCurrent = plan.id === currentPlan;
  const isEnterprise = plan.priceMonthly === null;
  const isDowngrade = PLAN_RANK[plan.id] < PLAN_RANK[currentPlan];

  const price = cycle === "yearly" ? plan.priceYearlyPerMonth : plan.priceMonthly;
  const unitLabel = plan.unit === "seat" ? "/人·月" : "/月";

  return (
    <div
      className={`relative flex flex-col rounded-2xl border bg-white p-5 transition ${
        plan.featured
          ? "border-brand-500 shadow-lg shadow-brand-500/10 ring-1 ring-brand-500"
          : "border-slate-200 hover:border-slate-300"
      }`}
    >
      {plan.badge && (
        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-brand-600 px-3 py-0.5 text-[11px] font-medium text-white">
          {plan.badge}
        </span>
      )}

      <div className="text-base font-semibold text-slate-800">{plan.name}</div>
      <div className="mt-1 min-h-[32px] text-xs text-slate-500">{plan.tagline}</div>

      <div className="mt-4">
        {isEnterprise ? (
          <div className="text-2xl font-bold text-slate-800">定制</div>
        ) : price === 0 ? (
          <div className="text-2xl font-bold text-slate-800">
            ¥0<span className="text-sm font-normal text-slate-400">{unitLabel}</span>
          </div>
        ) : (
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold text-slate-800">¥{price}</span>
            <span className="text-sm font-normal text-slate-400">{unitLabel}</span>
          </div>
        )}
        <div className="mt-1 text-[11px] text-slate-400">
          {cycle === "yearly" && !isEnterprise && price !== 0 ? "年付均价" : plan.anchor}
        </div>
      </div>

      <button
        onClick={onChoose}
        disabled={isCurrent}
        className={`mt-4 w-full rounded-xl py-2 text-sm font-medium transition ${
          isCurrent
            ? "cursor-default bg-slate-100 text-slate-400"
            : plan.featured
              ? "bg-brand-600 text-white hover:bg-brand-700"
              : "border border-slate-300 text-slate-700 hover:bg-slate-50"
        }`}
      >
        {isCurrent ? "当前套餐" : isDowngrade ? "切换到此套餐" : plan.cta}
      </button>

      <ul className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-xs text-slate-600">
        {plan.highlights.map((h) => (
          <li key={h} className="flex gap-2">
            <span className="mt-0.5 text-brand-500">✓</span>
            <span>{h}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ComparisonTable({ currentPlan }: { currentPlan: PlanId }) {
  const groups = useMemo(() => {
    const map = new Map<string, typeof PLAN_MATRIX>();
    for (const row of PLAN_MATRIX) {
      const arr = map.get(row.group) ?? [];
      arr.push(row);
      map.set(row.group, arr);
    }
    return Array.from(map.entries());
  }, []);

  const planIds = PLANS.map((p) => p.id);

  return (
    <div className="mt-10">
      <h2 className="text-lg font-semibold text-slate-800">权益详细对比</h2>
      <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="px-4 py-3 text-left font-medium text-slate-400">权益</th>
              {planIds.map((id) => (
                <th
                  key={id}
                  className={`px-4 py-3 text-center font-semibold ${
                    id === currentPlan ? "bg-brand-50 text-brand-700" : "text-slate-700"
                  }`}
                >
                  {PLAN_LABELS[id]}
                  {id === currentPlan && <div className="text-[10px] font-normal text-brand-500">当前</div>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map(([group, rows]) => (
              <FragmentGroup key={group} group={group} rows={rows} planIds={planIds} currentPlan={currentPlan} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FragmentGroup({
  group,
  rows,
  planIds,
  currentPlan,
}: {
  group: string;
  rows: typeof PLAN_MATRIX;
  planIds: PlanId[];
  currentPlan: PlanId;
}) {
  return (
    <>
      <tr className="bg-slate-50/70">
        <td colSpan={planIds.length + 1} className="px-4 py-2 text-xs font-semibold text-slate-500">
          {group}
        </td>
      </tr>
      {rows.map((row) => (
        <tr key={row.label} className="border-b border-slate-50 last:border-0">
          <td className="px-4 py-3 text-slate-600">{row.label}</td>
          {planIds.map((id) => (
            <td key={id} className={`px-4 py-3 text-center ${id === currentPlan ? "bg-brand-50/40" : ""}`}>
              <Cell value={row.values[id]} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function Cell({ value }: { value: PlanCellValue }) {
  if (value === true) return <span className="text-brand-600">✓</span>;
  if (value === false) return <span className="text-slate-300">—</span>;
  return <span className="text-xs text-slate-600">{value}</span>;
}

function UpgradeModal({
  plan,
  cycle,
  currentPlan,
  processing,
  onCancel,
  onConfirm,
}: {
  plan: Plan;
  cycle: BillingCycle;
  currentPlan: PlanId;
  processing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isEnterprise = plan.priceMonthly === null;
  const isDowngrade = PLAN_RANK[plan.id] < PLAN_RANK[currentPlan];
  const price = cycle === "yearly" ? plan.priceYearlyPerMonth : plan.priceMonthly;
  const unitLabel = plan.unit === "seat" ? "/人·月" : "/月";
  const yearlyTotal = plan.priceYearlyPerMonth != null ? plan.priceYearlyPerMonth * 12 : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onCancel}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-slate-800">
          {isEnterprise ? "联系销售" : isDowngrade ? "切换套餐" : `升级到 ${plan.name}`}
        </h3>

        {isEnterprise ? (
          <div className="mt-3 space-y-3 text-sm text-slate-600">
            <p>
              企业版为定制方案，包含 SSO、审计、数据隔离、SLA 与专属客户成功经理。请留下联系方式，销售团队将与你联系。
            </p>
            <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
              📧 sales@wabao.ai · ☎ 400-000-0000
            </div>
          </div>
        ) : (
          <>
            <div className="mt-3 flex items-center justify-between rounded-xl bg-slate-50 p-4">
              <div>
                <div className="text-sm text-slate-500">
                  {plan.name} · {cycle === "yearly" ? "年付" : "月付"}
                </div>
                <div className="text-xs text-slate-400">{plan.anchor}</div>
              </div>
              <div className="text-right">
                <div className="text-xl font-bold text-slate-800">
                  ¥{price}
                  <span className="text-xs font-normal text-slate-400">{unitLabel}</span>
                </div>
                {cycle === "yearly" && yearlyTotal != null && price !== 0 && (
                  <div className="text-[11px] text-slate-400">年付 ¥{yearlyTotal.toLocaleString()}</div>
                )}
              </div>
            </div>
            <p className="mt-3 text-xs text-slate-400">
              原型演示：确认后仅在本地切换套餐状态，不会真实扣费。正式版将跳转支付。
            </p>
          </>
        )}

        <div className="mt-5 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 rounded-xl border border-slate-300 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            disabled={processing}
            className="flex-1 rounded-xl bg-brand-600 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            {processing ? "处理中…" : isEnterprise ? "我知道了" : "确认"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CycleBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center rounded-full px-4 py-1.5 transition ${
        active ? "bg-brand-600 text-white shadow" : "text-slate-500 hover:text-slate-700"
      }`}
    >
      {children}
    </button>
  );
}
