"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import SettingsSidebar from "@/components/settings/SettingsSidebar";
import type { SettingsPanelId } from "@/components/settings/SettingsSidebar";
import { useSettingsState } from "@/lib/useSettingsState";
import { useAuth } from "@/lib/AuthContext";
import SignInRequired from "@/components/auth/SignInRequired";
import AccountPanel from "@/components/settings/panels/AccountPanel";
import SecurityPanel from "@/components/settings/panels/SecurityPanel";
import NotificationsPanel from "@/components/settings/panels/NotificationsPanel";
import AppearancePanel from "@/components/settings/panels/AppearancePanel";
import PrivacyPanel from "@/components/settings/panels/PrivacyPanel";
import BillingPanel from "@/components/settings/panels/BillingPanel";
import PaymentsPanel from "@/components/settings/panels/PaymentsPanel";
import ApiPanel from "@/components/settings/panels/ApiPanel";
import WebhooksPanel from "@/components/settings/panels/WebhooksPanel";
import SessionsPanel from "@/components/settings/panels/SessionsPanel";
import ReferralsPanel from "@/components/settings/panels/ReferralsPanel";
import AnalyticsPanel from "@/components/settings/panels/AnalyticsPanel";
import SellerBadgePanel from "@/components/settings/panels/SellerBadgePanel";
import DangerZonePanel from "@/components/settings/panels/DangerZonePanel";
import { useDisputePicker } from "@/components/dispute/DisputePickerProvider";

// Labels for panels not yet built, so the placeholder is specific rather
// than generic ("Appearance settings" not just "Coming soon").
const PANEL_LABELS: Record<SettingsPanelId, string> = {
  account: "Account",
  security: "Security",
  notifications: "Notifications",
  appearance: "Appearance",
  billing: "Billing & Plans",
  payments: "Payment Methods",
  api: "API & Integrations",
  webhooks: "Webhooks",
  privacy: "Privacy & Data",
  sessions: "Active Sessions",
  referrals: "Referrals",
  analytics: "Listing Analytics",
  sellerbadge: "Seller Badge",
  danger: "Danger Zone",
};

// "account" has no /settings/account-only path collision — plain
// /settings already means the Account panel, same convention as
// /myprofile meaning the "profile" tab. Every other panel gets its own
// /settings/{id} URL (see app/settings/[panel]/page.tsx).
const PANEL_PATHS: Partial<Record<SettingsPanelId, string>> = Object.fromEntries(
  Object.keys(PANEL_LABELS)
    .filter((id) => id !== "account")
    .map((id) => [id, `/settings/${id}`])
) as Partial<Record<SettingsPanelId, string>>;

