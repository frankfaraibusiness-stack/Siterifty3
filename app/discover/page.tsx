import type { Metadata } from "next";
import { getPublicBaseUrl } from "@/lib/server/adminDb";
import { staticOgImage, MARKETPLACE_OG_IMAGE } from "@/lib/og/staticOgImage";
import DiscoverPageClient from "./DiscoverPageClient";

// /discover was previously only reachable as an in-page takeover panel
// (DiscoverPanel, opened from MarketplaceFilterBar's "Discover" button)
// with no URL of its own — nothing to attach meta tags/a preview image
// to, so a link to "the Discover page" had no real page behind it and
// any share of it would fall back to whatever page happened to be
// underneath. This gives it a real route + its own metadata, reusing the
// same MARKETPLACE_OG_IMAGE the root layout and /marketplace already use
// (staticOgImage.ts's top comment explains why this is a static,
// pre-rendered image rather than a dynamic opengraph-image.tsx route).
const TITLE = "Discover — Siterifty";
const DESCRIPTION =
  "Browse a random mix of blog posts, listings, and sellers on Siterifty — a scrollable way to find something new.";

const { openGraphImages, twitterImages } = staticOgImage(MARKETPLACE_OG_IMAGE, "Siterifty — Discover");

export function generateMetadata(): Metadata {
  const url = `${getPublicBaseUrl()}/discover`;
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: url },
    openGraph: {
      title: TITLE,
      description: DESCRIPTION,
      url,
      images: openGraphImages,
    },
    twitter: {
      card: "summary_large_image",
      title: TITLE,
      description: DESCRIPTION,
      images: twitterImages,
    },
  };
}

export default function DiscoverPage() {
  return <DiscoverPageClient />;
}
