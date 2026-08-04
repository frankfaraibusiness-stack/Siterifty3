import { Suspense } from "react";
import type { Metadata } from "next";
import MarketplaceGrid from "@/components/marketplace/MarketplaceGrid";
import SearchResultsGrid from "@/components/marketplace/SearchResultsGrid";
import SiteriftyLoader from "@/components/layout/SiteriftyLoader";
import { searchListingsServer } from "./searchListings";
import { buildMarketplaceMetadata } from "./marketplaceMetadata";

// Base /marketplace route — "all types, no filters" canonical page, plus
// the one query-param case that lives here rather than under a [type]
// segment: `?q=`. Free-text search has no clean path form (arbitrary user
// text isn't a facet worth a static route) and per lib/marketplaceSeoUrls.ts
// is always noindex — see buildMarketplaceMetadata's self-canonical
// rationale for why that's still given a real canonical tag rather than
// being pointed at the bare page.
//
// Path-based facets (type, price bracket, templates) now live in
// [type]/page.tsx and [type]/[bracket]/page.tsx — see
// lib/marketplaceSeoUrls.ts for the full scheme. This page only ever
// handles typeFilter === "all".
type SearchParams = { q?: string | string[]; search?: string | string[] };

function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const q = firstParam((await searchParams).q)?.trim();
  if (q) {
    return buildMarketplaceMetadata({
      pathSuffix: "",
      queryString: `q=${encodeURIComponent(q)}`,
      noindex: true,
      searchQuery: q,
    });
  }
  return buildMarketplaceMetadata({ pathSuffix: "", noindex: false });
}

// `?q=` is the one case that branches server-side: rather than let
// MarketplaceGrid's client-side search (SearchOverlay/MarketplaceFilterBar,
// via fetchSearchResults) be the only way to see results, a directly-
// linked/shared/refreshed `/marketplace?q=foo` URL resolves to real
// results on first paint — calling handleSearch in-process (see
// ./searchListings) at zero extra Firestore cost beyond what browsing
// already pays, same as handleFeed.
export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const resolved = await searchParams;
  const q = firstParam(resolved.q)?.trim();
  const wantsSearchOpen = firstParam(resolved.search) === "1";

  if (q) {
    const { listings, query } = await searchListingsServer(q);
    return (
      <div style={{ marginTop: 92 }}>
        <SearchResultsGrid listings={listings} query={query} />
      </div>
    );
  }

  return (
    <div style={{ marginTop: 92 }}>
      <Suspense fallback={<SiteriftyLoader />}>
        <MarketplaceGrid syncUrl autoOpenSearch={wantsSearchOpen} />
      </Suspense>
    </div>
  );
}
