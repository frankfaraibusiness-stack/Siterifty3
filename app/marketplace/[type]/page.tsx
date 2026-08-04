import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import MarketplaceGrid from "@/components/marketplace/MarketplaceGrid";
import SearchResultsGrid from "@/components/marketplace/SearchResultsGrid";
import SiteriftyLoader from "@/components/layout/SiteriftyLoader";
import { searchListingsServer } from "../searchListings";
import { buildMarketplaceMetadata } from "../marketplaceMetadata";
import { SLUG_TO_TYPE } from "@/lib/marketplaceSeoUrls";

// /marketplace/websites, /marketplace/apps, /marketplace/games — the
// single-facet indexed pages (see lib/marketplaceSeoUrls.ts's header for
// why only a curated set of facets get real paths). A type alone with no
// further facet is always indexable; price brackets and /templates are
// handled one level down by [bracket]/page.tsx.
//
// This segment also carries the "type + custom price range" and
// "type + ?q=" cases — both stay noindexed query params layered on this
// same path rather than inventing new indexed routes for them (see
// buildMarketplacePath in lib/marketplaceSeoUrls.ts).
type Params = { type: string };
type SearchParams = { q?: string | string[]; priceMin?: string | string[]; priceMax?: string | string[] };

function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

const TYPE_LABEL: Record<string, string> = {
  websites: "Websites",
  apps: "Apps",
  games: "Games",
};

function resolveType(slug: string) {
  return SLUG_TO_TYPE[slug];
}

export async function generateStaticParams() {
  return Object.keys(SLUG_TO_TYPE).map((type) => ({ type }));
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const { type: typeSlug } = await params;
  const type = resolveType(typeSlug);
  if (!type) return buildMarketplaceMetadata({ pathSuffix: "", noindex: false });

  const sp = await searchParams;
  const q = firstParam(sp.q)?.trim();
  const priceMin = firstParam(sp.priceMin);
  const priceMax = firstParam(sp.priceMax);
  const hasCustomQuery = !!q || !!priceMin || !!priceMax;

  const qs = new URLSearchParams();
  if (q) qs.set("q", q);
  if (priceMin) qs.set("priceMin", priceMin);
  if (priceMax) qs.set("priceMax", priceMax);

  return buildMarketplaceMetadata({
    pathSuffix: `/${typeSlug}`,
    queryString: qs.toString() || undefined,
    facetLabel: TYPE_LABEL[typeSlug],
    typeSlug,
    noindex: hasCustomQuery,
    searchQuery: q,
  });
}

export default async function MarketplaceTypePage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const { type: typeSlug } = await params;
  const type = resolveType(typeSlug);
  // Not one of websites/apps/games, and not the /templates bracket slug
  // (that's handled by [bracket]/page.tsx one level down) — a genuinely
  // unknown segment is a real 404, not a silent fallback to "all".
  if (!type) notFound();

  const sp = await searchParams;
  const q = firstParam(sp.q)?.trim();
  const priceMinRaw = firstParam(sp.priceMin);
  const priceMaxRaw = firstParam(sp.priceMax);
  const priceMin = priceMinRaw ? Number(priceMinRaw) : undefined;
  const priceMax = priceMaxRaw ? Number(priceMaxRaw) : undefined;

  if (q) {
    const { listings, query } = await searchListingsServer(q, { type });
    return (
      <div style={{ marginTop: 92 }}>
        <SearchResultsGrid listings={listings} query={query} />
      </div>
    );
  }

  return (
    <div style={{ marginTop: 92 }}>
      <Suspense fallback={<SiteriftyLoader />}>
        <MarketplaceGrid
          syncUrl
          initialFilters={{
            typeFilter: type,
            priceMin: priceMin && !Number.isNaN(priceMin) ? priceMin : 0,
            priceMax: priceMax && !Number.isNaN(priceMax) ? priceMax : null,
          }}
        />
      </Suspense>
    </div>
  );
}
