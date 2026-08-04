"use client";

// Ports the sellers directory modal (#sellersModal, svm* functions in
// Js/sellers-transfer.js, lines 565-806) as a real routed page instead of
// a global overlay — matching the app's convention of /dashboard, /settings,
// /myprofile all being real pages rather than modals-over-marketplace.
// (The original opened this as an overlay from anywhere via
// window.__openSellersModal() / closed via __closeSellersModal(), including
// a special-case sync back to '/marketplace' if the URL was already
// '/sellers' — that URL-as-modal-state approach doesn't apply here since
// /sellers is simply its own page now.)
//
// Loads up to 60 users ordered by createdAt desc (falling back to an
// unordered query if createdAt isn't present/indexed on all docs — same
// fallback as the original), excludes the viewer, and renders a
// search-filterable 2-column grid of seller cards with follow buttons.
// Clicking a card (outside the follow button) navigates to
// /seller/[uid] — the follow button itself reuses the exact
// follow/unfollow Firestore shape from PremiumSellersStrip.tsx's
// FollowButton (users/{uid}/followers/{me} + users/{me}/following/{uid}).
//
// The .svm-* CSS classes this page uses already exist in app/globals.css
// (ported from styles/siterifty.css in an earlier pass) — they were
// simply unused until now since nothing rendered #sellersModal's markup.
// No new CSS was needed.
//
// The "leaderboard" button in the original's header routes to
// window.__openLeaderboard() (another overlay); here it's a plain link to
// the real /leaderboard route, which already exists as its own page.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  collection,
  query,
  orderBy,
  limit as fsLimit,
  getDocs,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/AuthContext";

interface DirectoryUser {
  uid: string;
  username: string;
  profilePic: string;
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

function TrophyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 01-10 0V4z" />
      <path d="M7 5H4a1 1 0 00-1 1 5 5 0 004 4.9M17 5h3a1 1 0 011 1 5 5 0 01-4 4.9" />
    </svg>
  );
}

function CardSkeleton() {
  return (
    <div className="svm-profile-card svm-skel">
      <div className="svm-skel-block svm-skel-avatar" />
      <div className="svm-user-info" style={{ gap: 6 }}>
        <div className="svm-skel-block svm-skel-line" />
        <div className="svm-skel-block svm-skel-line sm" />
      </div>
      <div className="svm-skel-block svm-skel-pill" />
    </div>
  );
}

function FollowButton({ seller }: { seller: DirectoryUser }) {
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
    if (!user) return; // mirrors the original's requireAuth(() => {}) no-op guard
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
        await setDoc(followerRef, { uid: user.uid, username: myName, pic: profile?.profilePic || "", followedAt: serverTimestamp() });
        await setDoc(followingRef, { uid: seller.uid, username: seller.username, pic: seller.profilePic || "", followedAt: serverTimestamp() });
      }
    } catch (err) {
      console.error("Sellers directory follow error:", err);
      setFollowing(wasFollowing); // revert on failure
    }
  }

  return (
    <button className={`svm-follow-btn${following ? " following" : ""}`} data-uid={seller.uid} type="button" onClick={onClick}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
        {following ? <polyline points="20 6 9 17 4 12" /> : <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>}
      </svg>
      <span>{following ? "Following" : "Follow"}</span>
    </button>
  );
}

function SellerCard({ user, viewerUid }: { user: DirectoryUser; viewerUid?: string }) {
  const router = useRouter();
  const isSelf = viewerUid && viewerUid === user.uid;
  const [imgFailed, setImgFailed] = useState(false);
  const initial = (user.username || "?").trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="svm-profile-card" data-uid={user.uid} onClick={() => router.push(`/seller/${encodeURIComponent(user.username || user.uid)}`)}>
      <div className="svm-avatar">
        {user.profilePic && !imgFailed ? (
          <img src={user.profilePic} alt={user.username} loading="lazy" onError={() => setImgFailed(true)} />
        ) : (
          initial
        )}
      </div>
      <div className="svm-user-info">
        <div className="svm-user-name">{user.username}</div>
        <div className="svm-user-handle">@{user.username}</div>
      </div>
      {!isSelf && <FollowButton seller={user} />}
    </div>
  );
}

export default function SellersPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [users, setUsers] = useState<DirectoryUser[] | null>(null);
  const [search, setSearch] = useState("");
  const loadedRef = useRef(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    (async () => {
      try {
        let snap;
        try {
          snap = await getDocs(query(collection(db, "users"), orderBy("createdAt", "desc"), fsLimit(60)));
        } catch {
          // Fallback if createdAt isn't indexed / present on all docs —
          // same fallback as the original's svmLoadUsers.
          snap = await getDocs(query(collection(db, "users"), fsLimit(60)));
        }
        const list: DirectoryUser[] = snap.docs
          .map((d) => {
            const data = d.data() || {};
            return {
              uid: d.id,
              username: data.username || data.displayName || (data.email ? String(data.email).split("@")[0] : "Anonymous"),
              profilePic: data.profilePic || "",
            };
          })
          .filter((u) => u.uid !== user?.uid);
        setUsers(list);
      } catch (err) {
        console.error("[sellers directory] failed to load users", err);
        setUsers([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => setDebouncedSearch(search), 120);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [search]);

  const filtered = useMemo(() => {
    if (!users) return null;
    const term = debouncedSearch.toLowerCase().trim();
    return term ? users.filter((u) => u.username.toLowerCase().includes(term)) : users;
  }, [users, debouncedSearch]);

  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") setSearch("");
  }

  return (
    <div className="svm-feed-container" style={{ marginTop: 92 }}>
      <div className="svm-sticky-header">
        <div className="svm-header">
          <h2>Sellers</h2>
          <div className="svm-header-actions">
            <Link href="/leaderboard" className="svm-lb-btn" id="svmLeaderboardBtn">
              <TrophyIcon />
              <span>Leaderboard</span>
            </Link>
            <button onClick={() => router.push("/marketplace")} aria-label="Close">
              <CloseIcon />
            </button>
          </div>
        </div>
        <div className="svm-search-wrapper">
          <SearchIcon />
          <input
            id="svmSearchInput"
            type="text"
            placeholder="Search sellers…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={onSearchKeyDown}
          />
        </div>
        <div className="svm-stats-row">
          <span id="svmUserCount">{filtered ? filtered.length : 0}</span>
          <span>sellers on Siterifty</span>
        </div>
      </div>

      <div className="svm-profiles-grid" id="svmProfilesGrid">
        {filtered === null
          ? Array.from({ length: 8 }).map((_, i) => <CardSkeleton key={i} />)
          : filtered.length === 0
          ? <div className="svm-empty-message">No sellers match</div>
          : filtered.map((u) => <SellerCard key={u.uid} user={u} viewerUid={user?.uid} />)}
      </div>

      <div className="svm-footer-note">Showing the most recently joined sellers · search narrows the list above</div>
    </div>
  );
}
