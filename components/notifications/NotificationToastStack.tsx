"use client";

import { useEffect, useRef, useState } from "react";
import type { AppNotification } from "@/lib/notifications";
import { ntfIcon, ntfDuration } from "@/lib/notifications";

// Ports _ntfShowToast/_ntfDismiss from Js/notifications.js. Reuses the
// existing #ntfStack / .ntf-toast / .ntf-icon / .ntf-progress etc. CSS
// already in globals.css (see grep of .ntf-* classes) — same markup
// shape so those selectors and their show/leaving transitions apply
// unchanged.
//
// `live` is the queue of newly-arrived notifications from
// useNotifications(); each one auto-dismisses after its type's
// duration (or on click / close button), calling onDismiss(id) so the
// parent removes it from that queue.
export default function NotificationToastStack({
  live,
  onDismiss,
  onOpen,
}: {
  live: AppNotification[];
  onDismiss: (id: string) => void;
  onOpen: (n: AppNotification) => void;
}) {
  return (
    <div id="ntfStack">
      {live.map((n) => (
        <Toast key={n.id} notification={n} onDismiss={() => onDismiss(n.id)} onOpen={() => onOpen(n)} />
      ))}
    </div>
  );
}

function Toast({
  notification,
  onDismiss,
  onOpen,
}: {
  notification: AppNotification;
  onDismiss: () => void;
  onOpen: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const dismissedRef = useRef(false);
  const type = notification.type || "message";
  const icon = ntfIcon(type);
  const duration = ntfDuration(type);

  useEffect(() => {
    // Two rAFs, matching the original's double-rAF before adding
    // '.show' — lets the initial (unanimated) DOM insertion paint
    // first so the CSS transition into '.show' actually runs.
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf2);
    });
    const timer = setTimeout(() => dismiss(), duration);
    return () => {
      cancelAnimationFrame(raf1);
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function dismiss() {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    setVisible(false);
    setLeaving(true);
    setTimeout(onDismiss, 350);
  }

  return (
    <div
      className={`ntf-toast t-${type}${visible ? " show" : ""}${leaving ? " leaving" : ""}`}
      onClick={() => {
        dismiss();
        onOpen();
      }}
    >
      <div className={`ntf-icon${icon.filled ? " filled" : ""}`}>
        <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: icon.svg }} />
      </div>
      <div className="ntf-body">
        <div className="ntf-title">{notification.title || "Notification"}</div>
        <div className="ntf-text">{notification.body || ""}</div>
      </div>
      <button
        className="ntf-close"
        onClick={(e) => {
          e.stopPropagation();
          dismiss();
        }}
      >
        <svg viewBox="0 0 24 24">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
      <div className="ntf-progress" style={{ animationDuration: `${duration}ms` }} />
    </div>
  );
}
