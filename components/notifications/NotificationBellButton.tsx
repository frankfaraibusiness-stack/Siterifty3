"use client";

import { useRouter } from "next/navigation";
import { useUnreadNotificationCount } from "@/lib/notifications";

// Bell icon shown at the left of the announcement bar, before the
// username/plan badge. Navigates to /notifications/panel on tap — a real
// route instead of rendering NotificationCenterModal inline here. That
// inline modal used to render as a nested child of the announcement bar,
// which put its `position: fixed; inset: 0` backdrop inside the
// announcement bar's own stacking context — the backdrop could then fail
// to actually paint as opaque, showing whatever was behind it instead of
// its intended solid black panel. A real page sidesteps that whole class
// of bug rather than patching around it with a portal.
export default function NotificationBellButton({ uid }: { uid: string | null | undefined }) {
  const unread = useUnreadNotificationCount(uid);
  const router = useRouter();

  if (!uid) return null;

  return (
    <button
      className="ab-bell-btn"
      onClick={() => router.push("/notifications/panel")}
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      {unread > 0 && <span className="ab-bell-badge">{unread > 9 ? "9+" : unread}</span>}
    </button>
  );
}
