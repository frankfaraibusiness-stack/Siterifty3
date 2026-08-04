"use client";

import { useRef, useState, type ReactElement } from "react";
import { useRouter, usePathname } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useAuth } from "@/lib/AuthContext";
import { useProfileData } from "@/lib/useProfileData";
import { useBoostModal } from "@/components/boost/BoostModalProvider";
import { unboostListing } from "@/lib/listings";
import { useAgentModal } from "@/components/agent/AgentModalProvider";
import { useEditListingModal } from "@/components/listing/EditListingModalProvider";
import { usePlansModal } from "@/components/billing/PlansModalProvider";
import { useDisputePicker } from "@/components/dispute/DisputePickerProvider";
import { useConfirm } from "@/lib/useConfirm";
import { useSrToast } from "@/components/system/SrToastProvider";
import { useLimits } from "@/lib/useLimits";
import SellerBadges from "@/components/seller/SellerBadges";
import { logout } from "@/lib/authActions";
import { buildListingSlug } from "@/lib/slug";
import { useCurrency } from "@/lib/CurrencyContext";
import { useNavigating } from "@/lib/useNavigating";
import NavSpinnerIcon from "@/components/shared/NavSpinnerIcon";
import ChatLoadingState from "@/components/shared/ChatLoadingState";
import PmHeaderBannerRotator from "@/components/profile/PmHeaderBannerRotator";

// Ports the PROFILE MODAL from Js/profile.js + Js/profile-early.js
// (index.html lines 12099-12279 and 17189-18238) as a real routed page at
// /myprofile, rather than a floating global modal — same "route-backed
// section" convention SellerDashboard.tsx already established for
// /dashboard. All of #profileModal's original markup/classnames are kept
// verbatim (see app/globals.css's already-ported .pm-* rules) so this
// reuses that styling directly instead of re-implementing it.
//
// Known gaps, called out inline where relevant rather than silently
// papered over:
//  - GitHub connect/disconnect calls /api/github, which was never present
//    in the backend zip this port worked from (not just unported — the
//    endpoint doesn't exist anywhere in this codebase). The UI below is
//    wired exactly as the original was, so it starts working the moment
//    that route exists; until then the Connect button will error out via
//    its own existing failure toast.
//  - The avatar cooldown pre-check calls /api/limits with
//    action:'check-profilepic-change' — now real (see
//    app/api/_lib/limits.js's handleCheckProfilePic + the new /api/limits
//    route), same pattern as the username/email checks. Was previously a
//    known gap: the action existed nowhere server-side, so this used to
//    always silently succeed with no cooldown enforced at all.
//  - The listing Edit button opens EditListingModal (via
//    useEditListingModal().openEdit) — real edit/delete now, not a
//    redirect to /sell. onSaved/onDeleted both call refreshListings()
//    so this page's own list re-fetches rather than duplicating the
//    modal's save/delete logic locally.

// Mirrors isBoosted() in lib/listings.ts but returns whole days remaining
// (ceil, so "expires in 40 minutes" still reads as "1 day left" rather
// than "0 days left") instead of a plain boolean — this is what the
// "My Listings" boosted badge actually needs to display. Returns null for
// an unboosted or already-expired listing.
function boostDaysLeft(listing: { boostedUntil?: number | { toMillis?: () => number; seconds?: number } }): number | null {
  const until = listing.boostedUntil;
  if (!until) return null;
  const ms =
    typeof until === "number"
      ? until
      : until.toMillis
        ? until.toMillis()
        : until.seconds
          ? until.seconds * 1000
          : 0;
  const remainingMs = ms - Date.now();
  if (remainingMs <= 0) return null;
  return Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
}

const TYPE_ICONS: Record<string, ReactElement> = {
  website: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  app: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="3" width="7" height="7" rx="1" />
      <rect x="15" y="3" width="7" height="7" rx="1" />
      <rect x="2" y="14" width="7" height="7" rx="1" />
      <rect x="15" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  game: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M12 12h.01" />
      <path d="M17 12h.01" />
      <path d="M7 12h.01" />
    </svg>
  ),
};

function pmPlanClass(plan: string) {
  return "pm-plan-" + (["starter", "growth", "pro"].includes(plan) ? plan : "free");
}

export type ParentTab = "profile" | "listings" | "favorites" | "following";
type SubTab = "account" | "public";

