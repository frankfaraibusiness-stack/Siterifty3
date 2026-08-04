"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useFeed } from "@/lib/useFeed";
import { useSearchResults } from "@/lib/useSearchResults";
import { useMarketplaceFilters, type MarketplaceFiltersInitial } from "@/lib/useMarketplaceFilters";
import { buildInterleavedFeed } from "@/lib/feedInterleave";
import type { Listing } from "@/lib/listings";
import ListingCard from "@/components/marketplace/ListingCard";
import MarketplaceFilterBar from "@/components/marketplace/MarketplaceFilterBar";
import PremiumSellersStrip from "@/components/marketplace/PremiumSellersStrip";
import BoostedRow from "@/components/marketplace/BoostedRow";
import AdSlot from "@/components/marketplace/AdSlot";
import SellerPromoCard from "@/components/marketplace/SellerPromoCard";
import AiPromoCard from "@/components/marketplace/AiPromoCard";
import { buildListingSlug } from "@/lib/slug";
import { buildMarketplacePath, formatMarketplacePath } from "@/lib/marketplaceSeoUrls";
import SiteriftyLoader from "@/components/layout/SiteriftyLoader";
import ListingCardSkeleton from "@/components/marketplace/ListingCardSkeleton";
import { useSrToast } from "@/components/system/SrToastProvider";

const PREVIEW_COUNT = 12;

