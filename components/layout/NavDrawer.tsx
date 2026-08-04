"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { useAuthModal } from "@/components/auth/AuthModalProvider";
import { useNavDrawer } from "@/components/layout/NavDrawerProvider";
import { useNavListingsCount } from "@/lib/useNavListingsCount";
import { logout } from "@/lib/authActions";
import { useWalletModal } from "@/components/wallet/WalletModalProvider";
import { usePlansModal } from "@/components/billing/PlansModalProvider";
import { useThemeModal } from "@/components/theme/ThemeModalProvider";
import {
  getCurrentPushSubscription,
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/push";
import { useEffect, useRef, useState } from "react";

// Ports the nav drawer's full interactive behavior from auth-modal.js:
// open/close mechanics (now lifted into NavDrawerProvider so Header's
// hamburger button can reach it), the __requireAuth guard pattern, and
// every link/button's click handler. The Support section's static pages
// (About/Contact/Help/How It Works/Escrow/Buyer Protection/Terms) are now
// real routes and navigate normally. My Profile modal is still pending —
// see its own link's comment below.
// Theme Picker is now built (ThemeModalProvider) and wired directly.
export default function NavDrawer() {
  const { user, profile } = useAuth();
  const { openAuthModal } = useAuthModal();
  const { isOpen, closeNav, scrollBodyRef } = useNavDrawer();
  const { openWallet } = useWalletModal();
  const { openPlansModal } = usePlansModal();
  const { openThemePicker } = useThemeModal();
  const router = useRouter();
  const isLoggedIn = !!user;
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    closeNav();
    await logout();
  }

  // Bumps every time the drawer opens, so useNavListingsCount refetches
  // fresh — mirrors the original's openNav() calling
  // __refreshNavListingsCount every time, never caching.
  const [openCount, setOpenCount] = useState(0);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (isOpen && !wasOpen.current) setOpenCount((c) => c + 1);
    wasOpen.current = isOpen;
  }, [isOpen]);
  const listingsCount = useNavListingsCount(user?.uid, openCount);

  // Auth guard — ports __requireAuth: runs fn() if signed in, otherwise
  // opens the auth modal instead. Closes the drawer first in the
  // logged-out branch too (not just inside `fn`/`go`) — previously only
  // `go()` called closeNav(), so a logged-out tap on something like
  // "Start Selling" opened AuthModal while the drawer stayed open on
  // top of it (drawer is z-index 10501, AuthModal 9999), making it look
  // like the tap did nothing at all.
  function requireAuth(fn: () => void) {
    if (user) fn();
    else {
      closeNav();
      openAuthModal();
    }
  }

  function go(path: string) {
    closeNav();
    router.push(path);
  }

  // router.push() never prefetches a route's JS chunk on its own the way
  // next/link does (next/link prefetches once the link scrolls into
  // view) — every one of this drawer's links uses go()/router.push(),
  // so without this, each first click pays a full cold fetch-and-parse
  // of that route's chunk with nothing on screen in the meantime. Warm
  // the core destinations once, right away, so by the time anyone
  // actually taps a link the chunk is already cached and the
  // navigation is instant.
  useEffect(() => {
    const routes = [
      "/",
      "/myprofile",
      "/sell",
      "/marketplace",
      "/dashboard",
      "/settings",
      "/sellers",
    ];
    routes.forEach((r) => router.prefetch(r));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const planName = profile?.plan || "free";
  const isPaidPlan = planName !== "free";

  // ── PUSH NOTIFICATIONS (VAPID) ──
  // Ports the "── PUSH NOTIFICATIONS (VAPID) ──" IIFE from auth-modal.js:
  // syncToggleState on mount, subscribe()/unsubscribe() on click.
  const [pushOn, setPushOn] = useState(false);
  const [pushStatus, setPushStatus] = useState("");
  const [pushBusy, setPushBusy] = useState(false);
  const pushCapable = isPushSupported();

  async function syncPushToggleState() {
    const sub = await getCurrentPushSubscription();
    const perm = typeof Notification !== "undefined" ? Notification.permission : "default";
    const on = !!sub && perm === "granted";
    setPushOn(on);
    setPushStatus(
      on ? "✓ Push notifications enabled" : perm === "denied" ? "Notifications blocked — check browser settings" : ""
    );
  }

  useEffect(() => {
    if (!pushCapable) {
      // Matches the same isPushSupported() check the toggle's disabled/
      // dimmed state uses below — previously this only checked
      // `typeof Notification === "undefined"`, which is narrower than
      // isPushSupported() (also requires serviceWorker + PushManager).
      // That gap meant a browser/context missing just serviceWorker or
      // PushManager (some in-app/webview browsers, or a non-https
      // preview domain) showed the row dimmed and inert with no status
      // text at all explaining why.
      setPushStatus(
        typeof Notification === "undefined"
          ? "Notifications not supported."
          : "Push isn't supported in this browser — try opening the site in Chrome or Safari directly."
      );
      return;
    }
    syncPushToggleState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handlePushToggleClick() {
    if (!pushCapable) {
      setPushStatus("Push not supported in this browser.");
      return;
    }
    if (!user) {
      openAuthModal();
      return;
    }
    setPushBusy(true);
    try {
      if (pushOn) {
        await unsubscribeFromPush(user.uid);
        setPushOn(false);
        setPushStatus("");
      } else {
        setPushStatus("Requesting permission…");
        const result = await subscribeToPush(user.uid);
        setPushStatus(result.message);
        if (result.ok) setPushOn(true);
        else await syncPushToggleState();
      }
    } catch (err) {
      console.error("[push toggle]", err);
      setPushStatus("Could not update push notifications.");
      await syncPushToggleState();
    } finally {
      setPushBusy(false);
    }
  }

  return (
    <nav id="navDrawer" className={isOpen ? "open" : undefined}>
      <div className="nav-head">
        <div className="brand">
          <img
            src="/images/siterifty-logo.png"
            alt="Siterifty.com — Buy, Sell, Build, Trust"
          />
        </div>
        <button className="nav-close" id="navCloseBtn" aria-label="Close menu" onClick={closeNav}>
          &times;
        </button>
      </div>
      <div id="navScrollBody" ref={scrollBodyRef} data-scroll-lock-exempt>
        {/* Logged-out: locked account preview */}
        {!isLoggedIn && (
        <div className="nav-section" id="navAccountLoggedOut">
          <div className="nav-section-title">Account</div>
          <div className="nav-locked-blur">
            <div className="nav-user-card">
              <div className="nav-user-avatar">··</div>
              <div>
                <div className="nav-user-name">••••••••</div>
                <div className="nav-user-email">•••••@••••.com</div>
              </div>
            </div>
            <div className="nav-stat-row">
              <span>Wallet Balance</span>
              <span>$•••.••</span>
            </div>
            <div className="nav-stat-row">
              <span>Active Listings</span>
              <span>••</span>
            </div>
            <div className="nav-stat-row">
              <span>Plan</span>
              <span>•••••</span>
            </div>
          </div>
          <div className="nav-locked-cta">
            <p>Log in to see your wallet balance, stats and account details.</p>
            <button id="navLoginBtn" onClick={() => { closeNav(); openAuthModal(); }}>Log in / Sign up</button>
          </div>
        </div>
        )}

        {/* Logged-in: real account info */}
        {isLoggedIn && (
        <div className="nav-section" id="navAccountLoggedIn">
          <div className="nav-section-title">Account</div>
          <div
            className="nav-user-card"
            onClick={() => requireAuth(() => go("/myprofile"))}
            style={{ cursor: "pointer" }}
          >
            <div className="nav-user-avatar" id="navAvatar">
              {profile?.profilePic ? (
                <img
                  src={profile.profilePic}
                  alt=""
                  style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }}
                />
              ) : (
                (profile?.username || user?.email || "U").slice(0, 2).toUpperCase()
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                <div className="nav-user-name" id="navUserName">
                  {profile?.username || user?.email?.split("@")[0] || "User"}
                </div>
                <button
                  className="nav-my-profile-btn"
                  id="navManageProfileBtn"
                  onClick={(e) => {
                    e.stopPropagation();
                    requireAuth(() => go("/myprofile"));
                  }}
                >
                  My Profile
                </button>
              </div>
              <div className="nav-user-email" id="navUserEmail">{user?.email || ""}</div>
            </div>
          </div>
          <div className="nav-stat-row">
            <span className="nav-stat-label">
              Wallet<span className="nav-stat-val" id="navWalletBalance">${(profile?.walletBalance ?? 0).toFixed(2)}</span>
            </span>
            <button
              className="nav-stat-cta cta-topup"
              onClick={() => requireAuth(() => { closeNav(); openWallet(); })}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M12 5v14M5 12h14" strokeLinecap="round" />
              </svg>
              Top Up
            </button>
          </div>
          <div className="nav-stat-row">
            <span className="nav-stat-label">
              Listings<span className="nav-stat-val" id="navListingsCount">{listingsCount === null ? "0" : listingsCount}</span>
            </span>
            <button className="nav-stat-cta cta-list" onClick={() => requireAuth(() => go("/sell"))}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path
                  d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              List Now
            </button>
          </div>
          <div className="nav-stat-row">
            <span className="nav-stat-label">
              Plan<span className="nav-stat-val" id="navPlanName">{planName.replace(/^\w/, (c) => c.toUpperCase())}</span>
            </span>
            <button
              className={`nav-stat-cta ${isPaidPlan ? "cta-plan-manage" : "cta-plan-upgrade"}`}
              id="navPlanCta"
              onClick={() => requireAuth(() => { closeNav(); openPlansModal(); })}
            >
              {isPaidPlan ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
              {isPaidPlan ? "Manage" : "Upgrade"}
            </button>
          </div>
          <button
            className="nav-link"
            id="navDashboardBtn"
            style={{ marginTop: 8 }}
            onClick={() => requireAuth(() => go("/dashboard"))}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
            Dashboard
          </button>
          <button
            className="nav-link"
            id="navSettingsBtn"
            style={{ marginTop: 8 }}
            onClick={() => requireAuth(() => go("/settings"))}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
            Settings
          </button>
          <button
            className="nav-link"
            id="navChangeThemeBtn"
            style={{ marginTop: 2 }}
            onClick={() => { closeNav(); openThemePicker(); }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="13.5" cy="6.5" r="2.5" />
              <path d="M19.5 12.5L12 20l-8-8 7.5-7.5L19.5 12.5z" />
            </svg>
            Change theme
            <span className="nav-theme-thumbs">
              <img
                src="https://plus.unsplash.com/premium_photo-1673292293042-cafd9c8a3ab3?w=800&auto=format&fit=crop&q=60&ixlib=rb-4.1.0"
                alt=""
              />
              <img
                src="https://plus.unsplash.com/premium_photo-1711136314696-b27c2a148d55?q=80&w=774&auto=format&fit=crop&ixlib=rb-4.1.0"
                alt=""
              />
              <img
                src="https://plus.unsplash.com/premium_photo-1711434824963-ca894373272e?q=80&w=830&auto=format&fit=crop&ixlib=rb-4.1.0"
                alt=""
              />
            </span>
          </button>
          <button
            className="nav-link"
            id="navLogoutBtn"
            onClick={() => setConfirmingLogout(true)}
            style={{ marginTop: 2, color: "#f87171", opacity: 0.75 }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
              <path d="M16 17l5-5-5-5" />
              <path d="M21 12H9" />
            </svg>
            Log out
          </button>
        </div>
        )}

        <div className="nav-section">
          <div className="nav-section-title">Browse</div>
          <a href="/" className="nav-link" id="navHomeLink" onClick={(e) => { e.preventDefault(); go("/"); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M3 11l9-8 9 8" />
              <path d="M5 10v10a1 1 0 001 1h4a1 1 0 001-1v-5h2v5a1 1 0 001 1h4a1 1 0 001-1V10" />
            </svg>
            Home
          </a>
          <a href="/marketplace" className="nav-link" id="navMarketplaceLink" onClick={(e) => { e.preventDefault(); go("/marketplace"); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
            Marketplace
          </a>
          <a href="/blog" className="nav-link" id="navBlogLink" onClick={(e) => { e.preventDefault(); go("/blog"); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
            Blog
          </a>
          <a href="/sell" className="nav-link" id="navStartSellingLink" onClick={(e) => { e.preventDefault(); requireAuth(() => go("/sell")); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 2l3.5 7 7.5 1-5.5 5 1.5 7.5L12 18.5 5 22.5l1.5-7.5L1 8l7.5-1z" />
            </svg>
            Start Selling
          </a>
          <div
            className="nav-link nav-notif-row"
            id="navNotifRow"
            onClick={handlePushToggleClick}
            style={{ cursor: pushCapable ? "pointer" : "default", opacity: pushCapable ? 1 : 0.35, pointerEvents: pushBusy ? "none" : pushCapable ? "auto" : "none" }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              style={{ flexShrink: 0 }}
            >
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <span style={{ flex: 1 }}>Notifications</span>
            <div className={`nav-notif-toggle${pushOn ? " on" : ""}`} id="navNotifToggle" role="switch" aria-checked={pushOn}>
              <div className="nav-notif-thumb" id="navNotifThumb" />
            </div>
          </div>
          <div className="nav-notif-status" id="navNotifStatus">{pushStatus}</div>
        </div>

        <div className="nav-section">
          <div className="nav-section-title">Support</div>
          <a href="/about" className="nav-link" id="navAboutLink" onClick={(e) => { e.preventDefault(); go("/about"); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.5 9a2.5 2.5 0 015 .5c0 1.5-2 2-2 3.5" />
              <path d="M12 17h.01" />
            </svg>
            About Us
          </a>
          <a href="/contact" className="nav-link" id="navContactLink" onClick={(e) => { e.preventDefault(); go("/contact"); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 4h16v12H7l-3 3V4z" />
            </svg>
            Contact Us
          </a>
          <a href="/help" className="nav-link" id="navHelpLink" onClick={(e) => { e.preventDefault(); go("/help"); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.1 9a2.9 2.9 0 015.7.5c0 1.9-2.5 2.4-2.6 4.2" />
              <circle cx="12" cy="17.5" r="0.3" fill="currentColor" />
            </svg>
            Help Center
          </a>
          <a href="/how-it-works" className="nav-link" id="navHowItWorksLink" onClick={(e) => { e.preventDefault(); go("/how-it-works"); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="12" r="10" />
              <polygon points="10 8 16 12 10 16 10 8" />
            </svg>
            How It Works
          </a>
          <a href="/escrow" className="nav-link" id="navEscrowLink" onClick={(e) => { e.preventDefault(); go("/escrow"); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="3" y="11" width="18" height="10" rx="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
            Escrow &amp; Payments
          </a>
          <a href="/buyer-protection" className="nav-link" id="navBuyerProtectionLink" onClick={(e) => { e.preventDefault(); go("/buyer-protection"); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 2 3 6v6c0 5 3.5 9 9 10 5.5-1 9-5 9-10V6z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
            Buyer Protection
          </a>
          <a href="/terms" className="nav-link" id="navTermsLink" onClick={(e) => { e.preventDefault(); go("/terms"); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <path d="M14 2v6h6" />
            </svg>
            Terms &amp; Privacy
          </a>
          <a href="/privacy" className="nav-link" id="navPrivacyLink" onClick={(e) => { e.preventDefault(); go("/privacy"); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="4" y="10" width="16" height="10" rx="2" />
              <path d="M8 10V7a4 4 0 018 0v3" />
            </svg>
            Privacy Policy
          </a>
        </div>
        <div className="nav-footer">© 2026 Siterifty.com</div>
      </div>
      {/* /navScrollBody */}

      {/* Logout confirm modal — same real #logoutModalOverlay styling used
          in Settings/My Profile, rendered as a sibling of <nav> (not
          inside the drawer's own scroll body) so the drawer closing
          doesn't unmount or animate it away. */}
      {confirmingLogout ? (
        <div
          id="logoutModalOverlay"
          className="visible"
          onClick={() => !loggingOut && setConfirmingLogout(false)}
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
                onClick={() => setConfirmingLogout(false)}
                disabled={loggingOut}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </nav>
  );
}
