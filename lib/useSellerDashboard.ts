"use client";

import { useCallback, useRef, useState } from "react";
import { auth } from "@/lib/firebase";

// Ports the API/state layer of Js/dashboard.js (index.html's Seller
// Dashboard modal). No mock data anywhere — every number comes from a
// real Firestore-backed endpoint (/api/listings' listing.mine and
// listing.daily-stats, /api/deal's list-my-deals). If a fetch fails,
// callers should show an empty/error state rather than fabricate
// numbers, same as the original's renderErrorState.

export type DashboardRange = "today" | "yesterday" | "this-week" | "this-month" | "last-90" | "lifetime";

const RANGE_TO_DAYS: Record<DashboardRange, number | null> = {
  today: 1,
  yesterday: 2,
  "this-week": 7,
  "this-month": 31,
  "last-90": 90,
  lifetime: null,
};

export function rangeToDays(range: DashboardRange): number | null {
  return RANGE_TO_DAYS[range] ?? 90;
}

export interface DashboardListing {
  id: string;
  title?: string;
  status?: string;
  type?: string;
  images?: string[];
  imageCover?: string;
  impressionCount?: number;
  viewCount?: number;
  successfulClickCount?: number;
  failedClickCount?: number;
  createdAt?: unknown;
  boostedUntil?: number | { toMillis?: () => number; seconds?: number };
}

export interface DashboardDeal {
  dealId: string;
  listingId: string | null;
  listingTitle: string;
  listingType: string;
  buyerName: string;
  buyerUid: string | null;
  amount: number;
  status: string;
  dealOutcome: string | null;
  createdAt: number | null;
  completedAt: number | null;
}

export interface DashboardDealsData {
  deals: DashboardDeal[];
  revenue: number;
  dealsCompleted: number;
}

export interface DailyStatsDay {
  date: string;
  impressionCount?: number;
  viewCount?: number;
}

async function getIdToken(): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken();
  } catch {
    return null;
  }
}

async function apiListings<T = any>(action: string, extra?: Record<string, unknown>): Promise<T> {
  const idToken = await getIdToken();
  if (!idToken) throw new Error("Not signed in");
  const res = await fetch("/api/listings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, idToken, ...extra }),
  });
  const out = await res.json();
  if (!res.ok || !out.ok) throw new Error(out?.error?.message || out?.error || "Request failed");
  return out.data;
}

// /api/deal responds flat ({ ok, deals, revenue, dealsCompleted }), not
// wrapped in `data` like /api/listings and /api/webhooks — matches the
// original's separate apiDeal() helper exactly.
async function apiDeal<T = any>(action: string, extra?: Record<string, unknown>): Promise<T> {
  const idToken = await getIdToken();
  if (!idToken) throw new Error("Not signed in");
  const res = await fetch("/api/deal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, idToken, ...extra }),
  });
  const out = await res.json();
  if (!res.ok || !out.ok) throw new Error(out?.error || "Request failed");
  return out as T;
}

export function useSellerDashboard() {
  const [listings, setListings] = useState<DashboardListing[] | null>(null);
  const [dealsData, setDealsData] = useState<DashboardDealsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listingsCacheRef = useRef<DashboardListing[] | null>(null);
  const dealsCacheRef = useRef<Record<string, DashboardDealsData>>({});
  const dailyStatsCacheRef = useRef<Record<string, DailyStatsDay[]>>({});

  const getMyListings = useCallback(async (force?: boolean) => {
    if (listingsCacheRef.current && !force) return listingsCacheRef.current;
    const data = await apiListings<{ listings: DashboardListing[] }>("listing.mine", {});
    listingsCacheRef.current = data.listings || [];
    return listingsCacheRef.current;
  }, []);

  const getMyDeals = useCallback(async (range: DashboardRange, force?: boolean) => {
    if (dealsCacheRef.current[range] && !force) return dealsCacheRef.current[range];
    const data = await apiDeal<{ deals: DashboardDeal[]; revenue: number; dealsCompleted: number }>(
      "list-my-deals",
      { range }
    );
    const shaped: DashboardDealsData = {
      deals: data.deals || [],
      revenue: data.revenue || 0,
      dealsCompleted: data.dealsCompleted || 0,
    };
    dealsCacheRef.current[range] = shaped;
    return shaped;
  }, []);

  const getListingDailyStats = useCallback(async (listingId: string, days: number, force?: boolean) => {
    const cacheKey = `${listingId}:${days}`;
    if (dailyStatsCacheRef.current[cacheKey] && !force) return dailyStatsCacheRef.current[cacheKey];
    const data = await apiListings<{ days: DailyStatsDay[] }>("listing.daily-stats", { listingId, days });
    dailyStatsCacheRef.current[cacheKey] = data.days || [];
    return dailyStatsCacheRef.current[cacheKey];
  }, []);

  // Aggregates real per-day impression/view buckets across a set of
  // listings into one combined daily series — one listing.daily-stats
  // call per listing, capped to the top 12 by traffic so this doesn't
  // fan out unboundedly for sellers with many listings.
  const getAggregateDailyStats = useCallback(
    async (listingsIn: DashboardListing[], days: number) => {
      const top = listingsIn
        .slice()
        .sort((a, b) => (b.impressionCount || 0) - (a.impressionCount || 0))
        .slice(0, 12);
      if (!top.length) return { labels: [] as string[], impressions: [] as number[], views: [] as number[] };

      const results = await Promise.all(top.map((l) => getListingDailyStats(l.id, days).catch(() => [])));

      const len = days;
      let labels: string[] = [];
      const impressions = new Array(len).fill(0);
      const views = new Array(len).fill(0);

      results.forEach((dayList) => {
        dayList.forEach((d, i) => {
          if (i < len) {
            impressions[i] += d.impressionCount || 0;
            views[i] += d.viewCount || 0;
          }
        });
        if (!labels.length && dayList.length === len) {
          labels = dayList.map((d) =>
            new Date(`${d.date}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric" })
          );
        }
      });

      return { labels, impressions, views };
    },
    [getListingDailyStats]
  );

  const load = useCallback(
    async (range: DashboardRange, force?: boolean) => {
      const user = auth.currentUser;
      if (!user) {
        setListings(null);
        setDealsData(null);
        setError("signed-out");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const [listingsResult, dealsResult] = await Promise.all([getMyListings(force), getMyDeals(range, force)]);
        setListings(listingsResult);
        setDealsData(dealsResult);
      } catch (err: any) {
        setError(err.message || "Something went wrong");
      } finally {
        setLoading(false);
      }
    },
    [getMyListings, getMyDeals]
  );

  const reset = useCallback(() => {
    listingsCacheRef.current = null;
    dealsCacheRef.current = {};
    dailyStatsCacheRef.current = {};
    setListings(null);
    setDealsData(null);
    setError(null);
  }, []);

  return { listings, dealsData, loading, error, load, reset, getAggregateDailyStats };
}
