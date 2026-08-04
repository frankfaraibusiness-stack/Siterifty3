"use client";

import { useEffect, useState } from "react";
import { collection, query, orderBy, limit, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";

// Ports the "Load seller reviews" block from marketplace.js's mpOpenModal
// (index.html lines ~2263-2345) — star ratings + written reviews other
// users left for a seller. These are seller-wide, not scoped to any one
// listing: they live at users/{sellerUid}/reviews/{reviewerUid}, written
// by the "Rate this seller" overlay on the seller profile page. Shown in
// SellerReveals below the seller row on a listing's detail page.
export interface SellerReview {
  id: string;
  reviewerName: string;
  reviewerPic: string;
  stars: number;
  review: string;
  updatedAt: Date | null;
  helpfulCount: number;
  notHelpfulCount: number;
}

interface ReviewsState {
  reviews: SellerReview[] | null;
  loading: boolean;
  error: string | null;
}

export function useSellerReviews(sellerUid: string | undefined): ReviewsState {
  const [reviews, setReviews] = useState<SellerReview[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sellerUid) {
      setReviews([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const q = query(
          collection(db, "users", sellerUid, "reviews"),
          orderBy("updatedAt", "desc"),
          limit(20)
        );
        const snap = await getDocs(q);
        if (cancelled) return;
        const rows: SellerReview[] = snap.docs.map((d) => {
          const rev = d.data() as any;
          const updatedAt =
            rev.updatedAt && typeof rev.updatedAt.toDate === "function"
              ? rev.updatedAt.toDate()
              : rev.updatedAt
              ? new Date(rev.updatedAt)
              : null;
          return {
            id: d.id,
            reviewerName: rev.reviewerName || "Someone",
            reviewerPic: rev.reviewerPic || "",
            stars: Math.max(0, Math.min(5, Math.round(rev.stars || 0))),
            review: rev.review || "",
            updatedAt,
            helpfulCount: Math.max(0, rev.helpfulCount || 0),
            notHelpfulCount: Math.max(0, rev.notHelpfulCount || 0),
          };
        });
        setReviews(rows);
      } catch (err) {
        if (cancelled) return;
        // Same distinction the original makes: a real failure (e.g. a
        // missing Firestore index for the orderBy query) shouldn't look
        // identical to the legit "No reviews yet" empty state.
        console.error("[reveals] failed to load reviews for seller", sellerUid, err);
        setError((err as Error)?.message || "Could not load reviews");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sellerUid]);

  return { reviews, loading, error };
}

// Formats a review timestamp the same way as the original's inline
// timeStr logic — "Just now" / "5m ago" / "3h ago" / "2d ago" / calendar
// date once it's more than a week old.
export function formatReviewTime(date: Date | null): string {
  if (!date) return "";
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
