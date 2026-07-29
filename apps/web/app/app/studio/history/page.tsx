import { getServerCreations } from "@/lib/server/backend";
import { swrKeys } from "@/lib/swr-keys";
import { SWRFallback } from "@/providers/SWRFallback";
import { StudioHistoryView } from "@/components/studio/StudioHistoryView";

export default async function StudioHistoryPage() {
  const creations = await getServerCreations();
  return (
    <SWRFallback fallback={{ [swrKeys.creations]: creations }}>
      <StudioHistoryView />
    </SWRFallback>
  );
}
