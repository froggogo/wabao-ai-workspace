import { getServerMediaAssets } from "@/lib/server/backend";
import { swrKeys } from "@/lib/swr-keys";
import { SWRFallback } from "@/providers/SWRFallback";
import { ImageCaptionView } from "@/components/images/ImageCaptionView";

export default async function ImageCaptionPage() {
  const assets = await getServerMediaAssets();
  return (
    <SWRFallback fallback={{ [swrKeys.images]: assets }}>
      <ImageCaptionView />
    </SWRFallback>
  );
}
