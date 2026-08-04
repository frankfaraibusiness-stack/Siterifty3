"use client";

// Ports the filter state + mpApplyAndRender's filter predicate from
// marketplace.js. Type filtering is passed through to the server (see
// useFeed's `type` param / handleFeed's activeTypes) exactly like the
// original passes mpTypeFilter into /api/listings — everything else
// (template/price) is client-side only in the original too, since
// handleFeed has no template/price params at all.
//
// SEO URL sync: filter state now also drives the address bar (see
// lib/marketplaceSeoUrls.ts for the path scheme —
// /marketplace/websites/under-500 etc.). Two directions:
//   1. Server route segments (app/marketplace/[type]/[bracket]/page.tsx)
//      parse the URL and pass the matching filters in as `initial`, so
//      the hook's very first render already reflects the URL instead of
//      always starting from "all"/cache and snapping a moment later.
//   2. Whenever filters change after that (via the UI), an effect below
//      computes the canonical path for the new state and router.replaces
//      to it — shallow, no scroll, no server round-trip, same UX as
//      before, just with the address bar staying in sync for
//      sharing/refresh/SEO. router.replace (not push) because filter
//      tweaks are not meant to pile up back-button history entries.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Listing, ListingType } from "@/lib/listings";
import { buildMarketplacePath, formatMarketplacePath } from "@/lib/marketplaceSeoUrls";

export type TemplateFilter = "all" | "template" | "not-template";

export interface MarketplaceFilters {
  typeFilter: ListingType | "all";
  templateFilter: TemplateFilter;
  priceMin: number;
  priceMax: number | null;
}

export interface MarketplaceFiltersInitial {
  typeFilter?: ListingType | "all";
  templateFilter?: TemplateFilter;
  priceMin?: number;
  priceMax?: number | null;
  searchQuery?: string;
}

// FALLBACK_PRICE_CAP is used only until useLimits() resolves the live value
// from GET /api/limits (app/api/_lib/limits.js's LIMITS.marketplace.priceCap
// / LIMITS.listing.priceMax — both mirror the same 10000 cap). This constant
// can't itself be the hook-derived live value since it's a module-level
// export consumed outside any component (this file has no JSX) — the actual
// live value is read via useLimits() in MarketplaceFilterBar.tsx, which is
// the only consumer that needs it.
export const FALLBACK_PRICE_CAP = 10000;

export interface ActiveTag {
  label: string;
  clear: () => void;
}

// Module-level cache, same rationale as useFeed's feedCache: MarketplaceGrid
// unmounts/remounts on navigation to/from /listing/[id] (a real route, not
// a modal), so component-local useState alone loses the user's filter and
// search selections on every "back" navigation. Persisting them here keeps
// the marketplace feeling like it never left, matching the original's
// single always-mounted overlay.
interface FiltersCacheEntry {
  typeFilter: ListingType | "all";
  templateFilter: TemplateFilter;
  priceMin: number;
  priceMax: number | null;
  searchQuery: string;
}
let filtersCache: FiltersCacheEntry | null = null;

// Exported so a caller that needs a genuine reset — not just navigating
// away — can clear the cache before pushing. Without this, "Back to
// marketplace" from a ?q= search would push to /marketplace, but the
// next mount there still reads the stale filtersCache.searchQuery (since
// plain /marketplace has no `initial` to override it), and the syncUrl
// effect below would then router.replace that same query straight back
// into the address bar — the query "clearing" and then immediately
// reappearing.
export function clearMarketplaceFiltersCache() {
  filtersCache = null;
}

