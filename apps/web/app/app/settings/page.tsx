import { getServerModerationRecords, getServerUsage } from "@/lib/server/backend";
import { swrKeys } from "@/lib/swr-keys";
import { SWRFallback } from "@/providers/SWRFallback";
import { SettingsView } from "@/components/settings/SettingsView";

export default async function SettingsPage() {
  const [usage, moderation] = await Promise.all([
    getServerUsage(),
    getServerModerationRecords(false),
  ]);

  const fallback: Record<string, unknown> = {
    [swrKeys.moderation(false)]: moderation,
  };
  if (usage) {
    fallback[swrKeys.usage()] = usage;
  }

  return (
    <SWRFallback fallback={fallback}>
      <SettingsView />
    </SWRFallback>
  );
}
