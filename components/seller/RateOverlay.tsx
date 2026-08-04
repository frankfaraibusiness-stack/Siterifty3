"use client";

import { useState } from "react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/AuthContext";
import { useAuthModal } from "@/components/auth/AuthModalProvider";
import { useScrollLock } from "@/lib/useScrollLock";

// Ports the Rate Seller overlay (spRateOverlay) from marketplace.js:
// 1-5 star picker with hover preview, optional review text, one review
// per user per seller (doc id = reviewer's own uid), then a Firestore
// transaction recomputes the seller's running average/count.
export default function RateOverlay({
  sellerUid,
  sellerName,
  onClose,
  onSubmitted,
}: {
  sellerUid: string;
  sellerName: string;
  onClose: () => void;
  onSubmitted: (starValSubmitted: number, isNewReview: boolean) => void;
}) {
  // Mounted only while open (parent conditionally renders this overlay),
  // so the lock is unconditional here.
  useScrollLock(true);
  const { user, profile } = useAuth();
  const { openAuthModal } = useAuthModal();
  const [hoverVal, setHoverVal] = useState(0);
  const [starVal, setStarVal] = useState(0);
  const [review, setReview] = useState("");
  const [err, setErr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const displayVal = hoverVal || starVal;

  async function handleSubmit() {
    if (!user) {
      onClose();
      openAuthModal();
      return;
    }
    if (starVal < 1) return;
    if (sellerUid === user.uid) {
      setErr("You can't rate yourself.");
      return;
    }
    setSubmitting(true);
    setErr("");
    try {
      const { doc, setDoc, getDoc, runTransaction, serverTimestamp } = await import("firebase/firestore");
      const reviewId = user.uid; // one review per user per seller
      const reviewRef = doc(db, "users", sellerUid, "reviews", reviewId);
      const myName = profile?.username || user.displayName || user.email?.split("@")[0] || "Anonymous";

      const existing = await getDoc(reviewRef);
      const oldStars = existing.exists() ? (existing.data().stars as number) || 0 : 0;

      await setDoc(
        reviewRef,
        {
          reviewerId: user.uid,
          reviewerName: myName,
          reviewerPic: profile?.profilePic || "",
          stars: starVal,
          review: review.trim(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      let newAvg = starVal;
      let isNewReview = !existing.exists();
      await runTransaction(db, async (tx) => {
        const sellerRef = doc(db, "users", sellerUid);
        const sellerSnap = await tx.get(sellerRef);
        const sd: any = sellerSnap.data() || {};
        let cnt = typeof sd.ratingCount === "number" ? sd.ratingCount : 0;
        let total = (typeof sd.rating === "number" ? sd.rating : 0) * cnt;
        if (existing.exists()) {
          total = total - oldStars + starVal;
        } else {
          cnt = cnt + 1;
          total = total + starVal;
        }
        newAvg = cnt > 0 ? Math.round((total / cnt) * 10) / 10 : 0;
        tx.update(sellerRef, { rating: newAvg, ratingCount: cnt });
      });

      // Matches the original exactly: the stat display shows the star
      // value just submitted, not the recomputed average (see
      // marketplace.js right after this transaction — it sets
      // spStatRating.textContent to _rateStarVal.toFixed(1), not newAvg).
      onSubmitted(starVal, isNewReview);
      setSuccess(true);
      setTimeout(onClose, 1800);
    } catch {
      setErr("Failed to submit. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <div
      id="spRateOverlay"
      className="active"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div id="spRateBox">
        <div id="spRateTitle">Rate {sellerName}</div>
        <div id="spRateSubtitle">Your review helps the community.</div>
        <div id="spRateStarRow">
          {[1, 2, 3, 4, 5].map((v) => (
            <svg
              key={v}
              className={`sp-rate-star${v <= displayVal ? " lit" : ""}`}
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
              onMouseOver={() => setHoverVal(v)}
              onMouseLeave={() => setHoverVal(0)}
              onClick={() => setStarVal(v)}
            >
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          ))}
        </div>
        <textarea
          id="spRateTextarea"
          placeholder="Leave a review (optional)…"
          maxLength={300}
          rows={3}
          value={review}
          onChange={(e) => setReview(e.target.value)}
        />
        {err ? <div id="spRateErr" style={{ display: "block" }}>{err}</div> : <div id="spRateErr" />}
        {success && <div id="spRateSuccess" style={{ display: "block" }}>✓ Review submitted! Thank you.</div>}
        {!success && (
          <div id="spRateActions">
            <button id="spRateCancelBtn" onClick={onClose}>
              Cancel
            </button>
            <button id="spRateSubmitBtn" disabled={starVal < 1 || submitting} onClick={handleSubmit}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon
                  points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
                  fill="currentColor"
                  stroke="none"
                />
              </svg>
              {submitting ? "Submitting…" : "Submit Rating"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
