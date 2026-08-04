"use client";

import { signOut } from "firebase/auth";
import { useState } from "react";
import { auth } from "@/lib/firebase";

export type SettingsPanelId =
  | "account"
  | "security"
  | "notifications"
  | "appearance"
  | "billing"
  | "payments"
  | "api"
  | "webhooks"
  | "privacy"
  | "sessions"
  | "referrals"
  | "analytics"
  | "sellerbadge"
  | "danger";

interface NavItem {
  panel: SettingsPanelId;
  label: string;
  badge?: string;
  icon: React.ReactNode;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

// Ports the settings-sidebar markup exactly: same 5 sections, same 14
// items in the same order, same two badges (Security "2", Referrals "New").
const SECTIONS: NavSection[] = [
  {
    label: "General",
    items: [
      {
        panel: "account",
        label: "Account",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="8" r="4" />
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          </svg>
        ),
      },
      {
        panel: "security",
        label: "Security",
        badge: "2",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        ),
      },
      {
        panel: "notifications",
        label: "Notifications",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        ),
      },
      {
        panel: "appearance",
        label: "Appearance",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 2a10 10 0 0 1 0 20" />
          </svg>
        ),
      },
    ],
  },
  {
    label: "Business",
    items: [
      {
        panel: "billing",
        label: "Billing & Plans",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
            <line x1="1" y1="10" x2="23" y2="10" />
          </svg>
        ),
      },
      {
        panel: "payments",
        label: "Payment Methods",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <line x1="12" y1="1" x2="12" y2="23" />
            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
          </svg>
        ),
      },
    ],
  },
  {
    label: "Developer",
    items: [
      {
        panel: "api",
        label: "API & Integrations",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
        ),
      },
      {
        panel: "webhooks",
        label: "Webhooks",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
        ),
      },
    ],
  },
  {
    label: "Data",
    items: [
      {
        panel: "privacy",
        label: "Privacy & Data",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        ),
      },
      {
        panel: "sessions",
        label: "Active Sessions",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="3" y="3" width="18" height="18" rx="3" ry="3" />
            <line x1="3" y1="9" x2="21" y2="9" />
            <line x1="9" y1="21" x2="9" y2="9" />
          </svg>
        ),
      },
    ],
  },
  {
    label: "Growth",
    items: [
      {
        panel: "referrals",
        label: "Referrals",
        badge: "New",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
        ),
      },
      {
        panel: "analytics",
        label: "Listing Analytics",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <line x1="18" y1="20" x2="18" y2="10" />
            <line x1="12" y1="20" x2="12" y2="4" />
            <line x1="6" y1="20" x2="6" y2="14" />
          </svg>
        ),
      },
      {
        panel: "sellerbadge",
        label: "Seller Badge",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="8" r="6" />
            <path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11" />
          </svg>
        ),
      },
      {
        panel: "danger",
        label: "Danger Zone",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        ),
      },
    ],
  },
];

interface SettingsSidebarProps {
  activePanel: SettingsPanelId;
  onSelectPanel: (panel: SettingsPanelId) => void;
  onRaiseDispute: () => void;
}

export default function SettingsSidebar({ activePanel, onSelectPanel, onRaiseDispute }: SettingsSidebarProps) {
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  // Ports __logoutWithConfirm: confirm modal, then signOut(auth), then a
  // hard redirect home (a full reload, not client-side navigation — same
  // as the original's window.location.href, so no in-memory state from
  // this session lingers on screen).
  async function handleLogout() {
    setLoggingOut(true);
    try {
      await signOut(auth);
    } catch {
      // silent, matches original
    }
    window.location.href = window.location.origin + "/";
  }

  return (
    <>
      <nav className="settings-sidebar" id="settingsSidebar">
        {SECTIONS.map((section) => (
          <div key={section.label} style={{ display: "contents" }}>
            <span className="sidebar-section-label">{section.label}</span>
            {section.items.map((item) => (
              <button
                key={item.panel}
                type="button"
                className={`settings-nav-item${activePanel === item.panel ? " active" : ""}`}
                data-panel={item.panel}
                onClick={() => onSelectPanel(item.panel)}
              >
                {item.icon}
                {item.badge ? (
                  <>
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.label}
                    </span>
                    <span className="nav-badge">{item.badge}</span>
                  </>
                ) : (
                  item.label
                )}
              </button>
            ))}
          </div>
        ))}

        <div className="sidebar-footer">
          <button className="sidebar-footer-btn dispute" id="settingsDisputeBtn" onClick={onRaiseDispute}>
            <svg viewBox="0 0 24 24">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            Raise a Dispute
          </button>
          <button
            className="sidebar-footer-btn logout"
            id="settingsLogoutBtn"
            onClick={() => setConfirmingLogout(true)}
            disabled={loggingOut}
          >
            <svg viewBox="0 0 24 24">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Sign Out
          </button>
        </div>
      </nav>

      {/* Logout confirm modal — uses the real #logoutModalOverlay styling
          already defined in globals.css (previously dead CSS with no
          matching markup anywhere in the app). Rendered conditionally by
          React rather than toggled via a `.visible` class, so it mounts
          only while confirmingLogout is true — but still picks up all of
          #logoutModalOverlay/#logoutModalBox/.logout-modal-btn's styling
          since those are plain id/class selectors. */}
      {confirmingLogout ? (
        <div
          id="logoutModalOverlay"
          className="visible"
          onClick={() => !loggingOut && setConfirmingLogout(false)}
        >
          <div id="logoutModalBox" onClick={(e) => e.stopPropagation()}>
            <div id="logoutModalIconWrap">
              <svg viewBox="0 0 24 24">
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
                <svg viewBox="0 0 24 24">
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
    </>
  );
}
