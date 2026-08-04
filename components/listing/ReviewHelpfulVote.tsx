"use client";

import { useEffect, useState } from "react";
import { doc, getDoc, runTransaction, serverTimestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useAuthModal } from "@/components/auth/AuthModalProvider";

type VoteValue = "up" | "down" | null;

// Thumbs up/down on a single seller review ("Seller Reveals" list), so
// other users can see how many people found a review helpful vs not.
// Mirrors SaveButton's conventions: optimistic UI, a per-user vote doc
// to track state (here: users/{sellerUid}/reviews/{reviewId}/votes/{voterUid}),
// sign-in gate via useAuthModal. Unlike a simple save toggle, switching
// between up/down (or un-voting) has to move a count from one bucket to
// the other atomically, so this goes through a transaction rather than
// a bare increment() — two independent increments could otherwise race
// and leave the totals slightly off if the same user rapidly re-votes.
export default function ReviewHelpfulVote({
  sellerUid,
  reviewId,
  helpfulCount,
  notHelpfulCount,
}: {
  sellerUid: string;
  reviewId: string;
  helpfulCount: number;
  notHelpfulCount: number;
}) {
  const { openAuthModal } = useAuthModal();
  const [counts, setCounts] = useState({ up: helpfulCount, down: notHelpfulCount });
  const [myVote, setMyVote] = useState<VoteValue>(null);
  const [busy, setBusy] = useState(false);

  // Keep in sync if the parent list refetches with fresh counts.
  useEffect(() => {
    setCounts({ up: helpfulCount, down: notHelpfulCount });
  }, [helpfulCount, notHelpfulCount]);

  // Load whether the current viewer already voted on this review, so
  // the button reflects their prior choice instead of always starting
  // neutral (and so a repeat click correctly un-votes rather than
  // double-counting).
  useEffect(() => {
    let cancelled = false;
    const user = auth.currentUser;
    if (!user) return;
    (async () => {
      try {
        const voteSnap = await getDoc(doc(db, "users", sellerUid, "reviews", reviewId, "votes", user.uid));
        if (!cancelled && voteSnap.exists()) {
          setMyVote((voteSnap.data().value as VoteValue) || null);
        }
      } catch {
        // Non-critical — worst case the button just starts neutral.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sellerUid, reviewId]);

  async function handleVote(value: "up" | "down") {
    const user = auth.currentUser;
    if (!user) {
      openAuthModal();
      return;
    }
    if (busy) return;

    const prevVote = myVote;
    const nextVote: VoteValue = prevVote === value ? null : value; // clicking the active choice un-votes

    // Optimistic UI first.
    setBusy(true);
    setMyVote(nextVote);
    setCounts((c) => {
      const next = { ...c };
      if (prevVote === "up") next.up = Math.max(0, next.up - 1);
      if (prevVote === "down") next.down = Math.max(0, next.down - 1);
      if (nextVote === "up") next.up += 1;
      if (nextVote === "down") next.down += 1;
      return next;
    });

    try {
      const reviewRef = doc(db, "users", sellerUid, "reviews", reviewId);
      const voteRef = doc(db, "users", sellerUid, "reviews", reviewId, "votes", user.uid);

      await runTransaction(db, async (tx) => {
        const reviewSnap = await tx.get(reviewRef);
        const rd: any = reviewSnap.data() || {};
        let up = typeof rd.helpfulCount === "number" ? rd.helpfulCount : 0;
        let down = typeof rd.notHelpfulCount === "number" ? rd.notHelpfulCount : 0;

        if (prevVote === "up") up = Math.max(0, up - 1);
        if (prevVote === "down") down = Math.max(0, down - 1);
        if (nextVote === "up") up += 1;
        if (nextVote === "down") down += 1;

        tx.set(reviewRef, { helpfulCount: up, notHelpfulCount: down }, { merge: true });

        if (nextVote === null) {
          tx.set(voteRef, { value: null, updatedAt: serverTimestamp() }, { merge: true });
        } else {
          tx.set(voteRef, { value: nextVote, voterId: user.uid, updatedAt: serverTimestamp() }, { merge: true });
        }
      });
    } catch (err) {
      console.error("[ReviewHelpfulVote] vote failed", err);
      // Revert optimistic state on failure.
      setMyVote(prevVote);
      setCounts({ up: helpfulCount, down: notHelpfulCount });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="reveal-vote-row">
      <button
        type="button"
        className={`reveal-vote-btn${myVote === "up" ? " active" : ""}`}
        aria-label="Mark this review as helpful"
        aria-pressed={myVote === "up"}
        disabled={busy}
        onClick={() => handleVote("up")}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3z" />
          <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
        </svg>
        <span>{counts.up}</span>
      </button>
      <button
        type="button"
        className={`reveal-vote-btn${myVote === "down" ? " active" : ""}`}
        aria-label="Mark this review as not helpful"
        aria-pressed={myVote === "down"}
        disabled={busy}
        onClick={() => handleVote("down")}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3z" />
          <path d="M17 2h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3" />
        </svg>
        <span>{counts.down}</span>
      </button>
    </div>
  );
}
