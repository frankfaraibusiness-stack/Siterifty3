import { ImageResponse } from "next/og";
import { OgCard, OG_SIZE } from "@/lib/og/ogCard";

export const size = OG_SIZE;
export const contentType = "image/png";

// Same hero photo used as Hero.tsx's blurred background (see .hero-bg in
// app/globals.css) — reused here as the marketplace share-preview photo
// instead of the plain brand card every other route without its own
// opengraph-image.tsx falls back to.
const HERO_PHOTO_URL =
  "https://cdn.phototourl.com/member/2026-07-19-76eb6d0e-70b8-42c5-8425-4024c50fbe2a.jpg";

// Static route, same content for every visitor — no params, no data
// fetch, unlike listing/seller's per-item OG images.
export default function Image() {
  return new ImageResponse(
    (
      <OgCard
        eyebrow="Marketplace"
        title="Buy & sell websites, apps & games"
        subtitle="Verified listings, escrow-protected from first message to final payout."
        photoUrl={HERO_PHOTO_URL}
      />
    ),
    { ...OG_SIZE }
  );
}
