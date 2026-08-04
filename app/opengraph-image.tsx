import { ImageResponse } from "next/og";
import { OgCard, OG_SIZE } from "@/lib/og/ogCard";

export const size = OG_SIZE;
export const contentType = "image/png";

// Default/fallback card for "/" and any route without its own
// opengraph-image.tsx — Next.js falls back to this automatically up the
// route tree.
export default function Image() {
  return new ImageResponse(
    (
      <OgCard
        eyebrow="Siterifty"
        title="Buy & sell websites, apps, and games"
        subtitle="Escrow-protected deals, built for indie and small developers."
      />
    ),
    { ...OG_SIZE }
  );
}
