"use client";

import { useEffect, useRef, useState } from "react";
import type { AppNotification } from "@/lib/notifications";
import { ntfIcon, ntfAccent, resolveNotificationTarget } from "@/lib/notifications";

// Ports the "while you were away" carousel from Js/notifications.js
// (__flushMissedNotifyToasts / _ntfRenderMissedCard / _ntfGoToMissedCard
// etc.), reusing the existing #ntfMissedPanel / .ntf-missed-* CSS
// already in globals.css. Same ids as the original markup since some
// of that CSS keys off #ntfMissedPanel directly, not just classes.
//
// Each card is marked read the moment it's actually shown (not the
// whole batch up front), so closing partway through the carousel
// leaves the rest queued for next time — same behavior as the
// original's per-card _ntfMarkRead call.
//
// `items` should be a stable snapshot (from useNotifications().consumeMissed()),
// not the live `missed` queue — paging must not jump around if a new
// notification arrives while the panel is open.
export default function MissedNotificationsPanel({
  items,
  onMarkRead,
  onOpen,
  onClose,
}: {
  items: AppNotification[];
  onMarkRead: (id: string) => void;
  onOpen: (n: AppNotification) => void;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(false);
  const markedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Mark the currently-shown card read exactly once, when it's shown —
  // mirrors _ntfRenderMissedCard's placement of _ntfMarkRead.
  useEffect(() => {
    const current = items[idx];
    if (!current || markedRef.current.has(current.id)) return;
    markedRef.current.add(current.id);
    onMarkRead(current.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, items]);

  if (!items.length) return null;
  const current = items[idx];
  const type = current.type || "message";
  const icon = ntfIcon(type);
  const accent = ntfAccent(type);
  const isChat = resolveNotificationTarget(current).kind === "chat";

  function close() {
    setVisible(false);
    setTimeout(onClose, 200);
  }

  function goTo(next: number) {
    if (next < 0 || next >= items.length) return;
    setIdx(next);
  }

  const maxDots = 8;

  return (
    <div
      id="ntfMissedPanel"
      style={{ display: "flex" }}
      className={visible ? "visible" : ""}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="ntf-missed-box">
        <div className="ntf-missed-header">
          <span className="ntf-missed-title">While you were away</span>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span className="ntf-missed-count">{items.length > 9 ? "9+" : items.length}</span>
            <button className="ntf-missed-close" onClick={close}>
              <svg viewBox="0 0 24 24">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="ntf-missed-card">
          <div
            className={`ntf-icon${icon.filled ? " filled" : ""}`}
            style={{ background: `color-mix(in srgb, ${accent} 16%, transparent)`, color: accent }}
          >
            <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: icon.svg }} />
          </div>
          <div className="ntf-missed-card-title">{current.title || "Notification"}</div>
          <div className="ntf-missed-card-text">{current.body || ""}</div>
        </div>

        <div className="ntf-missed-footer">
          <div className="ntf-missed-nav">
            <button className="ntf-missed-nav-btn" title="Previous" disabled={idx === 0} onClick={() => goTo(idx - 1)}>
              <svg viewBox="0 0 24 24">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <div className="ntf-missed-dots">
              {items.length <= maxDots ? (
                items.map((_, i) => (
                  <button
                    key={i}
                    className={`ntf-missed-dot${i === idx ? " active" : ""}`}
                    style={{ border: "none", cursor: "pointer", padding: 0 }}
                    onClick={() => goTo(i)}
                  />
                ))
              ) : (
                <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "rgba(255,255,255,0.45)" }}>
                  {idx + 1} / {items.length}
                </span>
              )}
            </div>
            <button
              className="ntf-missed-nav-btn"
              title="Next"
              disabled={idx === items.length - 1}
              onClick={() => goTo(idx + 1)}
            >
              <svg viewBox="0 0 24 24">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          </div>
          <button
            className="ntf-missed-cta"
            style={{ background: accent }}
            onClick={() => {
              close();
              onOpen(current);
            }}
          >
            {isChat ? "View" : "Open"}
          </button>
        </div>
      </div>
    </div>
  );
}
