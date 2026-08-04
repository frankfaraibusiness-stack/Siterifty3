// Ports _mpRenderBoostedRow from marketplace.js — a teaser section shown
// above the main grid, grouping currently-boosted listings by type
// (website/app/game never mixed, since the three card shapes differ
// structurally). A type's group only renders if it actually has boosted
// listings; if none exist at all across every type, the whole row is
// omitted. Reuses ListingCard so a boosted card here is pixel-identical
// to its counterpart in the main grid.
//
// IMPORTANT: this fetches its own data via fetchBoostedAds — it does NOT
// derive boosted listings by filtering whatever feed page happens to be
// loaded in the parent. That used to be the bug: the feed is served from a
// server-side pool cached for up to an hour (see _getTypePool in
// app/api/listings/_handler.js), so a seller who just paid for a boost (or
// edited a listing mid-boost) wouldn't see it reflected here until that
// cache happened to expire, no matter how many times they refreshed.
// listing.boosted-ads reads Firestore's `boostedAds` collection live, with
// no cache layer, specifically because this is paid placement — it must
// always be current.
import { useEffect, useState } from "react";
import type { Listing, ListingType } from "@/lib/listings";
import { fetchBoostedAds } from "@/lib/listings";
import ListingCard from "./ListingCard";

const FLAME_SVG = (
  <svg viewBox="0 0 24 24" fill="currentColor" width={14} height={14}>
    <path d="M12.5 1.5c.4 2.6-.6 4.3-2 5.8-1.7 1.8-3.5 3.6-3.5 6.7 0 3.6 2.9 6.5 6.5 6.5 3.4 0 6.2-2.6 6.5-5.9.3-3.4-1.6-5.9-3.3-7.8-.4-.5-1.1-.2-1 .4.4 2-.2 3.3-1.1 4.2-.2.2-.5.1-.6-.1-.7-1.6-.6-3.5.1-5.2.7-1.6.9-3.2-.6-4.6-.3-.3-.8-.2-.9.2-.2.7-.5 1.4-1.1 1.9-1.1 1-2.4 2.1-2.4 4 0 1.1.5 2 1.2 2.7.2.2 0 .6-.3.5-1.6-.5-2.7-2-2.5-3.7C7.7 4.9 9.6 2.9 12.5 1.5z" />
  </svg>
);

const FEED_TYPE_ORDER: ListingType[] = ["website", "app", "game", "3d"];
const TYPE_LABELS: Record<ListingType, string> = {
  website: "Boosted sites",
  app: "Boosted apps",
  game: "Boosted games",
  "3d": "Boosted 3D",
};

export default function BoostedRow({
  onOpen,
  onOpenSeller,
}: {
  onOpen: (listing: Listing) => void;
  onOpenSeller: (ownerId: string | undefined, listing: Listing) => void;
}) {
  const [listings, setListings] = useState<Listing[]>([]);

  useEffect(() => {
    let cancelled = false;
    // Fresh call every mount — deliberately not memoized/shared with the
    // feed fetch. See file header: this must never ride on the feed's
    // cached pool.
    fetchBoostedAds()
      .then((res) => {
        if (!cancelled) setListings(res.listings || []);
      })
      .catch((err) => {
        console.error("[BoostedRow] fetchBoostedAds failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const groups: Record<ListingType, Listing[]> = { website: [], app: [], game: [], "3d": [] };
  for (const listing of listings) {
    const t = (listing.type || "website") as ListingType;
    if (groups[t]) groups[t].push(listing);
  }

  const nonEmptyTypes = FEED_TYPE_ORDER.filter((t) => groups[t].length);
  if (!nonEmptyTypes.length) return null;

  return (
    <div id="mpBoostedRow">
      {nonEmptyTypes.map((t) => (
        <div className="mp-boosted-group" key={t}>
          <div className="mp-boosted-group-title">
            {FLAME_SVG}
            <span>{TYPE_LABELS[t]}</span>
          </div>
          <div className={`mp-boosted-grid mp-boosted-grid-${t}`}>
            {groups[t].map((listing) => (
              <ListingCard key={listing.id} listing={listing} onOpen={onOpen} onOpenSeller={onOpenSeller} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
