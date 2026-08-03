"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuthActions, useModerationRecords, useUsage, useUser } from "@/lib/hooks";
import { PLAN_LABELS } from "@/lib/mockData";

type Tab = "usage" | "profile" | "audit";

export function SettingsView() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("usage");
  const { user } = useUser();
  const { usage } = useUsage();

  const userPlan = user?.plan ?? "free";
  const usedTokens = usage?.used_tokens ?? 0;
  const quotaTokens = usage?.quota_tokens ?? 100000;
  const breakdown = usage?.breakdown ?? [];
  const planLabel = PLAN_LABELS[userPlan] ?? usage?.plan ?? "免费版";

  const pct = quotaTokens ? Math.round((usedTokens / quotaTokens) * 100) : 0;
  const near = pct >= 80;

  // 图像额度（张数）独立于 Token 计量
  const images = usage?.images;
  const imagePct =
    images && images.quota > 0 ? Math.round((images.used / images.quota) * 100) : 0;
  const imageNear = images != null && images.remaining !== null && imagePct >= 80;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <h1 className="text-2xl font-bold text-slate-800">设置</h1>

        <div className="mt-5 flex gap-1 border-b border-slate-200">
          <TabBtn active={tab === "usage"} onClick={() => setTab("usage")}>
            用量与配额
          </TabBtn>
          <TabBtn active={tab === "profile"} onClick={() => setTab("profile")}>
            个人信息
          </TabBtn>
          <TabBtn active={tab === "audit"} onClick={() => setTab("audit")}>
            审核记录
          </TabBtn>
        </div>

        {tab === "usage" && (
          <div className="mt-6 space-y-5">
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-500">当前套餐</span>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-brand-50 px-3 py-1 text-sm font-medium text-brand-700">
                    {planLabel}
                  </span>
                  <button
                    onClick={() => router.push("/app/pricing")}
                    className="rounded-full bg-brand-600 px-3 py-1 text-sm font-medium text-white transition hover:bg-brand-700"
                  >
                    {userPlan === "enterprise" ? "管理套餐" : "升级套餐 ↑"}
                  </button>
                </div>
              </div>
              <div className="mt-4">
                <div className="mb-1.5 flex justify-between text-sm">
                  <span className="text-slate-500">本月 Token 用量</span>
                  <span className={near ? "font-medium text-amber-600" : "text-slate-600"}>
                    {usedTokens.toLocaleString()} / {quotaTokens.toLocaleString()}
                  </span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full ${near ? "bg-amber-500" : "bg-brand-500"}`}
                    style={{ width: `${Math.min(100, pct)}%` }}
                  />
                </div>
                {near && (
                  <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    ⚠️ 已使用 {pct}%，接近本月配额，配额用尽后将暂时无法发起对话/创作
                  </div>
                )}
              </div>

              {/* AI 绘图额度按「张数」独立计量（P2 图像阶段） */}
              {images && (
                <div className="mt-5 border-t border-slate-100 pt-4">
                  <div className="mb-1.5 flex justify-between text-sm">
                    <span className="flex items-center gap-1.5 text-slate-500">
                      🎨 本月 AI 绘图
                      {images.vision && (
                        <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] text-brand-600">
                          含看图问答
                        </span>
                      )}
                    </span>
                    <span
                      className={imageNear ? "font-medium text-amber-600" : "text-slate-600"}
                    >
                      {images.remaining === null
                        ? `${images.used.toLocaleString()} 张 · 不限量`
                        : `${images.used} / ${images.quota} 张`}
                    </span>
                  </div>
                  {images.remaining !== null && images.quota > 0 && (
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full ${
                          imageNear ? "bg-amber-500" : "bg-gradient-to-r from-brand-400 to-indigo-500"
                        }`}
                        style={{ width: `${Math.min(100, imagePct)}%` }}
                      />
                    </div>
                  )}
                  {imageNear && (
                    <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                      ⚠️ 绘图额度已用 {imagePct}%，用尽后将无法继续生成图片
                    </div>
                  )}
                </div>
              )}
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
                  {breakdown.map((b) => (
                    <tr key={b.feature} className="border-b border-slate-50 last:border-0">
                      <td className="px-5 py-3 text-slate-700">{b.label}</td>
                      <td className="px-5 py-3 text-slate-500">{b.calls}</td>
                      <td className="px-5 py-3 text-slate-500">{b.tokens.toLocaleString()}</td>
                      <td className="px-5 py-3 text-slate-500">
                        {usedTokens ? Math.round((b.tokens / usedTokens) * 100) : 0}%
                      </td>
                    </tr>
                  ))}
                  {breakdown.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-5 py-8 text-center text-slate-400">
                        本月还没有用量记录
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "profile" && <ProfileTab planLabel={planLabel} />}

        {tab === "audit" && <AuditTab />}
      </div>
    </div>
  );
}

