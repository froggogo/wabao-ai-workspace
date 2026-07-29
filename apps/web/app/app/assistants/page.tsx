import { getServerAssistants } from "@/lib/server/backend";
import { swrKeys } from "@/lib/swr-keys";
import { SWRFallback } from "@/providers/SWRFallback";
import { AssistantsView } from "@/components/assistants/AssistantsView";

export default async function AssistantsPage() {
  const assistants = await getServerAssistants();
  return (
    <SWRFallback fallback={{ [swrKeys.assistants]: assistants }}>
      <AssistantsView />
    </SWRFallback>
  );
}
