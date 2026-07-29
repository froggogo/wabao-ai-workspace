import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useApp } from "./store/appStore";
import { AppLayout } from "./components/layout/AppLayout";
import { Login } from "./pages/Login";
import { Chat } from "./pages/Chat";
import { Studio } from "./pages/Studio";
import { StudioTemplate } from "./pages/StudioTemplate";
import { StudioHistory } from "./pages/StudioHistory";
import { Assistants } from "./pages/Assistants";
import { Settings } from "./pages/Settings";
import { Pricing } from "./pages/Pricing";
import type { JSX } from "react";

function RequireAuth({ children }: { children: JSX.Element }) {
  const loggedIn = useApp((s) => s.loggedIn);
  return loggedIn ? children : <Navigate to="/login" replace />;
}

export default function App() {
  const booting = useApp((s) => s.booting);
  const bootstrap = useApp((s) => s.bootstrap);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (booting) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-slate-50 text-slate-400">
        <div className="flex flex-col items-center gap-3">
          <div className="text-4xl">🐸</div>
          <div className="text-sm">正在加载蛙宝工作台…</div>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/app"
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/app/chat" replace />} />
        <Route path="chat" element={<Chat />} />
        <Route path="chat/:conversationId" element={<Chat />} />
        <Route path="studio" element={<Studio />} />
        <Route path="studio/history" element={<StudioHistory />} />
        <Route path="studio/:templateId" element={<StudioTemplate />} />
        <Route path="assistants" element={<Assistants />} />
        <Route path="pricing" element={<Pricing />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/app/chat" replace />} />
    </Routes>
  );
}