function ProfileTab({ planLabel }: { planLabel: string }) {
  const { user, mutate: mutateUser } = useUser();
  const userName = user?.name ?? "";
  const userEmail = user?.email ?? "";
  const userAvatar = user?.avatar ?? "";

  const [name, setName] = useState(userName);
  const [avatar, setAvatar] = useState(userAvatar);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const dirty = name.trim() !== userName || avatar !== userAvatar;

  const save = async () => {
    if (!name.trim()) return setMsg("昵称不能为空");
    setSaving(true);
    setMsg("");
    try {
      const updated = await api.users.update({ name: name.trim(), avatar });
      await mutateUser(
        (u) => (u ? { ...u, name: updated.name, avatar: updated.avatar } : u),
        { revalidate: false },
      );
      setMsg("已保存 ✓");
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-6 space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-100 text-2xl font-medium text-brand-700">
            {avatar || userName.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <div className="text-lg font-medium text-slate-800">{userName}</div>
            <div className="text-sm text-slate-400">{userEmail}</div>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          <Field label="头像 Emoji">
            <input
              className="input"
              value={avatar}
              maxLength={4}
              onChange={(e) => setAvatar(e.target.value)}
              placeholder="例如 🐸 🙂 ⭐"
            />
          </Field>
          <Field label="昵称">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <ReadonlyRow label="邮箱" value={userEmail} />
          <ReadonlyRow label="套餐" value={planLabel} />
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="rounded-xl bg-brand-600 px-5 py-2 text-sm font-medium text-white transition enabled:hover:bg-brand-700 disabled:opacity-40"
          >
            {saving ? "保存中…" : "保存修改"}
          </button>
          {msg && <span className="text-sm text-slate-500">{msg}</span>}
        </div>
      </div>

      <ChangePassword />

      <style>{`.input{width:100%;border:1px solid #e2e8f0;border-radius:12px;padding:10px 14px;font-size:14px;outline:none;transition:.15s}.input:focus{border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.15)}`}</style>
    </div>
  );
}

function ChangePassword() {
  const router = useRouter();
  const { logout } = useAuthActions();
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    if (newPwd.length < 8) return setError("新密码至少 8 位");
    if (newPwd !== confirmPwd) return setError("两次输入的新密码不一致");
    setLoading(true);
    try {
      await api.auth.changePassword(oldPwd, newPwd);
      alert("密码修改成功，请使用新密码重新登录");
      await logout();
      router.replace("/login");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "修改失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="text-base font-medium text-slate-800">修改密码</h2>
      <p className="mt-1 text-xs text-slate-400">为安全起见，修改成功后需使用新密码重新登录。</p>
      <div className="mt-4 space-y-4">
        <Field label="原密码">
          <input
            type="password"
            className="input"
            value={oldPwd}
            onChange={(e) => setOldPwd(e.target.value)}
            placeholder="请输入当前密码"
          />
        </Field>
        <Field label="新密码">
          <input
            type="password"
            className="input"
            value={newPwd}
            onChange={(e) => setNewPwd(e.target.value)}
            placeholder="至少 8 位"
          />
        </Field>
        <Field label="确认新密码">
          <input
            type="password"
            className="input"
            value={confirmPwd}
            onChange={(e) => setConfirmPwd(e.target.value)}
            placeholder="再次输入新密码"
          />
        </Field>
        {error && <div className="text-sm text-red-500">{error}</div>}
        <button
          onClick={submit}
          disabled={loading || !oldPwd || !newPwd || !confirmPwd}
          className="rounded-xl bg-slate-800 px-5 py-2 text-sm font-medium text-white transition enabled:hover:bg-slate-900 disabled:opacity-40"
        >
          {loading ? "提交中…" : "确认修改"}
        </button>
      </div>
    </div>
  );
}

function AuditTab() {
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const { records, error, isLoading } = useModerationRecords(onlyFlagged);
  const errMsg = error instanceof ApiError ? error.message : error ? "加载失败" : "";

  return (
    <div className="mt-6 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">
          展示你的对话/创作内容的审核记录（输入与输出均自动送审）。
        </p>
        <label className="flex items-center gap-2 text-sm text-slate-500">
          <input
            type="checkbox"
            checked={onlyFlagged}
            onChange={(e) => setOnlyFlagged(e.target.checked)}
            className="accent-brand-600"
          />
          仅看命中
        </label>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-slate-400">
              <th className="px-5 py-3 font-medium">时间</th>
              <th className="px-5 py-3 font-medium">类型</th>
              <th className="px-5 py-3 font-medium">结果</th>
              <th className="px-5 py-3 font-medium">分类</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && !errMsg && (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-slate-400">
                  加载中…
                </td>
              </tr>
            )}
            {errMsg && (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-red-400">
                  {errMsg}
                </td>
              </tr>
            )}
            {records?.map((r) => (
              <tr key={r.id} className="border-b border-slate-50 last:border-0">
                <td className="px-5 py-3 text-slate-500">{new Date(r.createdAt).toLocaleString()}</td>
                <td className="px-5 py-3 text-slate-600">{r.refType === "input" ? "输入" : "输出"}</td>
                <td className="px-5 py-3">
                  {r.flagged ? (
                    <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-600">
                      {r.action === "block" ? "拦截" : "命中"}
                    </span>
                  ) : (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-600">通过</span>
                  )}
                </td>
                <td className="px-5 py-3 text-slate-500">
                  {r.categories.length ? r.categories.join("、") : "—"}
                </td>
              </tr>
            ))}
            {records && records.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-slate-400">
                  暂无审核记录
                </td>
              </tr>
            )}
          </tbody>
        </table>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

function ReadonlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-50 pb-3">
      <span className="text-sm text-slate-400">{label}</span>
      <span className="text-sm text-slate-700">{value}</span>
    </div>
  );
}
