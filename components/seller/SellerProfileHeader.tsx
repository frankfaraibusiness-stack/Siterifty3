"use client";

import { useEffect, useRef, useState } from "react";
import { doc, getDoc, setDoc, deleteDoc, serverTimestamp, addDoc, collection } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/AuthContext";
import { useAuthModal } from "@/components/auth/AuthModalProvider";
import { useToast } from "@/lib/useToast";
import { useConfirm } from "@/lib/useConfirm";
import Stars from "@/components/marketplace/Stars";
import SellerBadges from "./SellerBadges";
import type { FullSeller } from "@/lib/useSeller";

const SOCIAL_DEFS = [
  {
    key: "website" as const,
    label: "Website",
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20" />
      </svg>
    ),
  },
  {
    key: "twitter" as const,
    label: "Twitter",
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
  },
  {
    key: "github" as const,
    label: "GitHub",
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
      </svg>
    ),
  },
  {
    key: "linkedin" as const,
    label: "LinkedIn",
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
      </svg>
    ),
  },
];

export default function SellerProfileHeader({
  seller,
  onSellerChange,
  onOpenDetails,
  onOpenRate,
  onOpenDonate,
}: {
  seller: FullSeller;
  onSellerChange: (updater: (s: FullSeller) => FullSeller) => void;
  onOpenDetails: () => void;
  onOpenRate: () => void;
  onOpenDonate: () => void;
}) {
  const { user, profile } = useAuth();
  const { openAuthModal } = useAuthModal();
  const { toast, ToastHost } = useToast();
  const { confirm, alert, ConfirmHost } = useConfirm();
  const isOwnProfile = !!user && user.uid === seller.uid;

  const [isFollowing, setIsFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [bioOverflowing, setBioOverflowing] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportDone, setReportDone] = useState(false);
  const bioTextRef = useRef<HTMLDivElement>(null);

  // Check follow state on mount / when the viewer changes.
  useEffect(() => {
    let cancelled = false;
    if (!user || user.uid === seller.uid) {
      setIsFollowing(false);
      return;
    }
    (async () => {
      try {
        const fSnap = await getDoc(doc(db, "users", seller.uid, "followers", user.uid));
        if (!cancelled) setIsFollowing(fSnap.exists());
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, seller.uid]);

  // Only show "Read more" if the bio actually overflows its 3-line clamp.
  useEffect(() => {
    const el = bioTextRef.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      setBioOverflowing(el.scrollHeight > el.clientHeight + 1);
    });
    return () => cancelAnimationFrame(raf);
  }, [seller.bio]);

  async function handleFollowToggle() {
    if (!user) {
      openAuthModal();
      return;
    }
    setFollowBusy(true);
    try {
      const followerRef = doc(db, "users", seller.uid, "followers", user.uid);
      const followingRef = doc(db, "users", user.uid, "following", seller.uid);
      if (isFollowing) {
        await deleteDoc(followerRef);
        await deleteDoc(followingRef);
        onSellerChange((s) => ({ ...s, followerCount: Math.max(0, s.followerCount - 1) }));
        setIsFollowing(false);
      } else {
        const myName = profile?.username || user.displayName || user.email?.split("@")[0] || "Someone";
        await setDoc(followerRef, { uid: user.uid, username: myName, pic: profile?.profilePic || "", followedAt: serverTimestamp() });
        await setDoc(followingRef, { uid: seller.uid, username: seller.username, pic: seller.profilePic || "", followedAt: serverTimestamp() });
        onSellerChange((s) => ({ ...s, followerCount: s.followerCount + 1 }));
        setIsFollowing(true);
      }
    } catch (e) {
      console.error("Follow error:", e);
    } finally {
      setFollowBusy(false);
    }
  }

  async function handleReport() {
    if (!user) {
      openAuthModal();
      return;
    }
    const confirmed = await confirm({
      theme: "report",
      title: "Report Seller",
      msg: `Report ${seller.username}'s profile to our team? Our moderators will review it and take action if needed. False reports may result in account restrictions.`,
      confirmText: "Report",
    });
    if (!confirmed) return;

    setReportBusy(true);
    try {
      const reportRef = await addDoc(collection(db, "reports"), {
        reporterUid: user.uid,
        reportedUid: seller.uid,
        reason: "seller_profile_report",
        status: "open",
        createdAt: serverTimestamp(),
      });
      // Fire-and-forget AI triage — mirrors the original: the report is
      // already filed regardless of whether triage succeeds.
      (async () => {
        try {
          const idToken = await user.getIdToken();
          await fetch("/api/aistudio", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + idToken },
            body: JSON.stringify({
              action: "triage-report",
              reportId: reportRef.id,
              evidence: { reporterUid: user.uid, reportedUid: seller.uid, reason: "seller_profile_report" },
            }),
          });
        } catch (err) {
          console.warn("AI triage call failed (report still filed, will need manual review):", err);
        }
      })();
    } catch (err) {
      console.warn("seller report write", err);
    } finally {
      setReportBusy(false);
      setReportDone(true);
    }
    await alert({
      theme: "report",
      title: "Report Submitted",
      msg: "Our team will review this within 24 hours. Thank you for keeping Siterifty safe.",
    });
  }

  const initial = seller.username.charAt(0).toUpperCase();
  const handle = "@" + seller.username.toLowerCase().replace(/\s+/g, "_");
  const hasBio = seller.bio && (seller.showBio || isOwnProfile);
  const followerDisplay = seller.followerCount > 999 ? (seller.followerCount / 1000).toFixed(1) + "k" : String(seller.followerCount);

  return (
    <>
      <div id="spModalCover">
        <img src="https://cdn.phototourl.com/member/2026-07-19-60b20514-ac7c-4ae9-b26f-c7d5d71ce0a2.jpg" alt="" />
      </div>

      <div id="spModalMain">
        <div id="spModalAvatarRow">
          <div id="spModalAv">
            {seller.profilePic ? (
              <img
                src={seller.profilePic}
                alt={seller.username}
                onError={(e) => {
                  (e.currentTarget.parentElement as HTMLElement).textContent = initial;
                }}
              />
            ) : (
              initial
            )}
          </div>
        </div>

        <div id="spModalNameInfo">
          <div id="spModalNameLine">
            <span id="spModalName">
              {seller.username} <SellerBadges seller={seller} />
            </span>
            <span id="spModalHandle">{handle}</span>
          </div>

          <div id="spModalBio">
            <div id="spModalBioText" ref={bioTextRef} style={hasBio ? undefined : { color: "#555" }}>
              {hasBio ? seller.bio : "This seller hasn't added a bio yet."}
            </div>
            {(hasBio ? bioOverflowing : true) && (
              <button id="spModalBioMore" type="button" onClick={onOpenDetails}>
                Read more
              </button>
            )}
          </div>

          <div id="spModalActions">
            {!isOwnProfile && (
              <button
                className={`sp-action-btn${isFollowing ? " sp-follow-active" : ""}`}
                id="spFollowBtn"
                disabled={followBusy}
                onClick={handleFollowToggle}
              >
                {isFollowing ? (
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
                {isFollowing ? "Following" : "Follow"}
                <span id="spFollowerCount">{followerDisplay}</span>
              </button>
            )}

            {!isOwnProfile && (
              <button className="sp-action-btn sp-donate-btn" id="spDonateBtn" onClick={() => (user ? onOpenDonate() : openAuthModal())}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
                </svg>
                Donate
              </button>
            )}

            {!isOwnProfile && (
              <button className="sp-action-btn" id="spRateBtn" onClick={() => (user ? onOpenRate() : openAuthModal())}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
                Rate
              </button>
            )}

            {seller.ratingCount > 0 && (
              <span id="spModalStars">
                <span className="sp-stars-icons" id="spModalStarsIcons">
                  <Stars rating={seller.rating} count={seller.ratingCount} />
                </span>
              </span>
            )}

            {!isOwnProfile && !reportDone && (
              <button
                className="sp-action-btn sp-report-btn"
                id="spReportSellerBtn"
                aria-label="Report this seller"
                title="Report seller"
                disabled={reportBusy}
                onClick={() => (user ? handleReport() : openAuthModal())}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                  <line x1="4" y1="22" x2="4" y2="15" />
                </svg>
                Report
              </button>
            )}
          </div>

          <ConfirmHost />
        </div>

        <div id="spModalStats">
          <div className="sp-stat">
            <div className="sp-stat-val" id="spStatListings">
              {seller.listings.length}
            </div>
            <div className="sp-stat-lbl">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                <line x1="7" y1="7" x2="7.01" y2="7" />
              </svg>
              Listings
            </div>
          </div>
          <div className="sp-stat">
            <div className="sp-stat-val" id="spStatRating">
              {seller.ratingCount > 0 ? seller.rating.toFixed(1) : "—"}
            </div>
            <div className="sp-stat-lbl">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
              Rating
            </div>
          </div>
          <div className="sp-stat">
            <div className="sp-stat-val" id="spStatFollowers">
              {followerDisplay}
            </div>
            <div className="sp-stat-lbl">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              Followers
            </div>
          </div>
          <div className="sp-stat sp-stat-joined">
            <div className="sp-stat-val" id="spStatJoined">
              {seller.joinedAt ? seller.joinedAt.toLocaleString("default", { month: "short" }) + " " + seller.joinedAt.getFullYear() : "—"}
            </div>
            <div className="sp-stat-lbl">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              Joined
            </div>
          </div>
        </div>

        {(seller.showSocial || isOwnProfile) && (
          <div id="spModalSocials">
            {SOCIAL_DEFS.map(({ key, label, icon }) => {
              let val = seller[key];
              if (!val) return null;
              if (!val.startsWith("http")) val = "https://" + val;
              return (
                <a key={key} className="sp-social-btn" href={val} target="_blank" rel="noopener">
                  {icon} {label}
                </a>
              );
            })}
          </div>
        )}
      </div>
      <ToastHost />
    </>
  );
}
