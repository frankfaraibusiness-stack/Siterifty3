"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { useAuthModal } from "@/components/auth/AuthModalProvider";
import { fetchFullSeller, fetchSellerDealStats, type FullSeller, type SellerDealStats } from "@/lib/useSeller";
import SellerProfileHeader from "@/components/seller/SellerProfileHeader";
import SellerListingsGrid from "@/components/seller/SellerListingsGrid";
import SellerDetailsOverlay from "@/components/seller/SellerDetailsOverlay";
import RateOverlay from "@/components/seller/RateOverlay";
import { SellerNotFoundScreen, SellerPrivateScreen } from "@/components/seller/SellerStateScreen";
import { useConfirm } from "@/lib/useConfirm";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

// Matches the original's .sp-loading skeleton state — CSS-driven shimmer
// already exists for #spModal.sp-loading in globals.css. Exported so
// app/seller/[id]/loading.tsx (Next's route-level loading UI) can render
// the exact same skeleton during server-side navigation, instead of the
// generic marketplace-grid-shaped SiteriftyLoader that doesn't match this
// page's layout at all.
export function SellerProfileSkeleton() {
  return (
    <div id="spModal" className="active sp-loading" style={{ position: "static", marginTop: 92 }}>
      <div id="spModalInner">
        <div id="spModalCover" />
        <div id="spModalMain">
          <div id="spModalAvatarRow">
            <div id="spModalAv">?</div>
          </div>
          <div id="spModalNameInfo">
            <div id="spModalNameSkelRow">
              <span className="sp-skel sp-skel-name" />
              <span className="sp-skel sp-skel-handle" />
            </div>
            <div id="spModalBioSkelRow">
              <span className="sp-skel sp-skel-bio" />
              <span className="sp-skel sp-skel-bio short" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Unchanged from the old page.tsx's body — this is still the full
// client-side interactive profile (auth-aware isOwnProfile check,
// privacy gates for human visitors, overlays). What moved is only the
// outer shell: page.tsx is now a Server Component that handles
// generateMetadata + notFound() for crawlers/SSR, and renders this
// component for the actual interactive UI, same as the old page did
// for every visitor before.
//
// `initialSeller` is the server-fetched profile (see page.tsx's
// getSellerFullProfile call) — seeded directly into state so the first
// render already shows real content instead of the loading skeleton,
// both for a crawler that never runs the effect below and for a human
// visitor who'd otherwise see a content flash while the client refetch
// resolves. It's `null` for a not-found seller (page.tsx already
// determined that), so the effect's own fetchFullSeller call is what
// sets notFoundState in that case, same as before.
export default function SellerProfileClient({
  uid,
  initialSeller = null,
}: {
  uid: string;
  initialSeller?: FullSeller | null;
}) {
  const { user, profile } = useAuth();
  const { openAuthModal } = useAuthModal();
  const router = useRouter();
  const { alert: confirmAlert, confirm: confirmDialog, ConfirmHost } = useConfirm();

  const [seller, setSeller] = useState<FullSeller | null>(initialSeller);
  const [notFoundState, setNotFoundState] = useState(false);
  const [dealStats, setDealStats] = useState<SellerDealStats | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportDone, setReportDone] = useState(false);

  const isOwnProfile = !!user && user.uid === uid;

  // For the "members" (Followers Only) gate below — needs its own check
  // rather than reusing SellerProfileHeader's isFollowing state, because
  // that component (which owns the Follow button) doesn't mount at all
  // for a visitor who hasn't passed this gate yet. null = not checked
  // yet (avoids a flash of the locked screen for someone who IS a
  // follower, while this resolves).
  const [isFollower, setIsFollower] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!uid || !user || user.uid === uid) {
      setIsFollower(false);
      return;
    }
    setIsFollower(null);
    (async () => {
      try {
        const snap = await getDoc(doc(db, "users", uid, "followers", user.uid));
        if (!cancelled) setIsFollower(snap.exists());
      } catch {
        if (!cancelled) setIsFollower(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid, user]);

  const [followFromGateBusy, setFollowFromGateBusy] = useState(false);

  async function handleFollowFromGate() {
    if (!user || !seller) return;
    setFollowFromGateBusy(true);
    try {
      const followerRef = doc(db, "users", seller.uid, "followers", user.uid);
      const followingRef = doc(db, "users", user.uid, "following", seller.uid);
      const myName = profile?.username || user.displayName || user.email?.split("@")[0] || "Someone";
      await setDoc(followerRef, { uid: user.uid, username: myName, pic: profile?.profilePic || "", followedAt: serverTimestamp() });
      await setDoc(followingRef, { uid: seller.uid, username: seller.username, pic: seller.profilePic || "", followedAt: serverTimestamp() });
      setSeller((s) => (s ? { ...s, followerCount: s.followerCount + 1 } : s));
      setIsFollower(true);
    } catch (err) {
      console.error("[SellerProfileClient] follow from gate failed", err);
    } finally {
      setFollowFromGateBusy(false);
    }
  }

  // Guards the reset-before-refetch logic below: true only once, on this
  // component's very first effect run. That first run is when
  // `initialSeller` (SSR data, already correct for this uid) is sitting
  // in state — nothing to clear. Every later run of this effect (uid
  // changed via client-side nav to a different seller, e.g. clicking a
  // "similar sellers" link) has stale data from the *previous* uid that
  // does need clearing before the new fetch resolves.
  const isFirstRun = useRef(true);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;

    if (!isFirstRun.current) {
      setSeller(null);
      setNotFoundState(false);
      setDealStats(null);
    }
    isFirstRun.current = false;
    // Deliberately NOT resetting `seller`/`notFoundState`/`dealStats` to
    // their empty states on the first run (see isFirstRun above) — doing
    // so would blank out the SSR-seeded `initialSeller` the instant this
    // effect runs on mount, producing exactly the loading flash seeding
    // it was meant to avoid. The fresh fetchFullSeller call below still
    // always runs and overwrites `seller` once it resolves (auth-aware
    // fields like isOwnProfile access need that fresh read) — first run
    // just doesn't clear the screen before that happens.
    (async () => {
      const s = await fetchFullSeller(uid);
      if (cancelled) return;
      if (!s) {
        setNotFoundState(true);
        return;
      }
      setSeller(s);

      // Deal stats load separately, after the main profile paints —
      // mirrors spLoadSellerStats being called after the rest of
      // mpOpenSellerModal finishes rendering.
      fetchSellerDealStats(uid).then((stats) => {
        if (!cancelled) setDealStats(stats);
      });
    })();

    // Profile-view beacon — fire-and-forget, mirrors deal.js's
    // record-profile-view action.
    fetch("/api/deal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "record-profile-view", sellerUid: uid }),
    }).catch((err) => console.error("[SellerProfileClient] profile view beacon", err.message));

    return () => {
      cancelled = true;
    };
  }, [uid]);

  // Report action for the private-profile screen — a private profile is
  // exactly the kind of profile someone may need to flag (can't see its
  // history to judge it), so this state must keep Report working even
  // though it skips SellerProfileHeader (which is where Report normally
  // lives). Mirrors SellerProfileHeader's own handleReport exactly.
  async function handleReportFromPrivateScreen() {
    if (!user || !seller) {
      openAuthModal();
      return;
    }
    const confirmed = await confirmDialog({
      theme: "report",
      title: "Report Seller",
      msg: `Report ${seller.username || "this seller"}'s profile to our team? Our moderators will review it and take action if needed. False reports may result in account restrictions.`,
      confirmText: "Report",
    });
    if (!confirmed) return;

    setReportBusy(true);
    try {
      const { addDoc, collection, serverTimestamp } = await import("firebase/firestore");
      const reportRef = await addDoc(collection(db, "reports"), {
        reporterUid: user.uid,
        reportedUid: seller.uid,
        reason: "seller_profile_report",
        status: "open",
        createdAt: serverTimestamp(),
      });
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
      console.warn("seller report write (private profile)", err);
    } finally {
      setReportBusy(false);
      setReportDone(true);
    }
    await confirmAlert({
      theme: "report",
      title: "Report Submitted",
      msg: "Our team will review this within 24 hours. Thank you for keeping Siterifty safe.",
    });
  }

  // A genuinely missing seller — deleted account, bad/stale link, or a
  // uid that never resolved to anything (see fetchFullSeller in
  // lib/useSeller.ts, which now returns null here instead of silently
  // falling back to a fabricated "Anonymous" profile). Full-screen state
  // instead of a bare heading so a dead link doesn't read as broken.
  if (notFoundState) {
    return (
      <div style={{ marginTop: 92 }}>
        <SellerNotFoundScreen context="profile" />
      </div>
    );
  }

  if (!seller) {
    return <SellerProfileSkeleton />;
  }

  // ── Privacy gate ── mirrors mpOpenSellerModal's intent: a private
  // profile is fully hidden from anyone but its owner; a "members"
  // (Followers Only) profile is hidden from anyone who isn't a real
  // follower of this seller — checked via the isFollower effect above
  // against users/{sellerUid}/followers/{visitorUid}, not just whether
  // the visitor happens to be signed in. Both skip the listings grid,
  // socials, and follow/rate actions entirely. Uses the dedicated
  // full-screen state (not SellerProfileHeader, which owns Follow/
  // Donate/Rate/Report for the public view) — Report is wired up
  // separately here via handleReportFromPrivateScreen so a private
  // profile can still be flagged.
  if (!isOwnProfile && seller.profileVisibility === "private") {
    return (
      <div style={{ marginTop: 92 }}>
        <SellerPrivateScreen
          username={seller.username || "This seller"}
          onReport={() => (user ? handleReportFromPrivateScreen() : openAuthModal())}
          reportBusy={reportBusy}
          reportDone={reportDone}
        />
        <ConfirmHost />
      </div>
    );
  }

  if (!isOwnProfile && seller.profileVisibility === "members" && !user) {
    return (
      <div id="spModal" className="active" style={{ position: "static", marginTop: 92 }}>
        <div id="spModalInner">
          <div id="spModalMain">
            <div id="spModalNameInfo">
              <div id="spModalNameLine">
                <span id="spModalName">{seller.username}</span>
              </div>
              <div id="spModalBio">
                <div id="spModalBioText" style={{ color: "rgba(255,255,255,0.5)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span>This profile is only visible to {seller.username}'s followers.</span>
                  <button
                    onClick={openAuthModal}
                    style={{
                      background: "#a3e635",
                      color: "#0a0a0a",
                      fontWeight: 700,
                      fontSize: 12.5,
                      border: "none",
                      borderRadius: 999,
                      padding: "6px 16px",
                      cursor: "pointer",
                    }}
                  >
                    Sign In / Sign Up
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Signed in but not (yet) a follower — still locked, but with a
  // working Follow button right here instead of a dead end, since
  // SellerProfileHeader (which normally owns Follow) never mounts for a
  // visitor who fails this gate. isFollower === null is "still checking"
  // (see the effect above) — render nothing yet rather than flash this
  // locked screen for someone who turns out to already be a follower.
  if (!isOwnProfile && seller.profileVisibility === "members" && user && isFollower !== true) {
    if (isFollower === null) return null;
    return (
      <div id="spModal" className="active" style={{ position: "static", marginTop: 92 }}>
        <div id="spModalInner">
          <div id="spModalMain">
            <div id="spModalNameInfo">
              <div id="spModalNameLine">
                <span id="spModalName">{seller.username}</span>
              </div>
              <div id="spModalBio">
                <div id="spModalBioText" style={{ color: "rgba(255,255,255,0.5)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span>This profile is only visible to {seller.username}'s followers.</span>
                  <button
                    onClick={handleFollowFromGate}
                    disabled={followFromGateBusy}
                    style={{
                      background: "#a3e635",
                      color: "#0a0a0a",
                      fontWeight: 700,
                      fontSize: 12.5,
                      border: "none",
                      borderRadius: 999,
                      padding: "6px 16px",
                      cursor: followFromGateBusy ? "default" : "pointer",
                      opacity: followFromGateBusy ? 0.7 : 1,
                    }}
                  >
                    {followFromGateBusy ? "Following…" : "Follow to View"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div id="spModal" className="active" style={{ position: "static", marginTop: 92 }}>
      <div id="spModalInner">
        {/* Split on wide desktop via CSS grid placement (see
            #spModalInner's ≥1024px rules in seller-profile.css):
            #spModalCover stays full-width across the top, #spModalMain
            (avatar/name/bio/actions, rendered inside
            SellerProfileHeader) becomes the left column, and
            SellerListingsGrid becomes the right column. No wrapper divs
            needed — driven entirely by existing element IDs, so mobile
            markup/behavior is untouched. */}
        <SellerProfileHeader
          seller={seller}
          onSellerChange={(updater) => setSeller((s) => (s ? updater(s) : s))}
          onOpenDetails={() => setDetailsOpen(true)}
          onOpenRate={() => setRateOpen(true)}
          onOpenDonate={() => router.push(`/donate/${seller.uid}`)}
        />
        <SellerListingsGrid listings={seller.listings} />
      </div>

      {detailsOpen && (
        <SellerDetailsOverlay seller={seller} cachedStats={dealStats} onClose={() => setDetailsOpen(false)} />
      )}
      {rateOpen && (
        <RateOverlay
          sellerUid={seller.uid}
          sellerName={seller.username}
          onClose={() => setRateOpen(false)}
          onSubmitted={(starValSubmitted, isNewReview) =>
            setSeller((s) =>
              s
                ? {
                    ...s,
                    // Matches the original exactly: displays the just-submitted
                    // star value, not a recomputed average (see RateOverlay's
                    // comment on this same behavior).
                    rating: starValSubmitted,
                    ratingCount: isNewReview ? s.ratingCount + 1 : s.ratingCount,
                  }
                : s
            )
          }
        />
      )}
    </div>
  );
}
