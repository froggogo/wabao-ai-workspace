import { getServerImageOptions, getServerMediaAssets } from "@/lib/server/backend";
import { swrKeys } from "@/lib/swr-keys";
import { SWRFallback } from "@/providers/SWRFallback";
import { ImageCaptionView } from "@/components/images/ImageCaptionView";

export default async function ImageCaptionPage({
  searchParams,
}: {
  searchParams: Promise<{ image?: string | string[] }>;
}) {
  const [assets, options, params] = await Promise.all([
    getServerMediaAssets(),
    getServerImageOptions(),
    searchParams,
  ]);

  // 从作品页「写文案」带过来的图片。只接受本站 /uploads 下的相对路径，
  // 避免通过 URL 参数把任意外链塞进视觉模型的输入。
  const raw = Array.isArray(params.image) ? params.image[0] : params.image;
  const initialImageUrl =
    raw && raw.startsWith("/uploads/") && !raw.includes("..") ? raw : undefined;

  return (
    <SWRFallback
      fallback={{
        [swrKeys.images]: assets,
        [swrKeys.imageOptions]: options,
      }}
    >
      <ImageCaptionView initialImageUrl={initialImageUrl} />
    </SWRFallback>
  );
}
