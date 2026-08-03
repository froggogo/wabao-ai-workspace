import { getServerImageOptions, getServerMediaAssets } from "@/lib/server/backend";
import { swrKeys } from "@/lib/swr-keys";
import { SWRFallback } from "@/providers/SWRFallback";
import { ImagesView } from "@/components/images/ImagesView";

export default async function ImagesPage() {
  const [options, assets] = await Promise.all([getServerImageOptions(), getServerMediaAssets()]);
  return (
    <SWRFallback
      fallback={{
        [swrKeys.imageOptions]: options,
        [swrKeys.images]: assets,
      }}
    >
      <ImagesView />
    </SWRFallback>
  );
}
