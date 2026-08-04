"use client";

// "Similar listings" strip for the listing detail page — up to a handful
// of other active, same-type listings ranked by price closeness, fetched
// via action: 'listing.similar' (reuses handleFeed's own cached type pool
// server-side, so this doesn't add a fresh Firestore query per page view).
//
// Reuses ListingCard directly (same component MarketplaceGrid/BoostedRow
// already use) so a card here is pixel-identical to its counterpart
// elsewhere in the app — no separate mini-card variant to maintain.
// Deliberately omits itself entirely (returns null) if fewer than 2
// results come back, rather than rendering an awkward near-empty row.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchSimilarListings, type Listing } from "@/lib/listings";
import { auth } from "@/lib/firebase";
import ListingCard from "@/components/marketplace/ListingCard";
import { buildListingSlug } from "@/lib/slug";

const MIN_TO_SHOW = 2;

export default function SimilarListingsStrip({ listingId }: { listingId: string }) {
  const [listings, setListings] = useState<Listing[] | null>(null);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    setListings(null);
    (async () => {
      try {
        const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : null;
        const res = await fetchSimilarListings({ listingId, idToken });
        if (!cancelled) setListings(res.listings);
      } catch {
        // Non-critical — the strip just doesn't render if the fetch fails,
        // same posture as any other optional/supplementary section.
        if (!cancelled) setListings([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [listingId]);

  const onOpen = (listing: Listing) => {
    if (listing?.id) router.push(`/listing/${buildListingSlug(listing.title, listing.id)}`);
  };
  const onOpenSeller = (ownerId: string | undefined) => {
    if (ownerId) router.push(`/seller/${encodeURIComponent(ownerId)}`);
  };

  if (listings !== null && listings.length < MIN_TO_SHOW) return null;

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 0 80px" }}>
      <div
        style={{
          fontSize: 15,
          fontWeight: 700,
          color: "rgba(255,255,255,0.85)",
          marginBottom: 16,
          letterSpacing: "-0.01em",
        }}
      >
        Similar listings
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          gap: 16,
          overflowX: "auto",
          paddingBottom: 4,
          // Snap scrolling — a light touch for a horizontal strip on
          // mobile, no extra library needed.
          scrollSnapType: "x proximity",
        }}
      >
        {listings === null &&
          Array.from({ length: MIN_TO_SHOW }).map((_, i) => (
            <div
              key={i}
              style={{
                flex: "0 0 260px",
                height: 240,
                borderRadius: 14,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            />
          ))}
        {listings?.map((listing) => (
          <div key={listing.id} style={{ flex: "0 0 260px", scrollSnapAlign: "start", display: "flex" }}>
            <ListingCard listing={listing} onOpen={onOpen} onOpenSeller={onOpenSeller} />
          </div>
        ))}
      </div>
    </div>
  );
}
