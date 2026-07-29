import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/server/backend";
import { swrKeys } from "@/lib/swr-keys";
import { SWRFallback } from "@/providers/SWRFallback";
import { AppShell } from "@/components/layout/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // 服务端路由守卫：中间件已保证令牌新鲜，这里再兜底校验用户。
  const user = await getServerUser();
  if (!user) {
    redirect("/login");
  }

  return (
    <SWRFallback fallback={{ [swrKeys.user]: user }}>
      <AppShell>{children}</AppShell>
    </SWRFallback>
  );
}
