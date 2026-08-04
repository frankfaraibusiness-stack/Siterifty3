"use client";

import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { usePlansModal } from "@/components/billing/PlansModalProvider";
import NotificationBellButton from "@/components/notifications/NotificationBellButton";

// Ports the announcement-bar half of announcement-settings.js (index.html
// lines 3-28): plan badge label/class + the Upgrade (free plan) or
// Manage Plan (paid plan) action button. Both open PlansModalProvider's
// modal — one of its 5 original trigger points (see that provider's own
// top-of-file comment), the last of which wasn't wired up until now.
const PLAN_META: Record<string, { label: string; cls: string }> = {
  free: { label: "Free", cls: "plan-free" },
  starter: { label: "Starter", cls: "plan-starter" },
  growth: { label: "Growth", cls: "plan-growth" },
  pro: { label: "Pro", cls: "plan-pro" },
};

export default function AnnouncementBar() {
  const { user, profile } = useAuth();
  const { openPlansModal } = usePlansModal();
  const pathname = usePathname();
  const router = useRouter();

  const displayName = user
    ? profile?.username || user.email?.split("@")[0] || "User"
    : "Guest";
  const plan = profile?.plan || "free";
  const meta = PLAN_META[plan] || PLAN_META.free;

  // On /upgrade and /donate/[id] the Upgrade/Manage Plan button here
  // would just duplicate a CTA already on the page itself (the plan
  // cards on /upgrade, the donate form on /donate). Rather than leave
  // that slot empty, it's swapped for a Back button in the exact same
  // spot — so those pages get in-flow back navigation instead of it
  // floating loose in the page body. /myprofile and /settings get the
  // same treatment: both used to render their own separate PanelHeader
  // (duplicate hamburger+logo row) instead of just using this bar, which
  // is why they never picked up the marginTop:92 every other real page
  // uses to clear the fixed header+announcement-bar — see MyProfileHub.tsx
  // and app/settings/page.tsx for that fix.
  const isProfileRoute = pathname === "/myprofile";
  const isSettingsRoute = pathname === "/settings";
  const onBackRoute = pathname === "/upgrade" || pathname?.startsWith("/donate/") || isProfileRoute || isSettingsRoute;

  // /myprofile can be reached from many different places (a listing
  // card's seller avatar, a notification, a deep link), so router.back()
  // there could land anywhere, including a non-Siterifty referrer with
  // an empty history stack. Always going home is the one predictable
  // destination. /settings and /upgrade/donate keep normal router.back()
  // — those are reached from a small, predictable set of places (mostly
  // the profile hub itself), so "wherever I came from" is the more
  // useful behavior there.
  function handleBack() {
    if (isProfileRoute) {
      router.push("/");
    } else {
      router.back();
    }
  }

  return (
    <div id="announcement-bar" data-plan={plan}>
      <div className="ab-left">
        <NotificationBellButton uid={user?.uid} />
        <span className="ab-username" id="ab-user">
          {displayName}
        </span>
        <span className={`plan-badge ${meta.cls}`} id="ab-badge">
          {meta.label}
        </span>
      </div>
      {/* Unread-messages / notifications action slot, driven by Js/inbox.js
          originally — wired up in a later step. */}
      <div id="ab-action">
        {onBackRoute ? (
          <button className="ab-back" onClick={handleBack} aria-label="Go back">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            Back
          </button>
        ) : plan === "free" ? (
          <div className="btn-upgrade-wrap">
            <button className="btn-upgrade" onClick={() => openPlansModal()}>
              <svg
                className="upgrade-icon"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  className="star"
                  d="M12 2.5l2.6 5.3 5.9.86-4.25 4.14 1 5.88L12 16.1l-5.25 2.58 1-5.88L3.5 8.66l5.9-.86z"
                  fill="rgba(216,180,254,0.95)"
                  stroke="rgba(167,139,250,0.5)"
                  strokeWidth="0.5"
                  strokeLinejoin="round"
                />
              </svg>
              Upgrade
            </button>
          </div>
        ) : (
          <button className="btn-manage" onClick={() => openPlansModal()}>
            Manage Plan
          </button>
        )}
      </div>
    </div>
  );
}
