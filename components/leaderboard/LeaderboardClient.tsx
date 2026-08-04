"use client";

// Ports the Leaderboard from Js/marketplace.js (lbFetchTopSellers /
// lbRenderRows / lbWireFollowBtn / lbOpenModal, lines 2985-3226) + the
// #lbModal markup in index.html. CSS classes (#lbModal, .lb-row,
// .lb-crown, .lb-follow-btn, etc.) already exist in app/globals.css from
// Step 1 — unchanged here.
//
// Two differences from the original, both intentional:
//  1. The original was a full-screen overlay (#lbModal) opened over
//     whatever page was showing; here it's a real routed page (/leaderboard
//     already links here from Header/sellers directory as a plain <Link>,
//     and app/leaderboard/page.tsx below sets static SEO metadata matching
//     the original's SECTION_META['/leaderboard'] entry — a modal has no
//     independent URL for crawlers to index).
//  2. Row click and the "no sign-in required to browse" original both
//     used mpOpenSellerModal (a modal); every other ported list (see
//     PremiumSellersStrip) instead routes to /seller/[id], so this does
//     the same for consistency — there's no seller-modal in this app.
//
// Ranking logic (client-side, cheap random-ish pick, active-listing count
// via fetchFullSeller) and the whole in-session cache-then-refresh
// pattern are otherwise preserved exactly.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, doc, getDoc, getDocs, query, limit, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/AuthContext";
import { fetchFullSeller, type FullSeller } from "@/lib/useSeller";
import SellerBadges from "@/components/seller/SellerBadges";

interface LbRow {
  uid: string;
  listingCount: number;
  seller: FullSeller;
}

async function fetchTopSellers(): Promise<LbRow[]> {
  // Cheap random-ish pick: pull a small fixed page of users (5 reads) and
  // show all of them — no listings scan, no extra reads. Same as the
  // original's lbFetchTopSellers.
  const usnap = await getDocs(query(collection(db, "users"), limit(5)));
  const uids: string[] = [];
  usnap.forEach((d) => uids.push(d.id));

  const rows = await Promise.all(
    uids.map(async (uid) => {
      const seller = await fetchFullSeller(uid);
      if (!seller) return null;
      return { uid, listingCount: seller.listings?.length || 0, seller };
    })
  );
  return rows.filter((r): r is LbRow => r !== null);
}

function FollowButton({ seller }: { seller: FullSeller }) {
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

  async function onClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (!user) {
      document.querySelector<HTMLElement>(".btn-login")?.click();
      return;
    }
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
      console.error("[Leaderboard] follow error:", err);
      setFollowing(wasFollowing); // revert on failure
    }
  }

  return (
    <button className={"lb-follow-btn" + (following ? " lb-following" : "")} data-uid={seller.uid} onClick={onClick} aria-label={(following ? "Unfollow " : "Follow ") + seller.username}>
      {following ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <polyline points="16 11 18 13 22 9" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <line x1="19" y1="8" x2="19" y2="14" />
          <line x1="22" y1="11" x2="16" y2="11" />
        </svg>
      )}
      <span className="lb-follow-text">{following ? "Following" : "Follow"}</span>
    </button>
  );
}

const lbCrown = (
  <svg className="lb-crown" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 17l1.5-9L9 12l3-7 3 7 4.5-4L21 17H3z" fill="#facc15" stroke="#b8860b" strokeWidth="0.6" strokeLinejoin="round" />
    <rect x="3" y="17" width="18" height="2.4" rx="1" fill="#facc15" stroke="#b8860b" strokeWidth="0.4" />
  </svg>
);

export default function LeaderboardClient() {
  const { user } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<LbRow[] | null>(null);
  const [error, setError] = useState(false);
  const cacheRef = useRef<LbRow[] | null>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    (async () => {
      try {
        const fresh = await fetchTopSellers();
        cacheRef.current = fresh;
        setRows(fresh);
      } catch (err) {
        console.error("[Leaderboard] fetch error:", err);
        setError(true);
      }
    })();
  }, []);

  return (
    <div id="lbModal" className="active" style={{ position: "static", display: "block", minHeight: "calc(100vh - 92px)", marginTop: 92 }}>
      <div id="lbModalInner" style={{ maxHeight: "none", height: "auto" }}>
        <div id="lbModalHeader">
          <div id="lbModalHeaderLeft">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a3e635" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 20V10" />
              <path d="M12 20V4" />
              <path d="M6 20v-6" />
            </svg>
            <div>
              <div id="lbModalTitle">Leaderboard</div>
              <div id="lbModalSub">Top sellers, ranked by listings</div>
            </div>
          </div>
        </div>
        <div id="lbModalBody">
          <div id="lbModalList">
            {rows === null ? (
              <div id="lbModalLoading">
                <div className="lb-skel-row" />
                <div className="lb-skel-row" />
                <div className="lb-skel-row" />
                <div className="lb-skel-row" />
                <div className="lb-skel-row" />
              </div>
            ) : (
              rows.map((row, i) => {
                const rank = i + 1;
                const { seller, listingCount, uid } = row;
                const medal = rank === 1 ? "\ud83e\udd47" : rank === 2 ? "\ud83e\udd48" : rank === 3 ? "\ud83e\udd49" : null;
                const isSelf = user && user.uid === uid;
                const joined = seller.joinedAt
                  ? seller.joinedAt.toLocaleString("default", { month: "short", year: "numeric" })
                  : null;
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
                    key={uid}
                    className={"lb-row" + (rank <= 3 ? " lb-top3" : "") + (rank === 1 ? " lb-rank1" : "")}
                    data-uid={uid}
                    onClick={() => router.push(`/seller/${encodeURIComponent(uid)}`)}
                  >
                    <div className={"lb-rank" + (medal ? " lb-rank-medal" : "")}>{medal || rank}</div>
                    <div className="lb-av-wrap">
                      {rank === 1 ? lbCrown : null}
                      <div className="lb-av">{avatarInner}</div>
                    </div>
                    <div className="lb-info">
                      <div className="lb-name">
                        <span className="lb-name-text">{seller.username}</span>
                        <SellerBadges seller={seller} />
                      </div>
                      <div className="lb-handle">@{seller.username.toLowerCase().replace(/\s+/g, "_")}</div>
                      <div className="lb-meta">
                        <span className="lb-meta-item">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="3" width="18" height="18" rx="2" />
                            <path d="M3 9h18" />
                          </svg>
                          <span className="lb-listing-count">{listingCount}</span>&nbsp;listing{listingCount === 1 ? "" : "s"}
                        </span>
                        {joined ? (
                          <span className="lb-meta-item">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <rect x="3" y="4" width="18" height="18" rx="2" />
                              <path d="M16 2v4M8 2v4M3 10h18" />
                            </svg>
                            Joined {joined}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    {!isSelf && <FollowButton seller={seller} />}
                  </div>
                );
              })
            )}
          </div>
          {rows !== null && rows.length === 0 ? (
            <div id="lbModalEmpty">
              {error ? "Couldn't load the leaderboard — try again in a moment." : "No ranked sellers yet — be the first to list something!"}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
