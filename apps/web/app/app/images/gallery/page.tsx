import { getServerImageOptions, getServerMediaAssets } from "@/lib/server/backend";
import { swrKeys } from "@/lib/swr-keys";
import { SWRFallback } from "@/providers/SWRFallback";
import { ImageGalleryView } from "@/components/images/ImageGalleryView";

export default async function ImageGalleryPage() {
  const [assets, options] = await Promise.all([getServerMediaAssets(), getServerImageOptions()]);
  return (
    <SWRFallback
      fallback={{
        [swrKeys.images]: assets,
        [swrKeys.imageOptions]: options,
      }}
    >
      <ImageGalleryView />
    </SWRFallback>
  );
}