// `initial` — passed by a server route segment that parsed a real URL
// (e.g. /marketplace/websites/under-500) — takes priority over the
// cross-navigation cache on first mount: landing on a specific indexed
// URL should show exactly what that URL promises, not whatever filters
// happened to be cached from browsing before. The cache still governs
// plain /marketplace (no `initial`), preserving the original
// "marketplace never forgets your filters" behavior for that route.
//
// `syncUrl` — MUST be true only for the one MarketplaceGrid mount that IS
// the /marketplace route itself (app/marketplace/page.tsx and its
// [type]/[bracket] children). MarketplaceGrid is also mounted on the
// homepage (preview mode, still sitting on "/") and inside
// MarketplaceModal (a portaled overlay that can open from any page) —
// neither of those should ever router.replace the address bar to
// /marketplace/..., since the user isn't actually on that route. Passing
// syncUrl defaults to false specifically so a caller has to opt in
// deliberately rather than the homepage/modal silently inheriting it.
export function useMarketplaceFilters(initial?: MarketplaceFiltersInitial, syncUrl = false) {
  const router = useRouter();
  const [typeFilter, setTypeFilterState] = useState<ListingType | "all">(
    initial?.typeFilter ?? filtersCache?.typeFilter ?? "all"
  );
  const [templateFilter, setTemplateFilterState] = useState<TemplateFilter>(
    initial?.templateFilter ?? filtersCache?.templateFilter ?? "all"
  );
  const [priceMin, setPriceMinState] = useState(initial?.priceMin ?? filtersCache?.priceMin ?? 0);
  const [priceMax, setPriceMaxState] = useState<number | null>(
    initial?.priceMax !== undefined ? initial.priceMax : filtersCache?.priceMax ?? null
  );
  // Mirrors mpSearchQuery — trimmed/lowercased in the input handler, not
  // here, same as the original. Deliberately excluded from mpUpdateActiveTags
  // / activeTags below (confirmed: search never appears as an active-filter
  // chip in the original).
  const [searchQuery, setSearchQueryState] = useState(initial?.searchQuery ?? filtersCache?.searchQuery ?? "");

  // Keep the cache in sync with every change so the next mount (after a
  // navigate-away-and-back) rehydrates from the latest values.
  const syncCache = useCallback((patch: Partial<FiltersCacheEntry>) => {
    filtersCache = {
      typeFilter: filtersCache?.typeFilter ?? "all",
      templateFilter: filtersCache?.templateFilter ?? "all",
      priceMin: filtersCache?.priceMin ?? 0,
      priceMax: filtersCache?.priceMax ?? null,
      searchQuery: filtersCache?.searchQuery ?? "",
      ...patch,
    };
  }, []);

  const setTypeFilter = useCallback(
    (v: ListingType | "all") => {
      setTypeFilterState(v);
      syncCache({ typeFilter: v });
    },
    [syncCache]
  );
  const setTemplateFilter = useCallback(
    (v: TemplateFilter) => {
      setTemplateFilterState(v);
      syncCache({ templateFilter: v });
    },
    [syncCache]
  );
  const setSearchQuery = useCallback(
    (v: string) => {
      setSearchQueryState(v);
      syncCache({ searchQuery: v });
    },
    [syncCache]
  );

  const clearType = useCallback(() => setTypeFilter("all"), [setTypeFilter]);
  const clearTemplate = useCallback(() => setTemplateFilter("all"), [setTemplateFilter]);
  const clearPrice = useCallback(() => {
    setPriceMinState(0);
    setPriceMaxState(null);
    syncCache({ priceMin: 0, priceMax: null });
  }, [syncCache]);

  const fmt = (n: number) =>
    Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const activeTags: ActiveTag[] = useMemo(() => {
    const tags: ActiveTag[] = [];
    if (typeFilter !== "all") {
      tags.push({ label: `Type: ${typeFilter}`, clear: clearType });
    }
    if (templateFilter !== "all") {
      tags.push({
        label: templateFilter === "template" ? "Templates only" : "Full products",
        clear: clearTemplate,
      });
    }
    if (priceMin > 0 || priceMax !== null) {
      const hMin = priceMin > 0;
      const hMax = priceMax !== null;
      let label: string;
      if (hMin && hMax) label = `Price: $${fmt(priceMin)} – $${fmt(priceMax as number)} USD`;
      else if (hMin) label = `Price: $${fmt(priceMin)}+ USD`;
      else label = `Price: up to $${fmt(priceMax as number)} USD`;
      tags.push({ label, clear: clearPrice });
    }
    return tags;
  }, [typeFilter, templateFilter, priceMin, priceMax, clearType, clearTemplate, clearPrice]);

  // Client-side portion of mpApplyAndRender's filter chain — template and
  // price only. Type itself is still applied server-side via useFeed's
  // `type` param. Search is deliberately NOT re-applied here: when a
  // search query is active, MarketplaceGrid's sourceListings are already
  // the server's scored/matched results (see useSearchResults +
  // _handler.js's handleSearch), which don't necessarily contain a raw
  // lowercase substring match of `searchQuery` in title/description/type
  // (server scoring can differ from a literal .includes() check). Re-
  // filtering those results against searchQuery here was silently
  // dropping every legitimate match back out to an empty list.
  const applyClientFilters = useCallback(
    (listings: Listing[]) => {
      let f = listings;
      if (templateFilter === "template") f = f.filter((l) => l.isTemplate === true);
      else if (templateFilter === "not-template") f = f.filter((l) => !l.isTemplate);
      if (priceMin > 0 || priceMax !== null) {
        f = f.filter((l) => {
          const p = l.financials?.price;
          if (typeof p !== "number") return false;
          if (priceMin > 0 && p < priceMin) return false;
          if (priceMax !== null && p > priceMax) return false;
          return true;
        });
      }
      return f;
    },
    [templateFilter, priceMin, priceMax]
  );

  const currentPath = useMemo(
    () => buildMarketplacePath({ type: typeFilter, templateFilter, priceMin, priceMax, searchQuery }),
    [typeFilter, templateFilter, priceMin, priceMax, searchQuery]
  );

  // Keeps the address bar in sync with filter state (see file header).
  // Skips the very first render when that render's state came from
  // `initial` — the URL the server already rendered for is already
  // correct, so replacing it again on mount would be a wasted
  // history/route transition with no visible effect, just extra work.
  const skipNextSync = useRef(!!initial);
  useEffect(() => {
    if (!syncUrl) return;
    if (skipNextSync.current) {
      skipNextSync.current = false;
      return;
    }
    router.replace(formatMarketplacePath(currentPath), { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath, syncUrl]);

  return {
    typeFilter,
    setTypeFilter,
    templateFilter,
    setTemplateFilter,
    priceMin,
    priceMax,
    setPriceRange: (min: number, max: number | null) => {
      setPriceMinState(min);
      setPriceMaxState(max);
      syncCache({ priceMin: min, priceMax: max });
    },
    searchQuery,
    setSearchQuery,
    activeTags,
    applyClientFilters,
    currentPath,
  };
}
