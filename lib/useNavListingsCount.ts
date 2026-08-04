"use client";

import { useEffect, useState } from "react";

// Ports window.__refreshNavListingsCount from firebase-init.js: a live
// getCountFromServer query, refetched every time the drawer opens (not
// cached) so the number is never stale. On failure, keeps the last known
// value rather than fabricating 0 — matches the original's own comment
// ("Don't fabricate a number on failure").
export function useNavListingsCount(uid: string | undefined | null, refreshKey: number) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!uid) {
      setCount(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { collection, query, where, getCountFromServer } = await import("firebase/firestore");
        const { db } = await import("@/lib/firebase");
        const snap = await getCountFromServer(query(collection(db, "listings"), where("ownerId", "==", uid)));
        if (!cancelled) setCount(snap.data().count);
      } catch {
        // Keep last known value (or null → renders as "0" the first time,
        // same as the original's countEl.textContent fallback).
      }
    })();
    return () => {
      cancelled = true;
    };
    // refreshKey intentionally bumps on every drawer open, mirroring the
    // original's re-fetch-on-open behavior rather than fetch-once caching.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, refreshKey]);

  return count;
}
