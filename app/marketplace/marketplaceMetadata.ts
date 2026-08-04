// Shared <title>/description/canonical/robots builder for every marketplace
// route variant: the base /marketplace page, /marketplace/[type], and
// /marketplace/[type]/[bracket] (both the price-bracket and /templates
// forms). Centralized here so all four generateMetadata functions produce
// consistent, correctly-paired title+canonical+robots — a mismatch between
// those (e.g. an indexable page whose canonical points elsewhere) is a
// classic self-defeating faceted-nav SEO bug, so there's exactly one place
// this logic can drift.
import type { Metadata } from "next";
import { getPublicBaseUrl } from "@/lib/server/adminDb";
import { staticOgImage, MARKETPLACE_OG_IMAGE } from "@/lib/og/staticOgImage";

const { openGraphImages: MARKETPLACE_OG_IMAGES, twitterImages: MARKETPLACE_TWITTER_IMAGES } =
  staticOgImage(MARKETPLACE_OG_IMAGE, "Siterifty Marketplace");

const SITE_NAME = "Siterifty Marketplace";
const BASE_TITLE = `${SITE_NAME} | Buy & Sell Websites, Apps & Games`;
const BASE_DESCRIPTION =
  "Browse verified websites, apps, and games for sale — every deal backed by escrow protection, from first message to final payout.";

// Type-specific descriptor phrases, folded into the description for every
// /marketplace/[type] and /marketplace/[type]/[bracket] page. Distinct
// wording per type (rather than the same sentence with only the noun
// swapped) gives each of the 3 type pages and their bracket children a
// genuinely unique meta description — search engines weight description
// uniqueness as a (soft) quality signal, and it makes each result look
// different in the SERP rather than templated.
const TYPE_DESCRIPTOR: Record<string, string> = {
  websites: "SaaS products, blogs, and e-commerce stores",
  apps: "mobile and web apps with source code included",
  games: "indie games, Roblox experiences, and Unity projects",
};

export interface MarketplaceMetaInput {
  // Path relative to /marketplace, e.g. "" | "/websites" | "/websites/under-500"
  pathSuffix: string;
  // Raw query string WITHOUT the leading "?", e.g. "q=notion+clone" or
  // "priceMin=250&priceMax=800". Appended after pathSuffix when building
  // the canonical URL. Omit/empty for the clean indexed paths.
  queryString?: string;
  // Human-facing facet description used to build the title/description,
  // e.g. "Websites" or "Websites Under $500" or "Website Templates".
  facetLabel?: string;
  // "websites" | "apps" | "games" — looked up in TYPE_DESCRIPTOR to build
  // a type-specific description. Omit for the base /marketplace page
  // (which covers all three, so no single descriptor fits) and for the
  // ?q= search-results case (which gets its own wording regardless).
  typeSlug?: string;
  // Non-empty query string (custom price range, ?q=) forces noindex —
  // see lib/marketplaceSeoUrls.ts's `indexable` flag, which callers pass
  // through as `!indexable` here.
  noindex: boolean;
  // Only used for the noindex ?q= case, to build a distinct, honest title
  // even though it's not indexed (still shown in the tab, still useful
  // for social shares of the link).
  searchQuery?: string;
}

export function buildMarketplaceMetadata(input: MarketplaceMetaInput): Metadata {
  const base = getPublicBaseUrl();
  const canonicalPath = `/marketplace${input.pathSuffix}${input.queryString ? `?${input.queryString}` : ""}`;
  const url = `${base}${canonicalPath}`;

  let title = BASE_TITLE;
  let description = BASE_DESCRIPTION;

  if (input.searchQuery) {
    title = `"${input.searchQuery}" — Search Results | ${SITE_NAME}`;
    description = `Websites, apps, and games matching "${input.searchQuery}" on Siterifty — every deal backed by escrow protection, from first message to final payout.`;
  } else if (input.facetLabel) {
    title = `${input.facetLabel} for Sale | ${SITE_NAME}`;
    const descriptor = input.typeSlug ? TYPE_DESCRIPTOR[input.typeSlug] : undefined;
    description = descriptor
      ? `Browse ${input.facetLabel.toLowerCase()} for sale on Siterifty — ${descriptor}, every deal backed by escrow protection, from first message to final payout.`
      : `Browse ${input.facetLabel.toLowerCase()} for sale on Siterifty — every deal backed by escrow protection, from first message to final payout.`;
  }

  return {
    title,
    description,
    // See file header — noindex pages still get a real canonical (pointing
    // at themselves, i.e. self-canonical) rather than being pointed at the
    // base page: a self-canonical + noindex, follow is the standard pairing
    // for "don't index this exact URL, but do credit/crawl the links on
    // it", vs. a cross-canonical which would tell Google this page IS a
    // duplicate of another (not accurate — a search-results or custom-
    // range page has genuinely different content, it's just not worth
    // indexing on its own).
    robots: input.noindex ? { index: false, follow: true } : undefined,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: "website", images: MARKETPLACE_OG_IMAGES },
    twitter: { card: "summary_large_image", title, description, images: MARKETPLACE_TWITTER_IMAGES },
  };
}
