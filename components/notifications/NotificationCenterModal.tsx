"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useScrollLock } from "@/lib/useScrollLock";
import {
  ntfIcon,
  ntfAccent,
  ntfToMillis,
  resolveNotificationTarget,
  useNotificationCenter,
  type AppNotification,
} from "@/lib/notifications";

// ══════════════════════════════════════════════════════════════════════
// Notification Center — rebuilt from scratch. Fullscreen, pure-black
// modal opened from the bell icon in the announcement bar. Same data
// contract as before (useNotificationCenter, day-grouping, type filter
// tabs, mark read / mark all read) — only the markup and styling are
// new, now themed off --mp-accent (see notifications.css) instead of a
// hardcoded green so it tracks the live accent color.
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

export default function NotificationCenterModal({
  uid,
  open,
  onClose,
}: {
  uid: string | null | undefined;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { items, loading, unreadCount, markRead, markAllRead } = useNotificationCenter(uid, open);
  const [visible, setVisible] = useState(false);
  const [filter, setFilter] = useState("all");

  useScrollLock(open);

  useEffect(() => {
    if (!open) {
      setVisible(false);
      return;
    }
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, [open]);

  if (!open) return null;

  function close() {
    setVisible(false);
    setTimeout(onClose, 200);
  }

  function handleOpenItem(n: AppNotification) {
    if (!n.read) void markRead(n.id);
    const target = resolveNotificationTarget(n);
    void target;
    close();
    router.push("/messages");
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
    <div
      id="notifCenterOverlay"
      className={visible ? "visible" : ""}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
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
            <button type="button" className="notif-center-close" onClick={close} aria-label="Close notifications">
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
