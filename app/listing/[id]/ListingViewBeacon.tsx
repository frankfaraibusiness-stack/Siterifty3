"use client";

import { useEffect, useRef } from "react";
import { trackListing, type Listing } from "@/lib/listings";
import { recordRecentlyViewed } from "@/lib/recentlyViewed";

// Fires once per page open. Split out from page.tsx so the page itself
// can be a Server Component — this is the one piece of the old
// useEffect-based page that genuinely needs the browser (a per-view
// fetch beacon), everything else (the actual listing fetch) moved to
// server-side rendering in page.tsx / getListing.ts.
//
// Also records this open into the local recently-viewed trail
// (lib/recentlyViewed.ts) — same mount, same one-time guard, since both
// are "this listing was just opened" side effects. recordRecentlyViewed
// is synchronous localStorage only, so it's safe to fire alongside the
// network beacon without any extra coordination.
export default function ListingViewBeacon({ listing }: { listing: Listing }) {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    if (listing.id) trackListing("listing.view", listing.id);
    recordRecentlyViewed(listing);
  }, [listing]);

  // Scroll to the top of the new listing page on every open — including
  // navigating from one listing's own "Similar listings" strip straight
  // into another listing, which is a same-route-pattern navigation
  // (/listing/[id] -> /listing/[id]) that the browser/Next.js can
  // otherwise carry the previous page's scroll position into, landing
  // the new page scrolled down near the bottom instead of at the top.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [listing.id]);

  return null;
}
