import { getServerCreations, getServerTemplates } from "@/lib/server/backend";
import { swrKeys } from "@/lib/swr-keys";
import { SWRFallback } from "@/providers/SWRFallback";
import { StudioView } from "@/components/studio/StudioView";

export default async function StudioPage() {
  const [templates, creations] = await Promise.all([getServerTemplates(), getServerCreations()]);
  return (
    <SWRFallback
      fallback={{
        [swrKeys.templates()]: templates,
        [swrKeys.creations]: creations,
      }}
    >
      <StudioView />
    </SWRFallback>
  );
}