export default function SettingsPageClient({ initialPanel }: { initialPanel: SettingsPanelId }) {
  const router = useRouter();
  const pathname = usePathname();
  const [activePanel, setActivePanel] = useState<SettingsPanelId>(initialPanel);
  const { user, loading: authLoading } = useAuth();
  const { state, setState, loading } = useSettingsState();
  const { openDisputePicker } = useDisputePicker();

  // Only matters ≤640px (see settings.css's max-width:640px block) —
  // above that both panes show side by side regardless and this is
  // ignored. "list" = sidebar full-width, panel hidden. "panel" =
  // sidebar hidden, panel full-width with a back button at the top.
  // Landing directly on a non-account panel URL (e.g. /settings/billing)
  // opens straight into panel view instead of making the user tap
  // through the list first.
  const [mobileView, setMobileView] = useState<"list" | "panel">(
    initialPanel === "account" ? "list" : "panel"
  );

  function selectPanel(panel: SettingsPanelId) {
    setActivePanel(panel);
    setMobileView("panel");
    const target = panel === "account" ? "/settings" : PANEL_PATHS[panel]!;
    if (pathname !== target) {
      router.push(target);
    }
  }

  // Each panel renders its own header (icon + title + description, see
  // e.g. AccountPanel's .detail-panel-header) at the very top of
  // .detail-panel. Without this, switching panels while scrolled down
  // keeps #detailPanel's old scrollTop, so the newly-selected panel's own
  // header/title never appears — it's just sitting off-screen above
  // whatever the scroll position happened to land on, making the panel
  // look header-less instead of merely scrolled.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      document.getElementById("detailPanel")?.scrollTo({ top: 0 });
      if (mobileView === "list") {
        document.getElementById("settingsSidebar")?.scrollTo({ top: 0 });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [activePanel, mobileView]);

  function renderPanel() {
    if (loading) {
      return <div style={{ opacity: 0.5, padding: "40px 0", textAlign: "center" }}>Loading…</div>;
    }
    switch (activePanel) {
      case "account":
        return <AccountPanel state={state} setState={setState} />;
      case "security":
        return <SecurityPanel state={state} setState={setState} />;
      case "notifications":
        return <NotificationsPanel state={state} setState={setState} />;
      case "appearance":
        return <AppearancePanel state={state} setState={setState} />;
      case "privacy":
        return <PrivacyPanel state={state} setState={setState} />;
      case "billing":
        return <BillingPanel state={state} setState={setState} />;
      case "payments":
        return <PaymentsPanel state={state} setState={setState} />;
      case "api":
        return <ApiPanel state={state} setState={setState} />;
      case "webhooks":
        return <WebhooksPanel state={state} setState={setState} />;
      case "sessions":
        return <SessionsPanel state={state} setState={setState} />;
      case "referrals":
        return <ReferralsPanel state={state} setState={setState} />;
      case "analytics":
        return <AnalyticsPanel state={state} setState={setState} />;
      case "sellerbadge":
        return <SellerBadgePanel state={state} setState={setState} />;
      case "danger":
        return <DangerZonePanel state={state} setState={setState} />;
      default:
        return (
          <div style={{ padding: "40px 0", textAlign: "center", opacity: 0.6 }}>
            <p>
              {PANEL_LABELS[activePanel]} is a separate step in the migration — not built yet.
            </p>
          </div>
        );
    }
  }

  // Direct visits (bookmark, deep link, browser back) have no prior
  // click to have already gated this behind requireAuth — same gap
  // /myprofile had before SignInRequired was added there (see that
  // page's own comment). auth.loading / user === undefined is the
  // "we don't know yet" state — same check useAuth's own docs specify —
  // so a page refresh doesn't flash the sign-in prompt for a visitor
  // who actually is signed in, just before their session resolves.
  if (authLoading || user === undefined) {
    return (
      <div
        style={{
          marginTop: 92,
          minHeight: "60vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "rgba(255,255,255,0.4)",
        }}
      >
        Loading…
      </div>
    );
  }

  if (!user) {
    return (
      <SignInRequired
        title="Sign in to view your settings"
        description="Your account, security, billing, and privacy settings are only visible once you're signed in."
      />
    );
  }

  return (
    <div
      style={{
        // Fixed-height contained view, same as the pre-existing pattern
        // used by every other two-pane app-shell page. marginTop:92
        // clears the real fixed Header (52px) + AnnouncementBar (40px) —
        // same 92px convention every other real page uses. height (not
        // minHeight) locks this wrapper to exactly the remaining
        // viewport: .main-content's flex:1 + .settings-sidebar's and
        // .detail-panel's own overflow-y:auto are what actually scroll,
        // not the document. The site-wide Footer is not rendered at all
        // on /settings (see ConditionalFooter.tsx) — a two-pane
        // sidebar+panel layout needs a genuinely fixed viewport height
        // for its internal scroll regions to work; letting the document
        // scroll instead breaks that, since nothing then keeps
        // .main-content clipped at its intended height.
        marginTop: 92,
        height: "calc(100dvh - 92px)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "var(--mp-bg, #050508)",
      }}
    >
      {/* Real site Header + AnnouncementBar (both fixed, 92px total)
          already provide navigation here — AnnouncementBar swaps its
          Upgrade/Manage-Plan button for a Back button on this route
          (see AnnouncementBar.tsx's onBackRoute). No page-local header
          needed. */}
      <div
        className="main-content"
        data-mobile-view={mobileView}
        style={{
          flex: 1,
          minHeight: 0,
        }}
      >
        <SettingsSidebar
          activePanel={activePanel}
          onSelectPanel={selectPanel}
          onRaiseDispute={openDisputePicker}
        />
        <div className="detail-panel" id="detailPanel">
          {/* Only visible ≤640px (settings.css hides it above that) —
              returns to the full-width sidebar list instead of the
              panel. Both panes stay mounted; this just flips
              data-mobile-view back to "list". */}
          <button
            type="button"
            className="settings-mobile-back-btn"
            onClick={() => setMobileView("list")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Settings
          </button>
          {renderPanel()}
        </div>
      </div>
    </div>
  );
}
