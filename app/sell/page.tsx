import type { Metadata } from "next";
import { getPublicBaseUrl } from "@/lib/server/adminDb";
import SellPickerClient from "./SellPickerClient";

// Own metadata + OG image so /sell stops silently inheriting the root
// layout's homepage title/description/image — matches the same "own
// metadata > inherited" fix applied to /sell/website, /sell/app,
// /sell/game, and /sell/template. This is the type-picker screen itself
// (no single listing type), so its OG image reuses the "Website" banner —
// the first and most common option on the picker — rather than
// introducing a new image asset.
const TITLE = "Sell on Siterifty — List a Website, App, Game, or Template";
const DESCRIPTION =
  "List your website, app, game, or template for sale on Siterifty. Escrow-protected deals, verified buyers, no upfront fees.";
const SELL_OG_IMAGE =
  "https://cdn.phototourl.com/member/2026-07-23-94028826-7b73-44cb-aa8e-784df56bc085.jpg";

export function generateMetadata(): Metadata {
  const url = `${getPublicBaseUrl()}/sell`;
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: url },
    openGraph: {
      title: TITLE,
      description: DESCRIPTION,
      url,
      type: "website",
      images: [{ url: SELL_OG_IMAGE, width: 1200, height: 630, alt: "Sell on Siterifty" }],
    },
    twitter: {
      card: "summary_large_image",
      title: TITLE,
      description: DESCRIPTION,
      images: [SELL_OG_IMAGE],
    },
  };
}

export default function SellPage() {
  return <SellPickerClient />;
}
