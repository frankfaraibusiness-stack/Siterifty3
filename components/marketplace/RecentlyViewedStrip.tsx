"use client";

// "Recently viewed" strip — mirrors SimilarListingsStrip's horizontal
// snap-scroll layout, but reads from the local recently-viewed trail
// (lib/recentlyViewed.ts) instead of a server fetch, so it renders
// instantly with no loading state (client-only, no network round trip).
//
// Placed on the homepage, above the marketplace preview grid — the one
// spot a returning visitor lands on repeatedly, where "pick up where you
// left off" is most useful. Renders nothing at all (not even a loading
// skeleton) if there's no history yet, e.g. a first-time visitor —
// there's nothing "loading", the data is either there or it isn't.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getRecentlyViewed, entryToListing, clearRecentlyViewed, type RecentlyViewedEntry } from "@/lib/recentlyViewed";
import type { Listing } from "@/lib/listings";
import ListingCard from "@/components/marketplace/ListingCard";
import { buildListingSlug } from "@/lib/slug";

const MIN_TO_SHOW = 1;

export default function RecentlyViewedStrip() {
  const [entries, setEntries] = useState<RecentlyViewedEntry[] | null>(null);
  const router = useRouter();

  useEffect(() => {
    // Read after mount, not during render — localStorage isn't
    // available during SSR, and reading it in the initial render would
    // also mismatch between server and client output (hydration error).
    setEntries(getRecentlyViewed());
  }, []);

  const onOpen = (listing: Listing) => {
    if (listing?.id) router.push(`/listing/${buildListingSlug(listing.title, listing.id)}`);
  };
  const onOpenSeller = (ownerId: string | undefined) => {
    if (ownerId) router.push(`/seller/${encodeURIComponent(ownerId)}`);
  };

  if (!entries || entries.length < MIN_TO_SHOW) return null;

  return (
    <div style={{ maxWidth: 1240, margin: "0 auto", padding: "24px 20px 4px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <div
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: "rgba(255,255,255,0.85)",
            letterSpacing: "-0.01em",
          }}
        >
          Recently viewed
        </div>
        <button
          type="button"
          onClick={() => {
            clearRecentlyViewed();
            setEntries([]);
          }}
          style={{
            background: "none",
            border: "none",
            color: "rgba(255,255,255,0.4)",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            padding: "4px 2px",
          }}
        >
          Clear
        </button>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          gap: 16,
          overflowX: "auto",
          paddingBottom: 4,
          scrollSnapType: "x proximity",
        }}
      >
        {entries.map((entry) => (
          <div key={entry.id} style={{ flex: "0 0 260px", scrollSnapAlign: "start", display: "flex" }}>
            <ListingCard listing={entryToListing(entry)} onOpen={onOpen} onOpenSeller={onOpenSeller} />
          </div>
        ))}
      </div>
    </div>
  );
}
