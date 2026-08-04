"use client";

// Ports the "Premium sellers" strip (mpLoadTopSellers / mpRenderTopSellers /
// mpWireTopSellerFollowBtn in marketplace.js) — horizontally scrollable row
// of paid-plan (Starter/Growth/Pro) sellers shown above the marketplace
// grid. Server-side filtering (planIndex lookup) already lives in
// handlePremiumSellers — this only renders + wires follow buttons.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, getDoc, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/AuthContext";
import { fetchPremiumSellers, type PremiumSeller } from "@/lib/premiumSellers";
import SellerBadges from "@/components/seller/SellerBadges";

function FollowButton({ seller }: { seller: PremiumSeller }) {
  const { user, profile } = useAuth();
  const [following, setFollowing] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user) {
        setChecked(true);
        return;
      }
      try {
        const snap = await getDoc(doc(db, "users", seller.uid, "followers", user.uid));
        if (!cancelled) setFollowing(snap.exists());
      } catch {
        // ignore — leave as not-following
      } finally {
        if (!cancelled) setChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, seller.uid]);

  if (!checked) return null;

  const onClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) return; // mirrors original's requireAuth(() => {}) no-op guard
    const wasFollowing = following;
    setFollowing(!wasFollowing); // optimistic
    try {
      const followerRef = doc(db, "users", seller.uid, "followers", user.uid);
      const followingRef = doc(db, "users", user.uid, "following", seller.uid);
      if (wasFollowing) {
        await deleteDoc(followerRef);
        await deleteDoc(followingRef);
      } else {
        const myName = profile?.username || user.displayName || user.email?.split("@")[0] || "Someone";
        await setDoc(followerRef, {
          uid: user.uid,
          username: myName,
          pic: profile?.profilePic || "",
          followedAt: serverTimestamp(),
        });
        await setDoc(followingRef, {
          uid: seller.uid,
          username: seller.username,
          pic: seller.profilePic || "",
          followedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      console.error("[PremiumSellersStrip] follow error:", err);
      setFollowing(wasFollowing); // revert on failure
    }
  };

  return (
    <button
      className={`mp-ts-follow-btn${following ? " mp-ts-following" : ""}`}
      data-uid={seller.uid}
      onClick={onClick}
    >
      {following ? "Following" : "Follow"}
    </button>
  );
}

export default function PremiumSellersStrip() {
  const { user } = useAuth();
  const router = useRouter();
  const [sellers, setSellers] = useState<PremiumSeller[] | null>(null);
  const [empty, setEmpty] = useState(false);
  const seedRef = useRef<number | null>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    (async () => {
      try {
        const res = await fetchPremiumSellers(seedRef.current);
        seedRef.current = res.seed;
        if (!res.sellers.length) {
          setEmpty(true);
          return;
        }
        setSellers(res.sellers);
      } catch (err) {
        console.error("[PremiumSellersStrip] load failed", err);
        setEmpty(true);
      }
    })();
  }, []);

  if (empty) return null;

  return (
    <div id="mpTopSellersSection">
      <div className="mp-ts-heading">
        <svg viewBox="0 0 24 24" fill="currentColor" width={15} height={15}>
          <path d="M12 2.5l2.6 5.3 5.9.86-4.25 4.14 1 5.88L12 16.1l-5.25 2.58 1-5.88L3.5 8.66l5.9-.86z" />
        </svg>
        <span>Premium sellers</span>
      </div>
      <div id="mpTopSellersTrack">
        {sellers === null
          ? [0, 1, 2, 3].map((i) => <div key={i} className="mp-ts-card mp-ts-skel" />)
          : sellers.map((seller) => {
              const isSelf = user && user.uid === seller.uid;
              const avatarInner = seller.profilePic ? (
                <img
                  src={seller.profilePic}
                  alt={seller.username}
                  onError={(e) => {
                    const el = e.currentTarget;
                    el.style.display = "none";
                    if (el.parentElement) el.parentElement.textContent = seller.username.charAt(0).toUpperCase();
                  }}
                />
              ) : (
                seller.username.charAt(0).toUpperCase()
              );
              return (
                <div
                  key={seller.uid}
                  className="mp-ts-card"
                  data-uid={seller.uid}
                  onClick={() => router.push(`/seller/${encodeURIComponent(seller.username || seller.uid)}`)}
                >
                  <div className="mp-ts-av">{avatarInner}</div>
                  <div className="mp-ts-name">
                    <span className="mp-ts-name-text">{seller.username}</span>
                    <SellerBadges seller={seller} />
                  </div>
                  <div className="mp-ts-meta">
                    {seller.listingCount} listing{seller.listingCount === 1 ? "" : "s"}
                  </div>
                  {!isSelf && <FollowButton seller={seller} />}
                </div>
              );
            })}
      </div>
    </div>
  );
}
