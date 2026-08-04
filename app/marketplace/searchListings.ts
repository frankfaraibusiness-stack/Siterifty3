// Server-only in-process caller into api/listings/_handler.js's
// handleSearch, for the SSR /marketplace?q=... page.
//
// _handler.js is a deliberately byte-for-byte port of the original
// api/listings.js (see its own header comment) and only exported the
// Node-style `handler` before handleSearch was added — handleSearch is now
// exported alongside it, additively, so this file (and any other future
// server-only caller) can invoke the search logic directly rather than
// POSTing to /api/listings from a Server Component, which would cost an
// extra, pointless HTTP hop within the same request/response cycle.
//
// Deliberately colocated with the page rather than folded into
// lib/listings.ts — that file's fetchSearchResults is the CLIENT-side
// caller (POSTs to /api/listings, used by SearchOverlay/MarketplaceFilterBar
// for search-as-you-type); this is the SSR-only path used once, at page
// render time, for the initial ?q= results.
//
// Note: the `server-only` npm package would normally guard this file at
// build time, but it isn't in package.json and this sandbox has no network
// access to verify `npm install` succeeds — see adminDb.ts's header
// comment for the same tradeoff. Relying instead on the fact that this is
// only ever imported from a Server Component (page.tsx below).
import { handleSearch } from "@/app/api/listings/_handler";
import { serializeTimestamps } from "@/lib/server/adminDb";
import type { Listing, ListingType } from "@/lib/listings";

export interface MarketplaceSearchResult {
  listings: Listing[];
  query: string;
}

// `idToken` is intentionally never passed here — the SSR page has no
// browser session to read a token from, and listing.search is a fully
// public action (same posture as listing.feed/listing.similar), so an
// anonymous in-process call is the correct, complete request.
export async function searchListingsServer(
  q: string,
  opts: { type?: ListingType; limit?: number } = {}
): Promise<MarketplaceSearchResult> {
  const { listings, query } = await handleSearch(
    { q, type: opts.type, limit: opts.limit },
    null
  );
  return {
    listings: (listings as any[]).map((l) => {
      const { id, ...rest } = l;
      return { id, ...(serializeTimestamps(rest) as Omit<Listing, "id">) };
    }),
    query,
  };
}
