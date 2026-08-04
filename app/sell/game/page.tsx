import type { Metadata } from "next";
import { getPublicBaseUrl } from "@/lib/server/adminDb";
import SellGameClient from "./SellGameClient";

// Own metadata + OG image so this route stops silently inheriting /sell's
// (or the root layout's) title/description/image. OG image reuses the
// exact banner already shown for "Game" on the /sell type-picker card.
const TITLE = "Sell Your Game — List on Siterifty";
const DESCRIPTION =
  "List a browser game or downloadable build for sale on Siterifty. Escrow-protected deals, verified buyers, no upfront fees.";
const GAME_OG_IMAGE =
  "https://cdn.phototourl.com/member/2026-07-23-43f253a3-d3dd-411a-970e-066ae0e3b477.jpg";

export function generateMetadata(): Metadata {
  const url = `${getPublicBaseUrl()}/sell/game`;
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: url },
    openGraph: {
      title: TITLE,
      description: DESCRIPTION,
      url,
      type: "website",
      images: [{ url: GAME_OG_IMAGE, width: 1200, height: 630, alt: "Sell your game on Siterifty" }],
    },
    twitter: {
      card: "summary_large_image",
      title: TITLE,
      description: DESCRIPTION,
      images: [GAME_OG_IMAGE],
    },
  };
}

export default function SellGamePage() {
  return <SellGameClient />;
}
