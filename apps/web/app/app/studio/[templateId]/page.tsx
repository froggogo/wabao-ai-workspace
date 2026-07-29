import { getServerCreations, getServerTemplate } from "@/lib/server/backend";
import { swrKeys } from "@/lib/swr-keys";
import { SWRFallback } from "@/providers/SWRFallback";
import { StudioTemplateView } from "@/components/studio/StudioTemplateView";

export default async function StudioTemplatePage({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  const { templateId } = await params;
  const [template, creations] = await Promise.all([
    getServerTemplate(templateId),
    getServerCreations(),
  ]);

  const fallback: Record<string, unknown> = {
    [swrKeys.creations]: creations,
  };
  if (template) {
    fallback[swrKeys.template(templateId)] = template;
  }

  return (
    <SWRFallback fallback={fallback}>
      <StudioTemplateView templateId={templateId} />
    </SWRFallback>
  );
}
