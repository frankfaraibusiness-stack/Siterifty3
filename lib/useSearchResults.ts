"use client";

// Client-side counterpart to useFeed, for when a real search query is
// active. Previously MarketplaceGrid always rendered off useFeed's
// `listings` (the current infinite-scroll feed page) and applied
// searchQuery as just another client-side filter, in
// useMarketplaceFilters.applyClientFilters — same class of bug this whole
// change fixes elsewhere: search could only ever match whatever page of
// the feed had already been scrolled into memory.
//
// This hook instead calls fetchSearchResults (action: 'listing.search')
// directly, which runs server-side against the FULL cached catalog pool
// at zero extra Firestore cost. It intentionally does NOT paginate/scroll
// like useFeed — search results are a bounded, ranked top-N list (server
// default 20, capped 50), not an endless browse feed, so there's no
// loadMore/cursor here.
import { useEffect, useRef, useState } from "react";
import { fetchSearchResults, type Listing, type ListingType } from "@/lib/listings";
import { auth } from "@/lib/firebase";

interface UseSearchResultsState {
  listings: Listing[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useSearchResults(query: string, type?: ListingType): UseSearchResultsState {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  // Bumped by refetch() to force the effect below to re-run even when
  // query/type haven't changed — e.g. retrying after a network error.
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setListings([]);
      setLoading(false);
      setError(null);
      return;
    }

    const id = ++requestId.current;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : null;
        const res = await fetchSearchResults({ q: trimmed, type, idToken });
        // A slower, stale request finishing after a newer one must not
        // clobber the newer result — same guard useFeed's inFlight ref
        // gives single-flight protection for, adapted for out-of-order
        // async resolution instead of overlapping calls.
        if (id !== requestId.current) return;
        setListings(res.listings);
      } catch (err: any) {
        if (id !== requestId.current) return;
        setError(err?.message || "Search failed");
        setListings([]);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    })();
  }, [query, type, retryTick]);

  const refetch = () => setRetryTick((t) => t + 1);

  return { listings, loading, error, refetch };
}
