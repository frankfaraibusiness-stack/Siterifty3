"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { useNotifications, resolveNotificationTarget, type AppNotification } from "@/lib/notifications";
import NotificationToastStack from "./NotificationToastStack";
import MissedNotificationsPanel from "./MissedNotificationsPanel";

// Mounted once in app/layout.tsx, mirrors window.__startGlobalNotifyListener
// being wired to auth state in the original (started on sign-in, stopped
// on sign-out). Renders both the live toast stack and, once per session,
// the "missed while away" panel as soon as the initial backlog snapshot
// loads — same "don't wait for the user to open an inbox" behavior as
// __flushMissedNotifyToasts.
export default function NotificationsProvider() {
  const { user } = useAuth();
  const router = useRouter();
  const uid = user?.uid ?? null;
  const { live, missed, dismissLive, consumeMissed, markRead } = useNotifications(uid);

  const [missedPanelItems, setMissedPanelItems] = useState<AppNotification[] | null>(null);
  const [flushedThisSession, setFlushedThisSession] = useState(false);

  // Auto-open the missed panel exactly once per sign-in session, as
  // soon as there's anything to show — matches the original's
  // _ntfMissedShown guard (not re-triggered by later live arrivals,
  // since those go through the toast stack instead).
  useEffect(() => {
    if (flushedThisSession || missedPanelItems) return;
    if (missed.length > 0) {
      setFlushedThisSession(true);
      setMissedPanelItems(consumeMissed());
    }
  }, [missed, flushedThisSession, missedPanelItems, consumeMissed]);

  // Reset the once-per-session flag on sign-out/sign-in change.
  useEffect(() => {
    setFlushedThisSession(false);
    setMissedPanelItems(null);
  }, [uid]);

  function openTarget(n: AppNotification) {
    const target = resolveNotificationTarget(n);
    // NOTE: app/messages has no real chat-room deep link yet (see
    // notifications.ts's resolveNotificationTarget comment) — routing
    // to plain /messages is the best available destination today for
    // both "chat" and "inbox" targets. Once a real chat-room route
    // exists, only this line needs to change to consume
    // target.chatRoomId; the routing *decision* above is already correct.
    void target;
    router.push("/messages");
  }

  if (!uid) return null;

  return (
    <>
      <NotificationToastStack live={live} onDismiss={dismissLive} onOpen={openTarget} />
      {missedPanelItems && missedPanelItems.length > 0 && (
        <MissedNotificationsPanel
          items={missedPanelItems}
          onMarkRead={markRead}
          onOpen={openTarget}
          onClose={() => setMissedPanelItems(null)}
        />
      )}
    </>
  );
}
