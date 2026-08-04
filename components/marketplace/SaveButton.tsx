"use client";

import { useEffect, useState } from "react";
import { doc, setDoc, deleteDoc, updateDoc, increment, serverTimestamp, getDocs, collection } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useAuthModal } from "@/components/auth/AuthModalProvider";
import { useSrToast } from "@/components/system/SrToastProvider";
import type { Listing } from "@/lib/listings";

const HEART_PATH =
  "M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z";

// Per-session cache of which listing IDs the current user has saved —
// mirrors _mpSavedCache / _mpLoadSavedCache (module-scope Set, loaded once
// lazily on first use rather than eagerly on every page load).
const savedCache = new Set<string>();
let savedCacheLoaded = false;
let savedCacheLoadingPromise: Promise<Set<string>> | null = null;

async function loadSavedCache(): Promise<Set<string>> {
  if (savedCacheLoaded) return savedCache;
  if (savedCacheLoadingPromise) return savedCacheLoadingPromise;
  const user = auth.currentUser;
  if (!user) return savedCache;
  savedCacheLoadingPromise = (async () => {
    try {
      const snap = await getDocs(collection(db, "users", user.uid, "savedListings"));
      snap.forEach((d) => savedCache.add(d.id));
    } catch (err) {
      console.error("[SaveButton] failed to load saved cache", err);
    } finally {
      savedCacheLoaded = true;
    }
    return savedCache;
  })();
  return savedCacheLoadingPromise;
}

export default function SaveButton({ listing }: { listing: Listing }) {
  const [saved, setSaved] = useState(false);
  const { openAuthModal } = useAuthModal();
  const { show: showToast } = useSrToast();

  useEffect(() => {
    if (!listing.id) return;
    loadSavedCache().then((cache) => {
      if (cache.has(listing.id)) setSaved(true);
    });
  }, [listing.id]);

  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    const user = auth.currentUser;
    if (!user) {
      openAuthModal();
      return;
    }
    const listingId = listing.id;
    if (!listingId) return;

    await loadSavedCache();
    const alreadySaved = savedCache.has(listingId);

    // Optimistic UI update, same as the original.
    setSaved(!alreadySaved);
    if (alreadySaved) savedCache.delete(listingId);
    else savedCache.add(listingId);

    try {
      const userSaveRef = doc(db, "users", user.uid, "savedListings", listingId);
      const listingRef = doc(db, "listings", listingId);

      if (alreadySaved) {
        await deleteDoc(userSaveRef);
        await updateDoc(listingRef, { saves: increment(-1) });
      } else {
        // Snapshot a bit of the listing alongside the save so a future
        // Favorites tab can render a full card instantly without an
        // extra per-item listing fetch.
        await setDoc(userSaveRef, {
          listingId,
          savedAt: serverTimestamp(),
          title: listing.title || "Untitled",
          type: listing.type || "website",
          image: listing.images?.[2] || listing.imageCover || listing.images?.[0] || "",
          price: typeof listing.financials?.price === "number" ? listing.financials.price : null,
        });
        await updateDoc(listingRef, { saves: increment(1) });
      }
      showToast(alreadySaved ? "Removed from favorites" : "Saved to favorites", "success");
    } catch (err) {
      console.error("[SaveButton] toggle failed", err);
      // Revert optimistic state on failure.
      setSaved(alreadySaved);
      if (alreadySaved) savedCache.add(listingId);
      else savedCache.delete(listingId);
      showToast("Couldn't update favorites — try again", "error");
    }
  }

  return (
    <button
      type="button"
      className={`sr-icon-btn sr-save-btn${saved ? " sr-saved" : ""}`}
      aria-label="Save"
      onClick={handleClick}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="#777" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={HEART_PATH} />
      </svg>
    </button>
  );
}
