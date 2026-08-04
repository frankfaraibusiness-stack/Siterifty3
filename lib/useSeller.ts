"use client";

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

// Lightweight seller summary for a card's SellerStrip — just what's
// visually needed (avatar/name/stars), plus `plan` and `dealsCompleted`
// for SellerBadges since both are plain fields already sitting on the
// same user doc this hook already fetches, at no extra query cost.
// Deliberately still NOT a port of mpGetSeller's full fetch — this
// intentionally excludes `followerCount`, which needs a separate
// getCountFromServer subcollection query per seller; running that once
// per card across a full grid (dozens of cards) would be a real cost
// increase for a badge most sellers won't hit anyway (the 1000+
// follower verified-blue tier). Cards fall back to showing the
// plan/deal-tier badges only; the seller profile page still shows the
// complete badge set via fetchFullSeller below.
export interface SellerSummary {
  uid: string;
  username: string;
  profilePic: string;
  rating: number;
  ratingCount: number;
  plan?: string;
  dealsCompleted?: number;
}

const cache = new Map<string, SellerSummary>();

// ═══════════════════════════════════════════════════════════════════
// FULL SELLER PROFILE — ports mpGetSeller exactly, for the seller
// profile page. Heavier than the lightweight summary above: also
// fetches the seller's active listings (capped 20), follower count,
// lifetime deals-completed (with the get-seller-stats fallback for
// sellers who predate that field), bio/socials, and privacy settings.
// ═══════════════════════════════════════════════════════════════════

export interface SellerListing {
  id: string;
  type?: string;
  title?: string;
  images?: string[];
  imageCover?: string;
  financials?: { price?: number };
  createdAt?: unknown;
}

export interface FullSeller {
  uid: string;
  username: string;
  profilePic: string;
  plan: string;
  rating: number;
  ratingCount: number;
  bio: string;
  contactEmail: string;
  website: string;
  twitter: string;
  github: string;
  linkedin: string;
  joinedAt: Date | null;
  listings: SellerListing[];
  followerCount: number;
  dealsCompleted: number;
  profileVisibility: string;
  showEmail: boolean;
  showBio: boolean;
  showSocial: boolean;
}

export interface SellerDealStats {
  lifetimeDeals: number;
  lifetimeRevenue: number;
  last7DaysRevenue: number;
  byCategory: { website: number; app: number; game: number };
}

