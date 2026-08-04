// Single source of truth for the marketplace's indexable, path-based filter
// URLs (e.g. /marketplace/websites/under-500) — used by BOTH the server
// route segments (app/marketplace/[type]/[bracket]/page.tsx and friends,
// for generateMetadata + initial render) and the client
// (useMarketplaceFilters, to push the matching URL as filters change).
// Keeping this logic in one file guarantees the URL a user lands on from
// Google and the URL the client pushes when they reach the same filter
// state via clicking around are byte-for-byte identical — if they drifted,
// Google would see two different URLs for the same content and treat them
// as (at best) a canonical pair, at worst duplicate content.
//
// Why a curated bracket list instead of indexing every possible
// min/max combination: faceted nav with unbounded filter combinations is a
// well-known SEO trap (thousands of near-duplicate thin pages burn crawl
// budget and dilute ranking signal). The fix used across major e-commerce
// sites is to index only a small, deliberately chosen set of high-value
// facet combinations (a handful of price brackets per category) and
// noindex+canonicalize everything else back to the nearest indexed page.
// See each route's generateMetadata for where that noindex/canonical
// split actually happens.
import type { ListingType } from "@/lib/listings";
import type { TemplateFilter } from "@/lib/useMarketplaceFilters";

export const TYPE_SLUGS: Record<ListingType, string> = {
  website: "websites",
  app: "apps",
  game: "games",
  "3d": "3d",
};
export const SLUG_TO_TYPE: Record<string, ListingType> = {
  websites: "website",
  apps: "app",
  games: "game",
};

export interface PriceBracket {
  slug: string;
  label: string; // human-facing, used in <title>/<h1>
  min: number;
  max: number | null; // null = no upper bound
}

// Deliberately small and round — these are the brackets worth a real
// indexed page ("websites under $500" is a real search someone types;
// "websites $431 to $2,188" is not). Anything a user dials in via the
// slider that doesn't land exactly on one of these stays a noindexed
// ?priceMin=&priceMax= query on top of the nearest indexed page.
export const PRICE_BRACKETS: PriceBracket[] = [
  { slug: "under-100", label: "Under $100", min: 0, max: 100 },
  { slug: "100-to-500", label: "$100 – $500", min: 100, max: 500 },
  { slug: "500-to-2000", label: "$500 – $2,000", min: 500, max: 2000 },
  { slug: "2000-to-10000", label: "$2,000 – $10,000", min: 2000, max: 10000 },
  { slug: "over-10000", label: "Over $10,000", min: 10000, max: null },
];

// The "templates" bracket slug is reserved and mutually exclusive with the
// price brackets above — /marketplace/websites/templates, not
// /marketplace/websites/templates/under-500. Combining template+price
// would multiply the indexed set for marginal gain (exactly the
// combinatorial blowup the curated-bracket approach exists to avoid), so
// a template filter picked alongside a price bracket downgrades the URL
// to the noindexed query-param form instead of trying to express both in
// the path.
export const TEMPLATES_SLUG = "templates";

export function bracketBySlug(slug: string): PriceBracket | undefined {
  return PRICE_BRACKETS.find((b) => b.slug === slug);
}

// Exact-match only — a slider value of $500 matches the "under-500"
// bracket's max, but $499 does not. Exactness is what makes a path
// worth indexing at all (see file header); anything else falls through
// to the noindexed query-param path in buildMarketplacePath below.
export function bracketForRange(min: number, max: number | null): PriceBracket | undefined {
  return PRICE_BRACKETS.find((b) => b.min === min && b.max === max);
}

export interface MarketplacePathState {
  type: ListingType | "all";
  templateFilter: TemplateFilter;
  priceMin: number;
  priceMax: number | null;
  searchQuery: string;
}

export interface MarketplacePath {
  // Path relative to /marketplace, e.g. "" | "/websites" | "/websites/under-500"
  pathSuffix: string;
  // Query params layered on top (custom price range, ?q=) — always
  // noindex when non-empty (see each route's generateMetadata).
  query: URLSearchParams;
  // Whether this exact combination is one of the curated, indexed pages.
  // False whenever `query` carries a custom price range or a search term,
  // or when template+price-bracket were both requested at once.
  indexable: boolean;
}

// The inverse of the [type]/[bracket] route params: given the current
// filter state, compute the canonical URL for it. Used by
// useMarketplaceFilters to keep the address bar in sync with the UI, and
// safe to also use server-side for canonical-tag generation.
export function buildMarketplacePath(state: MarketplacePathState): MarketplacePath {
  const query = new URLSearchParams();
  const q = state.searchQuery.trim();
  if (q) query.set("q", q);

  if (state.type === "all") {
    // Template/price filters with no type selected have no indexed path
    // form at all (every curated bracket page implies a type) — they stay
    // query params on the bare /marketplace page.
    if (state.templateFilter !== "all") query.set("template", state.templateFilter === "template" ? "1" : "0");
    if (state.priceMin > 0) query.set("priceMin", String(state.priceMin));
    if (state.priceMax !== null) query.set("priceMax", String(state.priceMax));
    return { pathSuffix: "", query, indexable: q.length === 0 && query.toString().length === 0 };
  }

  const typeSlug = TYPE_SLUGS[state.type];
  const hasPrice = state.priceMin > 0 || state.priceMax !== null;
  const isTemplateOnly = state.templateFilter !== "all";

  if (isTemplateOnly && hasPrice) {
    // Combined facet — not one of the curated pages (see TEMPLATES_SLUG
    // comment above). Express as /marketplace/[type] + noindexed query
    // params rather than inventing a new path shape for it.
    query.set("template", state.templateFilter === "template" ? "1" : "0");
    if (state.priceMin > 0) query.set("priceMin", String(state.priceMin));
    if (state.priceMax !== null) query.set("priceMax", String(state.priceMax));
    return { pathSuffix: `/${typeSlug}`, query, indexable: false };
  }

  if (isTemplateOnly) {
    return {
      pathSuffix: `/${typeSlug}/${TEMPLATES_SLUG}`,
      query,
      indexable: q.length === 0,
    };
  }

  if (hasPrice) {
    const bracket = bracketForRange(state.priceMin, state.priceMax);
    if (bracket) {
      return { pathSuffix: `/${typeSlug}/${bracket.slug}`, query, indexable: q.length === 0 };
    }
    // Custom range that doesn't land on a curated bracket — stays a
    // noindexed query on top of the /marketplace/[type] page.
    if (state.priceMin > 0) query.set("priceMin", String(state.priceMin));
    if (state.priceMax !== null) query.set("priceMax", String(state.priceMax));
    return { pathSuffix: `/${typeSlug}`, query, indexable: false };
  }

  return { pathSuffix: `/${typeSlug}`, query, indexable: q.length === 0 };
}

export function formatMarketplacePath(p: MarketplacePath): string {
  const qs = p.query.toString();
  return `/marketplace${p.pathSuffix}${qs ? `?${qs}` : ""}`;
}
