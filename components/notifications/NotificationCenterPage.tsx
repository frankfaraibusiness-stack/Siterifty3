"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import SignInRequired from "@/components/auth/SignInRequired";
import {
  ntfIcon,
  ntfAccent,
  ntfToMillis,
  resolveNotificationTarget,
  useNotificationCenter,
  type AppNotification,
} from "@/lib/notifications";
import { useState } from "react";

// ══════════════════════════════════════════════════════════════════════
// Notification Center — now a real route at /notifications/panel instead
// of a modal rendered inline inside NotificationBellButton (which lives
// inside the announcement bar). That inline placement put
// #notifCenterOverlay's `position: fixed; inset: 0` inside the
// announcement bar's own stacking context, so its solid #000 backdrop
// could fail to actually paint as an opaque full-viewport layer — the
// bug this page exists to fix (see NotificationBellButton.tsx, which now
// just navigates here instead of rendering the old modal). Same data
// contract as before (useNotificationCenter, day-grouping, type filter
// tabs, mark read / mark all read); only the mount point changed —
// "close" is now router.back()/push("/") instead of an onClose prop, and
// uid comes from useAuth() directly instead of being passed in.
// ══════════════════════════════════════════════════════════════════════

function dayLabel(ms: number): string {
  if (!ms) return "Earlier";
  const d = new Date(ms);
  const now = new Date();
  const startOfDay = (dt: Date) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: diffDays > 300 ? "numeric" : undefined });
}

function timeLabel(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

const TYPE_FILTERS: { id: string; label: string; match: (t: string) => boolean }[] = [
  { id: "all", label: "All", match: () => true },
  { id: "messages", label: "Messages", match: (t) => t === "message" },
  {
    id: "deals",
    label: "Deals",
    match: (t) => t === "deal_accepted" || t === "deal_rejected" || t === "deal_request" || t === "deal_sent",
  },
  {
    id: "payments",
    label: "Payments",
    match: (t) =>
      t === "payment_reminder" ||
      t === "escrow_funded" ||
      t === "escrow_released" ||
      t === "escrow_refunded" ||
      t === "deal_delivered" ||
      t === "deal_disputed",
  },
];

export default function NotificationCenterPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const uid = user?.uid ?? null;
  const { items, loading, unreadCount, markRead, markAllRead } = useNotificationCenter(uid, true);
  const [filter, setFilter] = useState("all");

  function goBack() {
    if (window.history.length > 1) router.back();
    else router.push("/");
  }

  function handleOpenItem(n: AppNotification) {
    if (!n.read) void markRead(n.id);
    const target = resolveNotificationTarget(n);
    void target;
    router.push("/messages");
  }

  if (!authLoading && !uid) {
    return (
      <div className="notif-center-page" style={{ marginTop: 92, minHeight: "calc(100vh - 92px)" }}>
        <div className="notif-center-panel">
          <header className="notif-center-header">
            <div className="notif-center-title-row">
              <h2>Notifications</h2>
            </div>
            <div className="notif-center-actions">
              <button type="button" className="notif-center-close" onClick={goBack} aria-label="Close notifications">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </header>
          <SignInRequired
            fullScreen={false}
            title="Sign in to see your notifications"
            description="Deal offers, messages, and payment updates are only visible once you're signed in."
          />
        </div>
      </div>
    );
  }

  const activeFilter = TYPE_FILTERS.find((f) => f.id === filter) || TYPE_FILTERS[0];
  const filtered = items.filter((n) => activeFilter.match(n.type || "message"));

  const groups: { label: string; rows: AppNotification[] }[] = [];
  for (const n of filtered) {
    const label = dayLabel(ntfToMillis(n.createdAt));
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.rows.push(n);
    else groups.push({ label, rows: [n] });
  }

  return (
    <div className="notif-center-page" style={{ marginTop: 92, minHeight: "calc(100vh - 92px)" }}>
      <div className="notif-center-panel">
        <header className="notif-center-header">
          <div className="notif-center-title-row">
            <h2>Notifications</h2>
            {unreadCount > 0 && (
              <span className="notif-center-badge">{unreadCount > 9 ? "9+" : unreadCount} new</span>
            )}
          </div>
          <div className="notif-center-actions">
            {unreadCount > 0 && (
              <button type="button" className="notif-center-markall" onClick={() => markAllRead()}>
                Mark all read
              </button>
            )}
            <button type="button" className="notif-center-close" onClick={goBack} aria-label="Close notifications">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </header>

        <nav className="notif-center-tabs" aria-label="Filter notifications">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={"notif-center-tab" + (filter === f.id ? " active" : "")}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </nav>

        <div className="notif-center-list">
          {loading && items.length === 0 ? (
            <div className="notif-center-empty">
              <div className="notif-center-spinner" />
              <p>Loading your notifications…</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="notif-center-empty">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1.6">
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              <p>Nothing here yet</p>
              <span>Deal offers, messages, and payment updates will show up here.</span>
            </div>
          ) : (
            groups.map((group) => (
              <div className="notif-center-group" key={group.label}>
                <div className="notif-center-day-label">{group.label}</div>
                {group.rows.map((n) => {
                  const type = n.type || "message";
                  const icon = ntfIcon(type);
                  const accent = ntfAccent(type);
                  const ms = ntfToMillis(n.createdAt);
                  return (
                    <button
                      key={n.id}
                      type="button"
                      className={"notif-center-row" + (!n.read ? " unread" : "")}
                      onClick={() => handleOpenItem(n)}
                    >
                      <div
                        className={"ntf-icon" + (icon.filled ? " filled" : "")}
                        style={{ background: `color-mix(in srgb, ${accent} 16%, transparent)`, color: accent }}
                      >
                        <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: icon.svg }} />
                      </div>
                      <div className="notif-center-row-body">
                        <div className="notif-center-row-title">
                          {n.title || "Notification"}
                          {!n.read && <span className="notif-center-dot" />}
                        </div>
                        {n.body && <div className="notif-center-row-text">{n.body}</div>}
                      </div>
                      <div className="notif-center-row-time">{timeLabel(ms)}</div>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