export default function MarketplaceGrid({
  autoOpenSearch = false,
  onExitTakeover,
  preview = false,
  onSeeFullMarketplace,
  initialFilters,
  syncUrl = false,
}: {
  autoOpenSearch?: boolean;
  onExitTakeover?: () => void;
  // Homepage-only mode: shows a fixed, small number of listings with no
  // infinite scroll, ending in a "See full marketplace" CTA instead of
  // loading forever. /marketplace itself never passes this — it stays
  // the one place with the real, unrestricted infinite-scroll feed.
  preview?: boolean;
  onSeeFullMarketplace?: () => void;
  // Seeds filter state from a parsed server route (e.g.
  // /marketplace/websites/under-500) — only ever passed by
  // app/marketplace/page.tsx and its [type]/[bracket] children.
  initialFilters?: MarketplaceFiltersInitial;
  // Pushes the canonical URL for the current filters via router.replace.
  // Defaults false: the homepage's preview grid and MarketplaceModal's
  // takeover grid are NOT the /marketplace route and must never hijack
  // the address bar just because they render the same component — see
  // useMarketplaceFilters' header comment for the full rationale.
  syncUrl?: boolean;
} = {}) {
  const filters = useMarketplaceFilters(initialFilters, syncUrl);
  const type = filters.typeFilter === "all" ? undefined : filters.typeFilter;
  const { listings, loading, loadingMore, error, exhausted, loadMore, reset } = useFeed({ pageSize: 24, type });
  const router = useRouter();
  const { show: showToast } = useSrToast();

  // Homepage preview grid only: search or any filter interaction should
  // land the visitor on the real, URL-driven /marketplace page instead
  // of re-filtering the fixed 12-item preview in place — the preview is
  // a taste of the catalog, not a second copy of the full browse/search
  // experience. Reuses buildMarketplacePath/formatMarketplacePath (the
  // same single source of truth /marketplace's own route segments and
  // useMarketplaceFilters use) so the URL landed on is byte-identical
  // to what typing the same search or picking the same filter directly
  // on /marketplace would produce — never a mismatched/noindexed one.
  // Not wired up when preview is false: /marketplace's own grid must
  // keep applying filters normally, not redirect to itself.
  function goToMarketplaceWith(next: {
    typeFilter?: typeof filters.typeFilter;
    templateFilter?: typeof filters.templateFilter;
    priceMin?: number;
    priceMax?: number | null;
    searchQuery?: string;
  }) {
    const path = buildMarketplacePath({
      type: next.typeFilter ?? filters.typeFilter,
      templateFilter: next.templateFilter ?? filters.templateFilter,
      priceMin: next.priceMin ?? filters.priceMin,
      priceMax: next.priceMax !== undefined ? next.priceMax : filters.priceMax,
      searchQuery: next.searchQuery ?? filters.searchQuery,
    });
    router.push(formatMarketplacePath(path));
  }

  // When a search query is active, the grid's data source switches from
  // the browse feed to real server-side search results (the FULL cached
  // catalog pool, not just whatever feed page happened to be loaded — see
  // useSearchResults' header comment). Template/price filters still apply
  // client-side on top of whichever source is active, same as before.
  const hasSearch = !!filters.searchQuery.trim();
  const search = useSearchResults(filters.searchQuery, type);
  const sourceListings = hasSearch ? search.listings : listings;
  const sourceLoading = hasSearch ? search.loading : loading;
  const sourceError = hasSearch ? search.error : error;
  const retry = hasSearch ? search.refetch : reset;
  const onOpen = (listing: Listing) => {
    if (!listing?.id) return;
    // Homepage preview grid only: swap this history entry for
    // /marketplace before pushing the listing page, so the back
    // button returns to the full marketplace instead of back to the
    // homepage preview it was actually clicked from. router.replace
    // is a client-side history swap (no reload/flash) — the visitor
    // never sees /marketplace render before the listing page takes
    // over. /marketplace's own grid (preview=false) is unaffected —
    // its own history entry is already /marketplace, nothing to swap.
    if (preview) router.replace("/marketplace");
    router.push(`/listing/${buildListingSlug(listing.title, listing.id)}`);
  };
  // Seller profile page now exists (app/seller/[id]/page.tsx) — cards
  // navigate straight there, same as onOpen does for listings. Signature
  // matches what every card (SiteCard/AppCard/GameCard) actually calls:
  // onOpenSeller(listing.ownerId, listing) — the listing param isn't
  // needed for a plain ownerId-based navigation, but keeping the second
  // parameter in the signature (even unused) is what makes this function
  // actually satisfy the (ownerId, listing) => void type every consumer
  // is typed against, instead of silently relying on JS's "extra args are
  // ignored" behavior to paper over a real type mismatch.
  const onOpenSeller = (ownerId: string | undefined, _listing?: Listing) => {
    if (ownerId) router.push(`/seller/${encodeURIComponent(ownerId)}`);
  };

  // Client-side portion of mpApplyAndRender: template/price filters apply
  // on top of whatever the active source (feed or search) already
  // returned. Search itself is no longer a client-side filter here (see
  // useSearchResults) — applyClientFilters' searchQuery branch becomes a
  // no-op in that path since the source listings are already the exact
  // search results, but harmlessly re-checking title/desc/type against
  // the same query it was fetched with is a cheap no-op, not a bug.
  const filteredListings = useMemo(() => {
    const applied = filters.applyClientFilters(sourceListings);
    return preview ? applied.slice(0, PREVIEW_COUNT) : applied;
  }, [filters.applyClientFilters, sourceListings, preview]);
  const listingById = useMemo(() => new Map(filteredListings.map((l) => [l.id, l])), [filteredListings]);

  // Ports mpRenderCards' ad/promo interleaving off the filtered set.
  const feedItems = useMemo(() => buildInterleavedFeed(filteredListings.map((l) => l.id)), [filteredListings]);

  // Infinite scroll — mirrors _setupSentinel's IntersectionObserver +
  // rootMargin: '200px' pattern exactly. Disabled while a search is
  // active: search results are a bounded top-N list (see
  // useSearchResults), not a paginated feed, so there's nothing to load
  // more of and firing loadMore() here would just re-trigger unrelated
  // feed pagination underneath the search results.
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (preview || hasSearch) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { rootMargin: "200px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore, preview, hasSearch]);

  // Preview mode no longer auto-navigates on scroll — that relied on an
  // IntersectionObserver "settle" trigger that was unreliable (fired
  // inconsistently depending on scroll speed/position) and felt like an
  // unexpected redirect. Replaced with a plain, explicit "View more
  // listings" CTA button below the preview grid — same destination
  // (onSeeFullMarketplace), just user-driven instead of automatic.

  // First-load state — same client-side fetch (useFeed) the old small
  // in-grid spinner covered. /marketplace's own grid (preview=false)
  // uses the shared full-screen skeleton, matching the loading treatment
  // used everywhere else in the app (route navigation via
  // app/loading.tsx). The homepage's preview grid sits below an already-
  // rendered Hero though, so a full-screen takeover there would blank
  // out content that's already on screen — it shows a row of in-grid
  // card skeletons (ListingCardSkeleton) in the same spot the real cards
  // will render instead.
  if (loading) {
    if (preview) {
      return (
        <div>
          <div className="mp-results">Fresh listings</div>
          <div className="mp-grid-wrap">
            <div className="mp-grid">
              {Array.from({ length: PREVIEW_COUNT }).map((_, i) => (
                <ListingCardSkeleton key={i} />
              ))}
            </div>
          </div>
        </div>
      );
    }
    return <SiteriftyLoader />;
  }

  return (
    <div>
      <MarketplaceFilterBar
        typeFilter={filters.typeFilter}
        onTypeChange={preview ? (v) => goToMarketplaceWith({ typeFilter: v }) : filters.setTypeFilter}
        templateFilter={filters.templateFilter}
        onTemplateChange={preview ? (v) => goToMarketplaceWith({ templateFilter: v }) : filters.setTemplateFilter}
        priceMin={filters.priceMin}
        priceMax={filters.priceMax}
        onPriceChange={
          preview
            ? (min, max) => goToMarketplaceWith({ priceMin: min, priceMax: max })
            : filters.setPriceRange
        }
        activeTags={filters.activeTags}
        searchListings={listings}
        searchQuery={filters.searchQuery}
        onSearchChange={preview ? (v) => goToMarketplaceWith({ searchQuery: v }) : filters.setSearchQuery}
        onOpenListing={onOpen}
        onOpenSeller={onOpenSeller}
        autoOpenSearch={autoOpenSearch}
        onExitTakeover={onExitTakeover}
      />

      <PremiumSellersStrip />

      <div className="mp-results">
        {preview ? (
          "Fresh listings"
        ) : (
          <>
            Showing <strong id="mpResultCount">{filteredListings.length}</strong>
          </>
        )}
      </div>

      <BoostedRow onOpen={onOpen} onOpenSeller={onOpenSeller} />

      <div className="mp-grid-wrap">
        <div className="mp-grid" id="mpGrid">
          {sourceError ? (
            <div className="mp-state" id="mpError" style={{ display: "flex" }}>
              <svg viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8" />
                <line x1="12" y1="8" x2="12" y2="12" stroke="currentColor" strokeWidth="1.8" />
                <circle cx="12" cy="16" r="0.5" fill="currentColor" stroke="none" />
              </svg>
              <div className="mp-state-title">Something went wrong</div>
              <div className="mp-state-desc">Could not load listings. Tap Try Again.</div>
              <button
                id="mpRetryBtn"
                style={{
                  marginTop: "0.9rem",
                  padding: "0.55rem 1.4rem",
                  background: "rgba(163,230,53,0.1)",
                  border: "1.5px solid rgba(163,230,53,0.4)",
                  borderRadius: "2rem",
                  color: "#a3e635",
                  fontSize: "0.82rem",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  letterSpacing: "0.02em",
                }}
                onClick={retry}
              >
                Try Again
              </button>
            </div>
          ) : hasSearch && sourceLoading ? (
            <div className="mp-state" style={{ display: "flex" }}>
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="rgba(255,255,255,0.35)"
                strokeWidth="2.2"
                style={{ animation: "mp-spin 1s linear infinite" }}
              >
                <circle cx="12" cy="12" r="10" strokeOpacity="0.2" />
                <path d="M12 2a10 10 0 0110 10" strokeLinecap="round" />
              </svg>
              <div className="mp-state-title">Searching…</div>
            </div>
          ) : !filteredListings.length ? (
            <div className="mp-state" id="mpEmpty" style={{ display: "flex" }}>
              <svg viewBox="0 0 24 24">
                <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.8" />
                <path d="M9 9l6 6M15 9l-6 6" stroke="currentColor" strokeWidth="1.8" />
              </svg>
              <div className="mp-state-title">No listings found</div>
              <div className="mp-state-desc">
                {hasSearch ? "Try a different search term." : "Try adjusting your search or filters."}
              </div>
              {hasSearch || filters.activeTags.length ? (
                <button
                  type="button"
                  className="mp-state-cta"
                  onClick={() => {
                    filters.activeTags.forEach((tag) => tag.clear());
                    if (hasSearch) filters.setSearchQuery("");
                    showToast("Filters cleared", "info");
                  }}
                  style={{
                    marginTop: 14,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 13,
                    fontWeight: 700,
                    color: "#0b0f0a",
                    background: "#a3e635",
                    border: "none",
                    borderRadius: 999,
                    padding: "9px 18px",
                    cursor: "pointer",
                  }}
                >
                  Clear filters &amp; search
                </button>
              ) : null}
            </div>
          ) : (
            feedItems.map((item) => {
              if (item.kind === "listing") {
                const listing = listingById.get(item.id);
                if (!listing) return null;
                return <ListingCard key={item.id} listing={listing} onOpen={onOpen} onOpenSeller={onOpenSeller} />;
              }
              if (item.kind === "ad") return <AdSlot key={item.id} kind={item.adKind} targetBreakpoint={item.targetBreakpoint} />;
              if (item.kind === "seller-promo") return <SellerPromoCard key={item.id} />;
              return <AiPromoCard key={item.id} />;
            })
          )}
        </div>

        {preview ? (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              padding: "28px 0 8px",
            }}
          >
            <button
              type="button"
              onClick={onSeeFullMarketplace}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: "0.01em",
                color: "#0b0f0a",
                background: "#a3e635",
                border: "none",
                borderRadius: 999,
                padding: "12px 24px",
                cursor: "pointer",
                boxShadow: "0 6px 18px rgba(163,230,53,0.25)",
                transition: "transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.filter = "brightness(1.06)";
                e.currentTarget.style.boxShadow = "0 8px 22px rgba(163,230,53,0.32)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.filter = "brightness(1)";
                e.currentTarget.style.boxShadow = "0 6px 18px rgba(163,230,53,0.25)";
              }}
            >
              View more listings
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6}>
                <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        ) : hasSearch ? null : (
          <>
            <div ref={sentinelRef} id="mpLoadSentinel" />
            {loadingMore ? (
              <div id="mpLoadMoreSpinner" style={{ display: "flex" }}>
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="rgba(255,255,255,0.35)"
                  strokeWidth="2.2"
                  style={{ animation: "mp-spin 1s linear infinite", flexShrink: 0 }}
                >
                  <circle cx="12" cy="12" r="10" strokeOpacity="0.2" />
                  <path d="M12 2a10 10 0 0110 10" strokeLinecap="round" />
                </svg>
                Loading more…
              </div>
            ) : exhausted && filteredListings.length ? (
              <div style={{ textAlign: "center", padding: "16px 0", opacity: 0.5, fontSize: 13 }}>
                You&apos;ve reached the end of the marketplace.
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
