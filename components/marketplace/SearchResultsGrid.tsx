"use client";

// Renders the initial ?q= search results the SSR /marketplace page fetched
// server-side (via app/marketplace/searchListings.ts → handleSearch),
// reusing the same ListingCard every other listing grid in the app uses.
// This is intentionally a thin client wrapper and not a data-fetching
// component itself — navigation (onOpen/onOpenSeller) needs the router,
// which only works client-side, but the actual search call already
// happened server-side before this ever rendered. Typing a *new* query
// after the page has loaded is handled separately by SearchOverlay /
// MarketplaceFilterBar (client-side fetchSearchResults), not this
// component — this only ever renders the query the page was loaded with.
//
// "Back to marketplace" clears the module-level filters cache (see
// clearMarketplaceFiltersCache in useMarketplaceFilters.ts), THEN does
// router.push("/marketplace") followed by router.refresh() — a real
// client-side navigation (no full-page reload, unlike a previous
// window.location.assign approach) that also forces the server
// component to re-run so it reliably lands on the plain no-query
// marketplace grid. Clearing the cache first is required: without it,
// the /marketplace grid's own filters hook (syncUrl=true) would
// rehydrate searchQuery from the stale cache on mount and immediately
// router.replace the URL right back to ?q=... — the bug where the query
// param appeared to "come back" after being cleared.
import { useRouter } from "next/navigation";
import type { Listing } from "@/lib/listings";
import ListingCard from "@/components/marketplace/ListingCard";
import { buildListingSlug } from "@/lib/slug";
import { useSrToast } from "@/components/system/SrToastProvider";
import { clearMarketplaceFiltersCache } from "@/lib/useMarketplaceFilters";

export default function SearchResultsGrid({
  listings,
  query,
}: {
  listings: Listing[];
  query: string;
}) {
  const router = useRouter();
  const { show: showToast } = useSrToast();
  const onOpen = (listing: Listing) => {
    if (listing?.id) router.push(`/listing/${buildListingSlug(listing.title, listing.id)}`);
  };
  const onOpenSeller = (ownerId: string | undefined, _listing?: Listing) => {
    if (ownerId) router.push(`/seller/${encodeURIComponent(ownerId)}`);
  };

  return (
    <div>
      <div className="mp-results" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <span>
          {listings.length ? (
            <>
              <strong>{listings.length}</strong> result{listings.length === 1 ? "" : "s"} for &ldquo;{query}&rdquo;
            </>
          ) : (
            <>No results for &ldquo;{query}&rdquo;</>
          )}
        </span>
        <button
          type="button"
          onClick={() => {
            // A plain router.push to the same /marketplace route segment
            // (even with ?q= dropped) doesn't reliably re-run this page's
            // server-side branch — Next can treat it as a navigation
            // within the same segment, so it looks like it "refreshes"
            // back onto this same search-results view. router.refresh()
            // forces the server component to actually re-run after the
            // push, so we land on the real no-query marketplace grid —
            // without the full browser reload window.location.assign
            // caused. clearMarketplaceFiltersCache() first is required —
            // see file header comment for why.
            clearMarketplaceFiltersCache();
            router.push("/marketplace");
            router.refresh();
          }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13,
            fontWeight: 600,
            color: "rgba(255,255,255,0.92)",
            background: "rgba(255,255,255,0.10)",
            border: "1px solid rgba(255,255,255,0.22)",
            borderRadius: 999,
            padding: "7px 14px",
            cursor: "pointer",
            whiteSpace: "nowrap",
            backdropFilter: "blur(14px) saturate(160%)",
            WebkitBackdropFilter: "blur(14px) saturate(160%)",
            boxShadow: "0 1px 0 rgba(255,255,255,0.12) inset, 0 4px 14px rgba(0,0,0,0.18)",
            transition: "background 0.15s ease, border-color 0.15s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.16)";
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.32)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.10)";
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.22)";
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}>
            <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to marketplace
        </button>
      </div>

      <div className="mp-grid-wrap">
        <div className="mp-grid">
          {listings.length ? (
            listings.map((listing) => (
              <ListingCard key={listing.id} listing={listing} onOpen={onOpen} onOpenSeller={onOpenSeller} />
            ))
          ) : (
            <div className="mp-state" style={{ display: "flex" }}>
              <svg viewBox="0 0 24 24">
                <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.8" />
                <path d="M9 9l6 6M15 9l-6 6" stroke="currentColor" strokeWidth="1.8" />
              </svg>
              <div className="mp-state-title">No listings found</div>
              <div className="mp-state-desc">Try a different search term.</div>
              <button
                type="button"
                onClick={() => {
                  clearMarketplaceFiltersCache();
                  router.push("/marketplace");
                  router.refresh();
                  showToast("Showing all listings", "info");
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
                Browse all listings
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
