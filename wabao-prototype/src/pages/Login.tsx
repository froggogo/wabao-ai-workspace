import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../store/appStore";
import { ApiError } from "../lib/api";

export function Login() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("demo@wabao.ai");
  const [password, setPassword] = useState("demo1234");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const login = useApp((s) => s.login);
  const register = useApp((s) => s.register);
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) return setError("请输入有效的邮箱");
    if (password.length < 8) return setError("密码至少 8 位");
    setLoading(true);
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await register(email, password, name || undefined);
      }
      navigate("/app/chat");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "服务暂不可用，请确认后端已启动");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand-600 via-brand-700 to-indigo-900 p-4">
      <div className="grid w-full max-w-4xl grid-cols-1 overflow-hidden rounded-3xl bg-white shadow-2xl md:grid-cols-2">
        {/* 品牌侧 */}
        <div className="hidden flex-col justify-between bg-gradient-to-br from-brand-700 to-indigo-900 p-10 text-white md:flex">
          <div className="text-2xl font-bold">✨ 蛙宝 AI 工作台</div>
          <div>
            <div className="text-3xl font-bold leading-snug">文、图、声一体的<br />多模态 AI 工作台</div>
            <p className="mt-4 text-brand-100">
              一个入口，三种模态无缝切换。用文字、图片、语音自由地输入与创作。
            </p>
          </div>
          <div className="flex gap-2 text-xs text-brand-200">
            <span className="rounded-full bg-white/10 px-3 py-1">P1 · 文本</span>
            <span className="rounded-full bg-white/10 px-3 py-1">P2 · 图像</span>
            <span className="rounded-full bg-white/10 px-3 py-1">P3 · 语音</span>
          </div>
        </div>

        {/* 表单侧 */}
        <div className="p-8 md:p-10">
          <h1 className="text-2xl font-bold text-slate-800">
            {mode === "login" ? "欢迎回来" : "创建账号"}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {mode === "login" ? "登录以继续你的 AI 工作台" : "注册体验多模态 AI 能力"}
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            {mode === "register" && (
              <Field label="昵称">
                <input
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="怎么称呼你"
                />
              </Field>
            )}
            <Field label="邮箱">
              <input
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </Field>
            <Field label="密码">
              <input
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="至少 8 位"
              />
            </Field>

            {error && <div className="text-sm text-red-500">{error}</div>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-brand-600 py-2.5 font-medium text-white shadow-lg shadow-brand-600/30 transition hover:bg-brand-700 disabled:opacity-50"
            >
              {loading ? "处理中…" : mode === "login" ? "登 录" : "注 册"}
            </button>
          </form>

          <div className="mt-5 text-center text-sm text-slate-500">
            {mode === "login" ? "还没有账号？" : "已有账号？"}
            <button
              className="ml-1 font-medium text-brand-600 hover:underline"
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setError("");
              }}
            >
              {mode === "login" ? "去注册" : "去登录"}
            </button>
          </div>
          <p className="mt-6 rounded-lg bg-slate-50 p-3 text-center text-xs text-slate-400">
            已连接真实后端：首次使用请先「去注册」创建账号（密码≥8 位）
          </p>
        </div>
      </div>

      <style>{`.input{width:100%;border:1px solid #e2e8f0;border-radius:12px;padding:10px 14px;font-size:14px;outline:none;transition:.15s}.input:focus{border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.15)}`}</style>
    </div>
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
