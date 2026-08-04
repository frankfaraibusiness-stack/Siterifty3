"use client";

import { useEffect, useState } from "react";

// Fetches GET /api/limits — the single source of truth for every
// business limit/price/fee/bound in the app (app/api/_lib/limits.js's
// `LIMITS` object, exposed publicly via `publicPayload()`). That route
// has existed and worked since Step 7 of the migration; it just had no
// client caller anywhere, so ~12 files each hardcoded their own copy of
// the same numbers as a fallback (documented individually in each file
// as "mirrors the original's own window.__limits fallback, since
// /api/limits isn't wired client-side yet"). This hook is that caller.
//
// FALLBACK is that same set of hardcoded numbers, kept as the initial
// state (not deleted) so every consumer renders correctly on first
// paint before the fetch resolves, and keeps working untouched if the
// fetch ever fails — same "degrade to the original's own fallback"
// behavior the original itself has for a not-yet-loaded
// `window.__limits`. Consumers should treat this hook's return value as
// the live data and never re-hardcode these numbers themselves again.
export interface LimitsPlan {
  name: string;
  price: number;
  color: string;
  tagline: string;
  saleFee: number;
  saleFeeDisplay: string;
  weeklyListings: number | null;
  unlimited: boolean;
  dailyEditsPerListing: number | null;
  description: string;
}

export interface LimitsPayload {
  plans: Record<"free" | "starter" | "growth" | "pro", LimitsPlan>;
  wallet: {
    depositMin: number;
    depositMax: number;
    withdrawMin: number;
    withdrawMax: number;
    withdrawFee: number;
    transferFee: number;
    transferMin: number;
    transferMax: number;
  };
  autoTopUp: { minThreshold: number; maxThreshold: number; minAmount: number; maxAmount: number };
  autoSend: { intervals: number[] };
  autoWithdraw: { minThreshold: number; maxThreshold: number; minKeepBalance: number; maxKeepBalance: number };
  boost: { plans: { days: number; price: number }[] };
  username: { minLength: number; maxLength: number; pattern: string; patternHint: string; changeCooldownMs: number };
  contactEmail: { maxChangesPerPeriod: number; periodMs: number };
  listing: {
    titleMinLength: number;
    titleMaxLength: number;
    descMinLength: number;
    descMaxLength: number;
    priceMin: number;
    priceMax: number;
    descPreviewWords: number;
  };
  marketplace: { priceCap: number };
  deals: { messageMinLength: number; pendingChatExpiryMs: number; outcomePollMs: number };
}

// Mirrors app/api/_lib/limits.js's LIMITS object exactly (same numbers,
// same shape as its publicPayload()) — this is not a second set of
// numbers invented for this hook, it's the same fallback every
// individual file already had, now centralized in one place instead of
// duplicated ~12 times.
export const FALLBACK_LIMITS: LimitsPayload = {
  plans: {
    free: {
      name: "Free", price: 0, color: "#71717a", tagline: "Get started for free",
      saleFee: 0.30, saleFeeDisplay: "30%", weeklyListings: 5, unlimited: false,
      dailyEditsPerListing: 10, description: "Free — 5 listings/week, basic features · 30% fee",
    },
    starter: {
      name: "Starter", price: 10, color: "#60a5fa", tagline: "For developers listing regularly",
      saleFee: 0.24, saleFeeDisplay: "24%", weeklyListings: 15, unlimited: false,
      dailyEditsPerListing: 25, description: "Starter — $10/mo · 15 listings/week · 24% fee",
    },
    growth: {
      name: "Growth", price: 20, color: "#a3e635", tagline: "For serious sellers scaling up",
      saleFee: 0.18, saleFeeDisplay: "18%", weeklyListings: 30, unlimited: false,
      dailyEditsPerListing: 50, description: "Growth — $20/mo · 30 listings/week · 18% fee",
    },
    pro: {
      name: "Pro", price: 30, color: "#d8b4fe", tagline: "For high-volume power sellers",
      saleFee: 0.12, saleFeeDisplay: "12%", weeklyListings: null, unlimited: true,
      dailyEditsPerListing: null, description: "Pro — $30/mo · Unlimited listings · 12% fee",
    },
  },
  wallet: {
    depositMin: 5, depositMax: 10000, withdrawMin: 10, withdrawMax: 10000,
    withdrawFee: 0.05, transferFee: 0.05, transferMin: 1, transferMax: 10000,
  },
  autoTopUp: { minThreshold: 1, maxThreshold: 5000, minAmount: 5, maxAmount: 10000 },
  autoSend: { intervals: [1, 3, 7, 14, 21, 30] },
  autoWithdraw: { minThreshold: 10, maxThreshold: 10000, minKeepBalance: 0, maxKeepBalance: 10000 },
  boost: {
    plans: [
      { days: 1, price: 2.99 },
      { days: 3, price: 6.99 },
      { days: 7, price: 12.99 },
      { days: 14, price: 19.99 },
      { days: 21, price: 27.99 },
      { days: 30, price: 34.99 },
    ],
  },
  username: {
    minLength: 5, maxLength: 15, pattern: "^[a-zA-Z0-9_.-]+$",
    patternHint: "Letters, numbers, underscores, hyphens, and dots only.",
    changeCooldownMs: 7 * 24 * 60 * 60 * 1000,
  },
  contactEmail: { maxChangesPerPeriod: 2, periodMs: 30 * 24 * 60 * 60 * 1000 },
  listing: {
    titleMinLength: 3, titleMaxLength: 99, descMinLength: 100, descMaxLength: 5000,
    priceMin: 0, priceMax: 10000, descPreviewWords: 50,
  },
  marketplace: { priceCap: 10000 },
  deals: { messageMinLength: 30, pendingChatExpiryMs: 7 * 24 * 60 * 60 * 1000, outcomePollMs: 6000 },
};

// Module-level cache + in-flight promise, shared across every component
// that calls useLimits() in the same page session — /api/limits is
// public (no auth), rarely changes, and the server already sends
// `Cache-Control: public, max-age=300`, so there's no reason for every
// one of the ~12 call sites to independently re-fetch it. First caller
// triggers the fetch; everyone else (mounted at the same time or later)
// gets the same resolved data.
let cachedLimits: LimitsPayload | null = null;
let inFlight: Promise<LimitsPayload> | null = null;

async function fetchLimits(): Promise<LimitsPayload> {
  if (cachedLimits) return cachedLimits;
  if (inFlight) return inFlight;

  inFlight = fetch("/api/limits")
    .then((res) => {
      if (!res.ok) throw new Error(`GET /api/limits failed: ${res.status}`);
      return res.json();
    })
    .then((data: LimitsPayload) => {
      cachedLimits = data;
      return data;
    })
    .catch((err) => {
      console.error("[useLimits] fetch failed, using fallback:", err.message);
      inFlight = null; // allow a retry on next call rather than caching the failure
      return FALLBACK_LIMITS;
    });

  return inFlight;
}

export function useLimits() {
  const [limits, setLimits] = useState<LimitsPayload>(cachedLimits || FALLBACK_LIMITS);
  const [loading, setLoading] = useState(!cachedLimits);

  useEffect(() => {
    let cancelled = false;
    if (cachedLimits) {
      setLimits(cachedLimits);
      setLoading(false);
      return;
    }
    fetchLimits().then((data) => {
      if (!cancelled) {
        setLimits(data);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { limits, loading };
}
