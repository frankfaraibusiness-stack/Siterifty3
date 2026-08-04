import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import MarketplaceGrid from "@/components/marketplace/MarketplaceGrid";
import SiteriftyLoader from "@/components/layout/SiteriftyLoader";
import { buildMarketplaceMetadata } from "../../marketplaceMetadata";
import { SLUG_TO_TYPE, bracketBySlug, PRICE_BRACKETS, TEMPLATES_SLUG } from "@/lib/marketplaceSeoUrls";

// /marketplace/websites/under-500, /marketplace/apps/templates, etc. — the
// two-facet indexed pages. `bracket` is either one of the curated price-
// bracket slugs (under-100, 100-to-500, ...) or the reserved "templates"
// slug. Anything else is a real 404 rather than silently falling through
// to the unfiltered type page — a typo'd or invented bracket slug isn't a
// legitimate filter combination and shouldn't resolve to content that
// doesn't match the URL.
type Params = { type: string; bracket: string };

const TYPE_LABEL: Record<string, string> = {
  websites: "Websites",
  apps: "Apps",
  games: "Games",
};

export async function generateStaticParams() {
  const params: Params[] = [];
  for (const typeSlug of Object.keys(SLUG_TO_TYPE)) {
    for (const bracket of PRICE_BRACKETS) {
      params.push({ type: typeSlug, bracket: bracket.slug });
    }
    params.push({ type: typeSlug, bracket: TEMPLATES_SLUG });
  }
  return params;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { type: typeSlug, bracket: bracketSlug } = await params;
  const type = SLUG_TO_TYPE[typeSlug];
  const typeLabel = TYPE_LABEL[typeSlug];
  if (!type || !typeLabel) return buildMarketplaceMetadata({ pathSuffix: "", noindex: false });

  if (bracketSlug === TEMPLATES_SLUG) {
    return buildMarketplaceMetadata({
      pathSuffix: `/${typeSlug}/${TEMPLATES_SLUG}`,
      facetLabel: `${typeLabel} Templates`,
      typeSlug,
      noindex: false,
    });
  }

  const bracket = bracketBySlug(bracketSlug);
  if (!bracket) return buildMarketplaceMetadata({ pathSuffix: "", noindex: false });

  return buildMarketplaceMetadata({
    pathSuffix: `/${typeSlug}/${bracketSlug}`,
    facetLabel: `${typeLabel} ${bracket.label}`,
    typeSlug,
    noindex: false,
  });
}

export default async function MarketplaceTypeBracketPage({ params }: { params: Promise<Params> }) {
  const { type: typeSlug, bracket: bracketSlug } = await params;
  const type = SLUG_TO_TYPE[typeSlug];
  if (!type) notFound();

  if (bracketSlug === TEMPLATES_SLUG) {
    return (
      <div style={{ marginTop: 92 }}>
        <Suspense fallback={<SiteriftyLoader />}>
          <MarketplaceGrid
            syncUrl
            initialFilters={{ typeFilter: type, templateFilter: "template" }}
          />
        </Suspense>
      </div>
    );
  }

  const bracket = bracketBySlug(bracketSlug);
  if (!bracket) notFound();

  return (
    <div style={{ marginTop: 92 }}>
      <Suspense fallback={<SiteriftyLoader />}>
        <MarketplaceGrid
          syncUrl
          initialFilters={{ typeFilter: type, priceMin: bracket.min, priceMax: bracket.max }}
        />
      </Suspense>
    </div>
  );
}