export default function MyProfileHub({ initialTab }: { initialTab?: ParentTab }) {
  const router = useRouter();
  const { user } = useAuth();
  const { formatPriceShort } = useCurrency();
  const { openBoost } = useBoostModal();
  const { openAgent } = useAgentModal();
  const { openEdit } = useEditListingModal();
  const { openPlansModal } = usePlansModal();
  const { openDisputePicker } = useDisputePicker();
  const { confirm, ConfirmHost } = useConfirm();
  const { show: toast } = useSrToast();
  const { limits } = useLimits();

  const {
    profile,
    profileLoading,
    profileError,
    listings,
    listingsLoading,
    listingsError,
    favorites,
    favoritesLoading,
    following,
    followingLoading,
    unreadDeals,
    saveAccount,
    savePublicProfile,
    uploadAvatar,
    deleteListing,
    removeFavorite,
    unfollow,
    cancelPlan,
    refreshListings,
  } = useProfileData();

  const [parentTab, setParentTab] = useState<ParentTab>(initialTab || "profile");
  const pathname = usePathname();

  // "profile" has no /myprofile/profile URL — plain /myprofile already
  // means "My Profile" tab, so it's left out of this map. See selectTab
  // below and app/myprofile/[tab]/page.tsx for the other half of this.
  const TAB_PATHS: Partial<Record<ParentTab, string>> = {
    listings: "/myprofile/listings",
    favorites: "/myprofile/favorites",
    following: "/myprofile/following",
  };

  function selectTab(tab: ParentTab) {
    setParentTab(tab);
    const target = tab === "profile" ? "/myprofile" : TAB_PATHS[tab]!;
    if (pathname !== target) {
      router.push(target);
    }
  }

  const [subTab, setSubTab] = useState<SubTab>("account");
  // Immediate visual feedback for the Messages & Deals button — on a slow
  // connection the /messages route (server-rendered shell + client data)
  // could take a moment to appear, and previously nothing on this button
  // indicated the tap had registered in the meantime. app/messages/loading.tsx
  // now also renders a matching skeleton during that gap; this spinner
  // covers the instant between tap and that skeleton mounting.
  const [navigatingToInbox, setNavigatingToInbox] = useState(false);
  // Dashboard has no route-level loading.tsx gap the way /messages does
  // (app/dashboard/page.tsx is a synchronous server component — Next's
  // loading.tsx only fires around async server work, so it never showed
  // here regardless). The actual silent gap is client-side: the
  // dashboard button click today does nothing visible until
  // SellerDashboard's JS chunk downloads, hydrates, and first-paints.
  // Same fix as the inbox button — instant spinner on tap.
  const dashNav = useNavigating();
  // Settings is also a "use client" page (app/settings/page.tsx) — same
  // reasoning as dashNav above, its own client bundle load/hydrate is
  // the real gap, not something loading.tsx can see.
  const settingsNav = useNavigating();
  // /sell (app/sell/page.tsx) is a server page returning SellPickerClient
  // synchronously, so loading.tsx can't cover its client-side data fetch
  // gap either — same class of bug as dashNav/settingsNav above.
  const addListingNav = useNavigating();

  const [usernameInput, setUsernameInput] = useState("");
  const [contactEmailInput, setContactEmailInput] = useState("");
  const [accountErr, setAccountErr] = useState("");
  const [savingAccount, setSavingAccount] = useState<"idle" | "saving" | "saved">("idle");

  const [bioInput, setBioInput] = useState("");
  const [showBio, setShowBio] = useState(true);
  const [showEmail, setShowEmail] = useState(false);
  const [savingPublic, setSavingPublic] = useState<"idle" | "saving" | "saved">("idle");

  const [avatarUploading, setAvatarUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [deleting, setDeleting] = useState(false);
  const [unboostingId, setUnboostingId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [logoutConfirming, setLogoutConfirming] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  // Sync form fields whenever fresh profile data lands (initial load, or
  // after a successful save re-fetch) — same as pmRender re-populating
  // the inputs on every call.
  const lastSyncedUsername = useRef<string | null>(null);
  if (!profileLoading && lastSyncedUsername.current !== profile.username) {
    lastSyncedUsername.current = profile.username;
    setUsernameInput(profile.username);
    setContactEmailInput(profile.contactEmail);
    setBioInput(profile.bio);
    setShowBio(profile.showBio);
    setShowEmail(profile.showEmail);
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast("Please choose an image file.", "error");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast("Image must be under 10MB.", "error");
      return;
    }
    setAvatarUploading(true);
    try {
      await uploadAvatar(file);
    } catch (err: any) {
      toast("Upload failed: " + (err.message || "unknown error"), "error");
    } finally {
      setAvatarUploading(false);
    }
  }

  async function handleSaveAccount() {
    setAccountErr("");
    const newUsername = usernameInput.trim();
    const newContactEmail = contactEmailInput.trim();
    if (!newUsername) {
      setAccountErr("Username cannot be empty.");
      return;
    }
    if (newContactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newContactEmail)) {
      setAccountErr("Enter a valid contact email.");
      return;
    }
    if (newUsername.length < (limits.username.minLength ?? 5)) {
      setAccountErr(`Username must be at least ${limits.username.minLength ?? 5} characters.`);
      return;
    }
    if (newUsername.length > (limits.username.maxLength ?? 15)) {
      setAccountErr(`Username cannot exceed ${limits.username.maxLength ?? 15} characters.`);
      return;
    }
    if (!new RegExp(limits.username.pattern || "^[a-zA-Z0-9_.-]+$").test(newUsername)) {
      setAccountErr(limits.username.patternHint || "Username can only contain letters, numbers, underscores, hyphens, and dots.");
      return;
    }
    setSavingAccount("saving");
    try {
      await saveAccount(newUsername, newContactEmail);
      setSavingAccount("saved");
      setTimeout(() => setSavingAccount("idle"), 1800);
    } catch (err: any) {
      setAccountErr(err.message || "Save failed.");
      setSavingAccount("idle");
    }
  }

  async function handleSavePublic() {
    setSavingPublic("saving");
    try {
      await savePublicProfile(bioInput.trim(), showBio, showEmail);
      setSavingPublic("saved");
      setTimeout(() => setSavingPublic("idle"), 1800);
    } catch {
      setSavingPublic("idle");
      toast("Save failed. Please try again.", "error");
    }
  }

  async function handleDeleteListing(listingId: string) {
    const ok = await confirm({
      theme: "danger",
      title: "Delete Listing?",
      msg: "This will permanently remove the listing. This cannot be undone.",
      confirmText: "Delete",
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await deleteListing(listingId);
    } catch {
      toast("Could not delete this listing. Please try again.", "error");
    } finally {
      setDeleting(false);
    }
  }

  async function handleBoost(listingId: string) {
    let listingData: any = null;
    try {
      const snap = await getDoc(doc(db, "listings", listingId));
      if (snap.exists()) listingData = { id: snap.id, ...snap.data() };
    } catch {
      /* fall back to id-only */
    }
    openBoost(listingId, listingData);
  }

  async function handleUnboost(listingId: string) {
    const ok = await confirm({
      theme: "danger",
      title: "Stop Boost?",
      msg: "This listing will stop showing as boosted right away. Remaining boost time is not refunded.",
      confirmText: "Stop Boost",
    });
    if (!ok) return;
    setUnboostingId(listingId);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error("Not signed in");
      await unboostListing({ idToken, listingId });
      toast("Boost stopped.", "success");
    } catch (err) {
      console.error("[MyProfileHub] unboost failed:", err);
      const msg = err instanceof Error && err.message ? err.message : "Could not stop the boost. Please try again.";
      toast(msg, "error");
    } finally {
      setUnboostingId(null);
    }
  }

  async function handleCancelPlan() {
    const ok = await confirm({
      theme: "danger",
      title: `Cancel ${planLabel} Plan`,
      msg: "Your subscription will be cancelled and your account will revert to the Free plan at the end of your current billing cycle. Are you sure?",
      confirmText: "Yes, Cancel Plan",
    });
    if (!ok) return;
    setCancelling(true);
    try {
      await cancelPlan();
      toast(`Your ${planLabel} plan has been cancelled. You'll stay on ${planLabel} until the end of your billing period, then revert to Free.`, "success");
    } catch (err: any) {
      toast(err.message || "Cancellation failed. Please try again.", "error");
    } finally {
      setCancelling(false);
    }
  }

  async function handleLogout() {
    setLoggingOut(true);
    await logout();
  }

  const planLabel = profile.plan.charAt(0).toUpperCase() + profile.plan.slice(1);
  const active = listings.filter((l) => l.status !== "draft").length;
  const drafts = listings.filter((l) => l.status === "draft").length;
  let listingCountText = active > 0 ? `${active} active listing${active !== 1 ? "s" : ""}` : "No active listings";
  if (drafts > 0) listingCountText += ` · ${drafts} draft${drafts !== 1 ? "s" : ""}`;

  return (
    <div id="profileModal">
      <div className="pm-modal">
        {/* Real site Header + AnnouncementBar (both fixed, 92px total)
            already provide navigation here — AnnouncementBar swaps its
            Upgrade/Manage-Plan button for a Back-to-home button on this
            route (see AnnouncementBar.tsx's onBackRoute). No page-local
            header needed. */}
        <div className="pm-modal-header pm-modal-header-banner">
          <PmHeaderBannerRotator
            banners={[
              {
                src: "https://cdn.phototourl.com/member/2026-07-26-c3ef1108-74b7-4ac5-a41e-ec7b30052186.jpg",
                alt: "Sell digital products, earn big",
                onClick: () => addListingNav.navigate("/sell"),
              },
              {
                src: "https://cdn.phototourl.com/member/2026-07-26-4d5c8480-eb36-4709-89e7-5e6497b7acca.jpg",
                alt: "Upgrade to Starter, lower fees, more listings",
                onClick: () => openPlansModal("starter"),
              },
              {
                src: "https://cdn.phototourl.com/member/2026-07-26-7e7918a4-6bf7-490e-8021-32f4ba35a4ef.jpg",
                alt: "Upgrade to Starter, only $10 per month",
                onClick: () => openPlansModal("starter"),
              },
              {
                src: "https://cdn.phototourl.com/member/2026-07-26-5d23c5f3-8044-4e2b-ac78-859dbcf49813.jpg",
                alt: "Start selling today",
                onClick: () => addListingNav.navigate("/sell"),
              },
            ]}
          />
        </div>

        <div className="pm-modal-content">
          {/* Identity */}
          <div className="pm-identity" style={{ position: "relative", zIndex: 1 }}>
            <div className="pm-avatar-wrapper">
              {profileLoading ? (
                <span className="pm-skel pm-skel-avatar" />
              ) : (
                <>
                  <div className="pm-avatar-ring" />
                  <button
                    type="button"
                    className="pm-avatar-circle"
                    title="Tap to change your profile picture"
                    style={{ cursor: "pointer", padding: 0, border: "none", position: "relative", overflow: "hidden", opacity: avatarUploading ? 0.6 : 1 }}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {profile.profilePic ? (
                      <img src={profile.profilePic} style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }} alt="" />
                    ) : (
                      <span>{profile.username.slice(0, 2).toUpperCase()}</span>
                    )}
                    <div
                      className="pm-avatar-hover"
                      style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", opacity: 0, transition: "opacity 0.15s", display: "flex", alignItems: "center", justifyContent: "center" }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" style={{ width: 18, height: 18 }}>
                        <path d="M12 16V8M12 8l-3 3M12 8l3 3" />
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                      </svg>
                    </div>
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    style={{ display: "none" }}
                    onChange={handleAvatarChange}
                  />
                </>
              )}
            </div>

            {profileLoading ? (
              <>
                <span className="pm-skel pm-skel-name" />
                <span className="pm-skel pm-skel-handle" />
              </>
            ) : (
              <>
                <div className="pm-username-text">
                  <span className="pm-displayname-text">{profile.username}</span>
                  <SellerBadges seller={{ plan: profile.plan, followerCount: profile.followerCount, dealsCompleted: profile.dealsCompleted }} />
                </div>
                <div className="pm-handle-text">@{profile.username.toLowerCase().replace(/\s+/g, "")}</div>
                <div className="pm-email-text">{user?.email || ""}</div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.3rem" }}>
                  <span className={`pm-plan-badge ${pmPlanClass(profile.plan)}`}>{planLabel}</span>
                </div>
              </>
            )}
            {profileError ? <div style={{ color: "#f87171", fontSize: 12, marginTop: 8 }}>{profileError}</div> : null}
          </div>

          {/* Messages & Deals */}
          <button
            className="pm-inbox-btn"
            style={{ position: "relative", zIndex: 1 }}
            disabled={navigatingToInbox}
            onClick={() => {
              setNavigatingToInbox(true);
              router.push("/messages");
            }}
          >
            <span className="pm-inbox-btn-left">
              {navigatingToInbox ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="pm-inbox-spinner">
                  <path d="M21 12a9 9 0 1 1-9-9" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              )}
              <span className="pm-inbox-label">Messages &amp; Deals</span>
            </span>
            <span className="pm-inbox-badge-wrap">
              {unreadDeals > 0 ? <span className="pm-inbox-unread-badge">{unreadDeals > 99 ? "99+" : unreadDeals}</span> : null}
              <svg className="pm-inbox-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </span>
          </button>

          {/* AI Agent / Dashboard */}
          <div className="pm-quick-row" style={{ position: "relative", zIndex: 1 }}>
            <button className="pm-quick-btn pm-ai-btn" onClick={openAgent}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="10" rx="2" />
                <circle cx="12" cy="5" r="2" />
                <path d="M12 7v4" />
                <line x1="8" y1="16" x2="8" y2="16" />
                <line x1="16" y1="16" x2="16" y2="16" />
              </svg>
              <span>AI Agent</span>
            </button>
            <button
              className="pm-quick-btn pm-dash-btn"
              type="button"
              disabled={dashNav.isNavigating}
              onClick={() => dashNav.navigate("/dashboard")}
            >
              {dashNav.isNavigating ? (
                <NavSpinnerIcon size={16} />
              ) : (
                <span className="pm-dash-chart" aria-hidden="true">
                  <span className="pm-dash-bar" />
                  <span className="pm-dash-bar" />
                  <span className="pm-dash-bar" />
                  <span className="pm-dash-bar" />
                </span>
              )}
              <span>{dashNav.isNavigating ? "Opening…" : "Dashboard"}</span>
            </button>
          </div>

          {/* Plan */}
          <div className="pm-plan-card" style={{ position: "relative", zIndex: 1 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span className={`pm-sub-badge ${pmPlanClass(profile.plan)}`}>{planLabel}</span>
                <span style={{ fontSize: "0.78rem", color: "var(--mp-text-sec)" }}>
                  {profile.plan === "free" ? "Free plan · Upgrade to unlock more features" : `${planLabel} plan · Active`}
                </span>
              </div>
              <span style={{ fontSize: "0.73rem", color: "var(--mp-text-muted)" }}>
                {listingsLoading ? "Loading listings…" : listingCountText}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.4rem", flexShrink: 0 }}>
              {profile.plan === "free" ? (
                <button className="pm-manage-plan-btn" onClick={() => openPlansModal()}>
                  Upgrade
                </button>
              ) : (
                <button className="pm-cancel-plan-btn" onClick={handleCancelPlan} disabled={cancelling}>
                  Cancel Plan
                </button>
              )}
            </div>
          </div>

          {/* Parent tabs */}
          <div className="pm-parent-tab-row" style={{ position: "relative", zIndex: 1 }}>
            <button className={`pm-parent-tab${parentTab === "profile" ? " active" : ""}`} onClick={() => selectTab("profile")}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              <span>My Profile</span>
            </button>
            <button className={`pm-parent-tab${parentTab === "listings" ? " active" : ""}`} onClick={() => selectTab("listings")}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
              <span>My Listings</span>
            </button>
            <button className={`pm-parent-tab${parentTab === "favorites" ? " active" : ""}`} onClick={() => selectTab("favorites")}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
              <span>Favorites</span>
            </button>
            <button className={`pm-parent-tab${parentTab === "following" ? " active" : ""}`} onClick={() => selectTab("following")}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <span>Following</span>
            </button>
          </div>

          {/* My Profile tab */}
          {parentTab === "profile" && (
            <div className="pm-parent-content active" style={{ position: "relative", zIndex: 1 }}>
              <div className="pm-sub-tab-row">
                <button className={`pm-sub-tab${subTab === "account" ? " active" : ""}`} onClick={() => setSubTab("account")}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                  <span>Account</span>
                </button>
                <button className={`pm-sub-tab${subTab === "public" ? " active" : ""}`} onClick={() => setSubTab("public")}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="2" y1="12" x2="22" y2="12" />
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  </svg>
                  <span>Public Profile</span>
                </button>
              </div>

              {subTab === "account" && (
                <div className="pm-sub-tab-content active">
                  <div className="pm-input-group">
                    <label>Username</label>
                    <input
                      className="pm-input-field"
                      type="text"
                      placeholder="Your username"
                      value={usernameInput}
                      onChange={(e) => setUsernameInput(e.target.value)}
                      minLength={limits.username.minLength}
                      maxLength={limits.username.maxLength}
                    />
                    <span className="pm-hint">
                      Can be changed once every {Math.round((limits.username.changeCooldownMs ?? 0) / (24 * 60 * 60 * 1000))} days.
                    </span>
                  </div>
                  <div className="pm-input-group">
                    <label>Contact email</label>
                    <input
                      className="pm-input-field"
                      type="email"
                      placeholder="contact@example.com"
                      value={contactEmailInput}
                      onChange={(e) => setContactEmailInput(e.target.value)}
                    />
                    <span className="pm-hint">
                      Up to {limits.contactEmail.maxChangesPerPeriod ?? 2} changes every{" "}
                      {Math.round((limits.contactEmail.periodMs ?? 0) / (24 * 60 * 60 * 1000))} days.
                    </span>
                  </div>
                  {accountErr ? (
                    <div style={{ color: "#f87171", fontSize: "0.8rem", padding: "0.5rem 0.8rem", background: "rgba(248,113,113,0.08)", borderRadius: "0.6rem", border: "1px solid rgba(248,113,113,0.2)" }}>
                      {accountErr}
                    </div>
                  ) : null}
                  <button className="pm-save-btn" onClick={handleSaveAccount} disabled={savingAccount === "saving"}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M19 21H5C3.89543 21 3 20.1046 3 19V5C3 3.89543 3.89543 3 5 3H16L21 8V19C21 20.1046 20.1046 21 19 21Z" />
                      <polyline points="17 21 17 13 7 13 7 21" />
                      <polyline points="7 3 7 8 15 8" />
                    </svg>
                    <span>{savingAccount === "saving" ? "Saving…" : savingAccount === "saved" ? "Saved ✓" : "Save changes"}</span>
                  </button>

                  <div className="pm-github-row" id="pmGithubSection">
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", minWidth: 0 }}>
                      <div className="pm-github-icon">
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="#fff">
                          <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
                        </svg>
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div className="pm-github-name">GitHub</div>
                        <div className="pm-github-status">
                          {profile.githubUsername ? (
                            <>
                              <span style={{ color: "var(--mp-accent)", fontWeight: 700 }}>✓ Connected</span>{" "}
                              <span style={{ color: "var(--mp-text-muted)" }}>@{profile.githubUsername}</span>
                            </>
                          ) : (
                            "Not connected"
                          )}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
                      {profile.githubUsername ? (
                        <button
                          className="pm-github-disconnect-btn"
                          onClick={async () => {
                            const user2 = auth.currentUser;
                            if (!user2) return;
                            try {
                              const idToken = await user2.getIdToken();
                              await fetch("/api/github?action=disconnect", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ idToken }),
                              });
                            } catch {
                              toast("Could not disconnect GitHub. Please try again.", "error");
                            }
                          }}
                        >
                          Disconnect
                        </button>
                      ) : (
                        <button
                          className="pm-github-connect-btn"
                          onClick={async () => {
                            const user2 = auth.currentUser;
                            if (!user2) return;
                            try {
                              const idToken = await user2.getIdToken();
                              window.location.href = "/api/github?action=connect&idToken=" + encodeURIComponent(idToken);
                            } catch {
                              toast("Could not start GitHub connection. Please try again.", "error");
                            }
                          }}
                        >
                          Connect
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {subTab === "public" && (
                <div className="pm-sub-tab-content active">
                  <div className="pm-input-group">
                    <label>Bio</label>
                    <textarea
                      className="pm-input-field"
                      placeholder="Tell buyers and sellers about yourself…"
                      value={bioInput}
                      onChange={(e) => setBioInput(e.target.value)}
                    />
                  </div>
                  <div className="pm-toggle-item">
                    <span className="pm-toggle-label">Show bio publicly</span>
                    <label className="pm-toggle-switch">
                      <input type="checkbox" checked={showBio} onChange={(e) => setShowBio(e.target.checked)} />
                      <span className="pm-slider" />
                    </label>
                  </div>
                  <div className="pm-toggle-item">
                    <span className="pm-toggle-label">Show email on profile</span>
                    <label className="pm-toggle-switch">
                      <input type="checkbox" checked={showEmail} onChange={(e) => setShowEmail(e.target.checked)} />
                      <span className="pm-slider" />
                    </label>
                  </div>
                  <button className="pm-save-btn" onClick={handleSavePublic} disabled={savingPublic === "saving"}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M19 21H5C3.89543 21 3 20.1046 3 19V5C3 3.89543 3.89543 3 5 3H16L21 8V19C21 20.1046 20.1046 21 19 21Z" />
                    </svg>
                    <span>{savingPublic === "saving" ? "Saving…" : savingPublic === "saved" ? "Saved ✓" : "Save public profile"}</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* My Listings tab */}
          {parentTab === "listings" && (
            <div className="pm-parent-content active" style={{ position: "relative", zIndex: 1 }}>
              <div style={{ width: "100%" }}>
                {listingsLoading ? (
                  <ChatLoadingState label="Loading your listings…" compact />
                ) : listingsError ? (
                  <div style={{ textAlign: "center", padding: "2rem", color: "#555", fontSize: "0.88rem" }}>{listingsError}</div>
                ) : listings.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "2.5rem 1rem", color: "#555", fontSize: "0.88rem" }}>You have no listings yet.</div>
                ) : (
                  <div className="pm-listings-grid">
                    {listings.map((l) => {
                      const thumb = (l.images && (l.images[2] || l.images[0])) || "";
                      const title = l.title || "Untitled";
                      const desc = l.description ? l.description.slice(0, 60) + (l.description.length > 60 ? "…" : "") : "";
                      const daysLeft = boostDaysLeft(l);
                      const boosted = daysLeft !== null;
                      return (
                        <div className="pm-listing-card" key={l.id}>
                          {thumb ? (
                            <img className="pm-listing-image" src={thumb} alt={title} loading="lazy" />
                          ) : (
                            <div className="pm-listing-image" style={{ background: "#111", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="1.5">
                                <rect x="3" y="3" width="18" height="18" rx="2" />
                                <path d="M3 9h18M9 21V9" />
                              </svg>
                            </div>
                          )}
                          <div className="pm-listing-info">
                            <div className="pm-listing-title">
                              {title}
                              {l.status === "draft" ? (
                                <span style={{ fontSize: "0.65rem", background: "#222", color: "#888", padding: "2px 8px", borderRadius: "1rem", marginLeft: 4 }}>Draft</span>
                              ) : null}
                              {boosted ? (
                                <span
                                  style={{
                                    fontSize: "0.65rem", fontWeight: 800, background: "rgba(163,230,53,0.14)",
                                    color: "#a3e635", border: "1px solid rgba(163,230,53,0.35)",
                                    padding: "2px 8px", borderRadius: "1rem", marginLeft: 4,
                                    display: "inline-flex", alignItems: "center", gap: 3,
                                  }}
                                  title={`Boosted — ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}
                                >
                                  <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
                                  </svg>
                                  BOOSTED · {daysLeft}D LEFT
                                </span>
                              ) : null}
                            </div>
                            {desc ? <div className="pm-listing-desc">{desc}</div> : null}
                            {boosted ? (
                              <button
                                className="pm-listing-boost pm-listing-unboost"
                                type="button"
                                disabled={unboostingId === l.id}
                                onClick={() => handleUnboost(l.id)}
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M18 6L6 18M6 6l12 12" />
                                </svg>
                                <span>{unboostingId === l.id ? "Stopping…" : "STOP BOOST"}</span>
                              </button>
                            ) : (
                              <button className="pm-listing-boost" type="button" onClick={() => handleBoost(l.id)}>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
                                </svg>
                                <span>BOOST LISTING</span>
                              </button>
                            )}
                            <div className="pm-listing-actions-row">
                              <button
                                className="pm-listing-edit-btn"
                                type="button"
                                onClick={() =>
                                  openEdit(l.id, {
                                    onSaved: () => refreshListings(),
                                    onDeleted: () => refreshListings(),
                                  })
                                }
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                </svg>
                                Edit
                              </button>
                              <button className="pm-listing-delete-btn" type="button" onClick={() => handleDeleteListing(l.id)} disabled={deleting}>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="3 6 5 6 21 6" />
                                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                  <path d="M10 11v6M14 11v6" />
                                  <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                </svg>
                                Delete
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <button className="pm-add-listing-btn" disabled={addListingNav.isNavigating} onClick={() => addListingNav.navigate("/sell")}>
                {addListingNav.isNavigating ? (
                  <NavSpinnerIcon size={15} />
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                )}
                {addListingNav.isNavigating ? "Opening…" : "Add new listing"}
              </button>
            </div>
          )}

          {/* Favorites tab */}
          {parentTab === "favorites" && (
            <div className="pm-parent-content active" style={{ position: "relative", zIndex: 1 }}>
              <div style={{ width: "100%" }}>
                {favoritesLoading ? (
                  <ChatLoadingState label="Loading your favorites…" compact />
                ) : favorites.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "2.5rem 1rem", color: "#555", fontSize: "0.88rem" }}>
                    You have not saved any listings yet. Tap the heart on a listing to save it here.
                  </div>
                ) : (
                  <div className="pm-listings-grid">
                    {favorites.map((f) => {
                      const price = formatPriceShort(f.price);
                      return (
                        <div
                          className="pm-listing-card pm-favorite-card"
                          key={f.id}
                          style={{ cursor: "pointer", position: "relative" }}
                          onClick={() => router.push(`/listing/${buildListingSlug(f.title, f.listingId)}`)}
                        >
                          <button
                            className="pm-favorite-remove-btn"
                            type="button"
                            aria-label="Remove from favorites"
                            title="Remove from favorites"
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                await removeFavorite(f.listingId);
                              } catch {
                                toast("Could not remove. Please try again.", "error");
                              }
                            }}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 6h18" />
                              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                              <line x1="10" y1="11" x2="10" y2="17" />
                              <line x1="14" y1="11" x2="14" y2="17" />
                            </svg>
                            <span>Remove</span>
                          </button>
                          {f.image ? (
                            <img className="pm-listing-image" src={f.image} alt={f.title || ""} loading="lazy" />
                          ) : (
                            <div className="pm-listing-image" style={{ background: "#111", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="1.5">
                                <rect x="3" y="3" width="18" height="18" rx="2" />
                                <path d="M3 9h18M9 21V9" />
                              </svg>
                            </div>
                          )}
                          <div className="pm-listing-info">
                            <div className="pm-listing-title" style={{ display: "flex", alignItems: "center", gap: 5 }}>
                              {TYPE_ICONS[f.type || "website"]}
                              {f.title || "Untitled"}
                            </div>
                            {price ? <div className="pm-listing-desc">{price}</div> : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Following tab */}
          {parentTab === "following" && (
            <div className="pm-parent-content active" style={{ position: "relative", zIndex: 1 }}>
              <div style={{ width: "100%" }}>
                {followingLoading ? (
                  <ChatLoadingState label="Loading who you follow…" compact />
                ) : following.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "2.5rem 1rem", color: "#555", fontSize: "0.88rem" }}>
                    You are not following anyone yet. Follow a seller from their profile to see them here.
                  </div>
                ) : (
                  <div className="pm-following-list">
                    {following.map((f) => (
                      <div
                        className="pm-following-row"
                        key={f.uid}
                        style={{ cursor: "pointer" }}
                        onClick={() => router.push(`/seller/${f.uid}`)}
                      >
                        {f.pic ? (
                          <img className="pm-following-av" src={f.pic} alt={f.username} loading="lazy" />
                        ) : (
                          <div className="pm-following-av pm-following-av-fallback">{(f.username || "?").charAt(0).toUpperCase()}</div>
                        )}
                        <div className="pm-following-name">{f.username}</div>
                        <button
                          className="pm-following-unfollow-btn"
                          type="button"
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              await unfollow(f.uid);
                            } catch {
                              toast("Could not unfollow. Please try again.", "error");
                            }
                          }}
                        >
                          Unfollow
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="pm-bottom-actions" style={{ position: "relative", zIndex: 1 }}>
            <div className="pm-bottom-row">
              <button className="pm-bottom-btn" disabled={settingsNav.isNavigating} onClick={() => settingsNav.navigate("/settings")}>
                {settingsNav.isNavigating ? (
                  <NavSpinnerIcon size={15} />
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                )}
                {settingsNav.isNavigating ? "Opening…" : "Settings"}
              </button>
              <button
                className="pm-bottom-btn pm-bottom-dispute"
                onClick={openDisputePicker}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                Dispute
              </button>
            </div>
            <button className="pm-bottom-btn pm-bottom-logout" style={{ width: "100%" }} onClick={() => setLogoutConfirming(true)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              Sign Out
            </button>
          </div>
        </div>
      </div>

      <ConfirmHost />

      {/* Uses the real #logoutModalOverlay styling from globals.css (the
          same markup as SettingsSidebar's logout modal), consistent with
          delete-listing/cancel-plan now using the shared useConfirm()
          dialog above rather than a one-off inline-styled overlay. */}
      {logoutConfirming ? (
        <div
          id="logoutModalOverlay"
          className="visible"
          onClick={() => !loggingOut && setLogoutConfirming(false)}
        >
          <div id="logoutModalBox" onClick={(e) => e.stopPropagation()}>
            <div id="logoutModalIconWrap">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </div>
            <div id="logoutModalTitle">Sign out?</div>
            <div id="logoutModalMsg">
              You&apos;ll need to sign back in to access your account.
            </div>
            <div className="logout-modal-actions">
              <button
                type="button"
                className="logout-modal-btn confirm"
                onClick={handleLogout}
                disabled={loggingOut}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                {loggingOut ? "Signing out…" : "Sign Out"}
              </button>
              <button
                type="button"
                className="logout-modal-btn cancel"
                onClick={() => setLogoutConfirming(false)}
                disabled={loggingOut}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

    </div>
  );
}
