// Static (pre-rendered) share-preview image, used in place of the
// dynamic next/og opengraph-image.tsx route for pages whose preview
// art doesn't change per-request. Points at externally-hosted image
// URLs (not /public) so the preview works regardless of this app's
// own deployment/build state. Returns absolute-URL image blocks for
// both openGraph.images and twitter.images so a page's
// generateMetadata can just spread the result in.
export function staticOgImage(url: string, alt: string) {
  const image = { url, width: 1200, height: 630, alt };
  return {
    openGraphImages: [image],
    twitterImages: [url],
  };
}

export const MARKETPLACE_OG_IMAGE =
  "https://cdn.phototourl.com/member/2026-07-20-ac4fdc9a-270f-485c-8e67-990e9e8de1b6.jpg";
export const SUPPORT_OG_IMAGE =
  "https://cdn.phototourl.com/member/2026-07-20-efda558d-1cca-4278-a6c2-1d850da8299f.jpg";
