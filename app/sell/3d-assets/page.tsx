import type { Metadata } from "next";
import { getPublicBaseUrl } from "@/lib/server/adminDb";
import SellAssetClient from "./SellAssetClient";

// Own metadata + OG image, same convention as the other /sell/[type]
// routes (website/app/game/template) — see those page.tsx files for the
// full reasoning. OG image reuses the exact banner already shown for
// "3D Assets" on the /sell type-picker card.
const TITLE = "Sell Your 3D Asset — List on Siterifty";
const DESCRIPTION =
  "List a 3D model for sale on Siterifty with a live, embedded preview. Escrow-protected deals, verified buyers, no upfront fees.";
const ASSET_OG_IMAGE =
  "https://cdn.phototourl.com/member/2026-07-23-44fc3828-068f-4bfc-82e3-10e2be1c0df7.jpg";

export function generateMetadata(): Metadata {
  const url = `${getPublicBaseUrl()}/sell/3d-assets`;
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: url },
    openGraph: {
      title: TITLE,
      description: DESCRIPTION,
      url,
      type: "website",
      images: [{ url: ASSET_OG_IMAGE, width: 1200, height: 630, alt: "Sell your 3D asset on Siterifty" }],
    },
    twitter: {
      card: "summary_large_image",
      title: TITLE,
      description: DESCRIPTION,
      images: [ASSET_OG_IMAGE],
    },
  };
}

export default function SellAssetPage() {
  return <SellAssetClient />;
}