// Fetches the full seller profile fresh from Firestore. Deliberately NOT
// cached across calls (unlike the lightweight `cache` above) — the
// original does `delete _sellerCache[uid]` right before every
// mpOpenSellerModal call so the profile page's data is never stale from
// a previous session; here that just means: always fetch fresh on mount.
export async function fetchFullSeller(uid: string): Promise<FullSeller | null> {
  if (!uid) return null;
  try {
    const { doc, getDoc, collection, query, where, getDocs, limit, getCountFromServer } = await import(
      "firebase/firestore"
    );
    const snap = await getDoc(doc(db, "users", uid));
    // A missing user doc means this seller's account no longer exists
    // (deleted, or the id/username never matched one) — previously this
    // fell through with `d` as an empty object, so every field below
    // resolved to its fallback and the page rendered a fake "Anonymous"
    // seller with 0 listings instead of a real not-found state. Bail out
    // here instead so the caller's `!seller` / notFound branch fires.
    if (!snap.exists()) return null;
    const d: any = snap.data();

    // Seller's listings — deliberately no orderBy('createdAt') to avoid
    // requiring a composite index (ownerId + status + orderBy). Sorted
    // client-side instead, same as mpGetSeller.
    let sellerListings: SellerListing[] = [];
    try {
      const lq = query(
        collection(db, "listings"),
        where("ownerId", "==", uid),
        where("status", "==", "active"),
        limit(40)
      );
      const lsnap = await getDocs(lq);
      lsnap.forEach((ld) => sellerListings.push({ id: ld.id, ...(ld.data() as any) }));
      sellerListings.sort((a: any, b: any) => {
        const at = a.createdAt?.toMillis ? a.createdAt.toMillis() : a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bt = b.createdAt?.toMillis ? b.createdAt.toMillis() : b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bt - at;
      });
      sellerListings = sellerListings.slice(0, 20);
    } catch (err) {
      console.error("[fetchFullSeller] failed to load seller listings for", uid, err);
    }

    // Follower count
    let followerCount = 0;
    try {
      const fc = await getCountFromServer(collection(db, "users", uid, "followers"));
      followerCount = fc.data().count;
    } catch {
      /* ignore */
    }

    // Lifetime deals-completed — read directly off the user doc if
    // present (deal.js bumps it atomically on every completed deal);
    // fall back to a one-time /api/deal get-seller-stats aggregation
    // for sellers who predate that field.
    let dealsCompleted = typeof d.dealsCompleted === "number" ? d.dealsCompleted : null;
    if (dealsCompleted === null) {
      dealsCompleted = 0;
      try {
        const statsResp = await fetch("/api/deal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "get-seller-stats", sellerUid: uid }),
        });
        const statsOut = await statsResp.json();
        if (statsResp.ok && statsOut.ok) dealsCompleted = statsOut.lifetimeDeals || 0;
      } catch {
        /* ignore */
      }
    }

    const joinedAt = d.createdAt ? (d.createdAt.toDate ? d.createdAt.toDate() : new Date(d.createdAt)) : null;

    const seller: FullSeller = {
      uid,
      username: d.username || d.displayName || d.email?.split("@")[0] || "Anonymous",
      profilePic: d.profilePic || "",
      plan: d.plan || "free",
      rating: typeof d.rating === "number" ? d.rating : 0,
      ratingCount: typeof d.ratingCount === "number" ? d.ratingCount : 0,
      bio: d.bio || "",
      contactEmail: d.contactEmail || "",
      website: d.website || d.websiteUrl || "",
      twitter: d.twitter || d.twitterUrl || "",
      github: d.github || d.githubUrl || "",
      linkedin: d.linkedin || d.linkedinUrl || "",
      joinedAt,
      listings: sellerListings,
      followerCount,
      dealsCompleted,
      profileVisibility: d.profileVisibility || "public",
      showEmail: d.showEmail === true,
      showBio: d.showBio !== false,
      showSocial: d.showSocial !== false,
    };
    return seller;
  } catch {
    return null;
  }
}

// Fetches deal stats for the seller-details overlay (lifetime/7-day
// revenue, category split). Separate call from fetchFullSeller since
// the original loads it after the main profile paints, not blocking it.
export async function fetchSellerDealStats(uid: string): Promise<SellerDealStats | null> {
  try {
    const resp = await fetch("/api/deal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "get-seller-stats", sellerUid: uid }),
    });
    const out = await resp.json();
    if (!resp.ok || !out.ok) throw new Error(out.error || "Could not load seller stats");
    return {
      lifetimeDeals: out.lifetimeDeals ?? 0,
      lifetimeRevenue: out.lifetimeRevenue ?? 0,
      last7DaysRevenue: out.last7DaysRevenue ?? 0,
      byCategory: out.byCategory || { website: 0, app: 0, game: 0 },
    };
  } catch (err) {
    console.error("[fetchSellerDealStats] failed", err);
    return null;
  }
}

export function useSeller(uid: string | undefined | null): SellerSummary | null {
  const [seller, setSeller] = useState<SellerSummary | null>(uid ? cache.get(uid) || null : null);

  useEffect(() => {
    if (!uid) return;
    if (cache.has(uid)) {
      setSeller(cache.get(uid)!);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "users", uid));
        const d = snap.exists() ? snap.data() : ({} as any);
        const summary: SellerSummary = {
          uid,
          username: d.username || d.displayName || d.email?.split("@")[0] || "Anonymous",
          profilePic: d.profilePic || "",
          rating: typeof d.rating === "number" ? d.rating : 0,
          ratingCount: typeof d.ratingCount === "number" ? d.ratingCount : 0,
          plan: d.plan || "free",
          dealsCompleted: typeof d.dealsCompleted === "number" ? d.dealsCompleted : 0,
        };
        cache.set(uid, summary);
        if (!cancelled) setSeller(summary);
      } catch (err) {
        console.error("[useSeller] failed to load", uid, err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid]);

  return seller;
}
