"use client";

import { useEffect, useState } from "react";
import type { AuctionInfo } from "@/lib/listings";

export type AuctionPhase = "upcoming" | "live" | "ended";

export interface AuctionTimerState {
  phase: AuctionPhase;
  // Milliseconds until the relevant boundary: startTime while "upcoming",
  // endTime while "live", 0 once "ended". Never negative.
  msRemaining: number;
  // Pre-formatted "Xd Xh Xm Xs" (shortest non-zero unit first, dropping
  // leading zero units) — every countdown surface in the app (card badge,
  // bid modal) should render this string as-is rather than reformatting,
  // so all auction countdowns look identical.
  label: string;
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "0s";
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function computePhase(auction: AuctionInfo | undefined | null, now: number): AuctionTimerState {
  if (!auction) return { phase: "ended", msRemaining: 0, label: "0s" };

  const start = new Date(auction.startTime).getTime();
  const end = new Date(auction.endTime).getTime();

  // Server-side status ("ended") always wins over a client clock that may
  // be skewed — never show a live countdown for an auction the backend
  // has already closed, even if the local clock thinks endTime is in the
  // future.
  if (auction.status === "ended" || now >= end) {
    return { phase: "ended", msRemaining: 0, label: "Ended" };
  }
  if (now < start) {
    const remaining = start - now;
    return { phase: "upcoming", msRemaining: remaining, label: formatDuration(remaining) };
  }
  const remaining = end - now;
  return { phase: "live", msRemaining: remaining, label: formatDuration(remaining) };
}

// Ticks once per second while an auction is upcoming or live; stops
// ticking (no more re-renders) once ended, since there's nothing left to
// count down. Consumers should treat a transition into "ended" as a
// signal to re-fetch the listing — this hook only tracks the clock, it
// never itself calls the server to confirm the auction actually closed.
export function useAuctionTimer(auction: AuctionInfo | undefined | null): AuctionTimerState {
  const [state, setState] = useState<AuctionTimerState>(() => computePhase(auction, Date.now()));

  useEffect(() => {
    setState(computePhase(auction, Date.now()));
    if (!auction || auction.status === "ended") return;

    const tick = () => setState(computePhase(auction, Date.now()));
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
    // Re-run whenever the auction's own timestamps/status change (e.g. a
    // fresh Firestore snapshot came in) — a stale interval would keep
    // counting down against old start/end values otherwise.
  }, [auction?.startTime, auction?.endTime, auction?.status]);

  return state;
}
