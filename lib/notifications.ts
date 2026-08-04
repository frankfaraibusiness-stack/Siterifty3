"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// Data layer for users/{uid}/notifications — direct client Firestore
// read/listen, no server API involved (same as the original: a
// per-user subcollection the client subscribes to directly, access
// controlled by Firestore rules). Ports the config tables and
// subscription/mark-read logic from Js/notifications.js; the toast +
// "missed while away" carousel UI built on top of this live in
// components/notifications/.

export type NotificationType =
  | "deal_accepted"
  | "deal_rejected"
  | "deal_request"
  | "deal_sent"
  | "message"
  | "payment_reminder"
  | "escrow_funded"
  | "deal_delivered"
  | "escrow_released"
  | "escrow_refunded"
  | "deal_disputed";

export interface AppNotification {
  id: string;
  type: NotificationType | string;
  title?: string;
  body?: string;
  read?: boolean;
  createdAt?: unknown;
  chatRoomId?: string;
  chatName?: string;
  sellerUid?: string;
  buyerUid?: string;
  expiresAt?: unknown;
}

// Icon path data + accent color + toast duration per type — ported
// verbatim from Js/notifications.js's NTF_ICONS/NTF_ACCENTS/NTF_DURATIONS.
export const NTF_ICONS: Record<string, { svg: string; filled: boolean }> = {
  deal_accepted: { svg: '<path d="M20 6L9 17l-5-5"/>', filled: false },
  deal_rejected: { svg: '<path d="M18 6L6 18M6 6l12 12"/>', filled: false },
  deal_request: {
    svg: '<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>',
    filled: false,
  },
  deal_sent: { svg: '<path d="M22 2L11 13"/><path d="M22 2L15 22 11 13 2 9 22 2"/>', filled: false },
  message: {
    svg: '<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>',
    filled: false,
  },
  payment_reminder: {
    svg: '<rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>',
    filled: false,
  },
  escrow_funded: { svg: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>', filled: false },
  deal_delivered: {
    svg: '<rect x="3" y="3" width="18" height="14" rx="2"/><path d="M3 9h18"/><path d="M9 21l3-3 3 3"/>',
    filled: false,
  },
  escrow_released: {
    svg: '<path d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>',
    filled: false,
  },
  escrow_refunded: { svg: '<path d="M9 14l-4-4 4-4"/><path d="M5 10h11a4 4 0 010 8h-1"/>', filled: false },
  deal_disputed: {
    svg:
      '<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    filled: false,
  },
};

export const NTF_ACCENTS: Record<string, string> = {
  deal_accepted: "#a3e635",
  deal_rejected: "#f87171",
  deal_request: "#60a5fa",
  deal_sent: "#60a5fa",
  message: "#c084fc",
  payment_reminder: "#fbbf24",
  escrow_funded: "#a3e635",
  deal_delivered: "#60a5fa",
  escrow_released: "#a3e635",
  escrow_refunded: "#60a5fa",
  deal_disputed: "#f87171",
};

export const NTF_DURATIONS: Record<string, number> = {
  deal_accepted: 5000,
  deal_rejected: 5000,
  deal_request: 3000,
  message: 3000,
  payment_reminder: 4000,
  escrow_funded: 5000,
  deal_delivered: 5000,
  escrow_released: 5000,
  escrow_refunded: 5000,
  deal_disputed: 6000,
};

const DEFAULT_DURATION = 4000;

export function ntfIcon(type: string) {
  return NTF_ICONS[type] || NTF_ICONS.message;
}
export function ntfAccent(type: string) {
  return NTF_ACCENTS[type] || "#a3e635";
}
export function ntfDuration(type: string) {
  return NTF_DURATIONS[type] || DEFAULT_DURATION;
}

export function ntfToMillis(v: unknown): number {
  if (!v) return 0;
  if (typeof v === "number") return v;
  const obj = v as { toMillis?: () => number; seconds?: number };
  if (typeof obj.toMillis === "function") return obj.toMillis();
  if (typeof obj.seconds === "number") return obj.seconds * 1000;
  return 0;
}

// ── Click-routing decision ───────────────────────────────────────────
//
// BUGFIX vs the original: Js/notifications.js's _ntfHandleClick only
// routed to the specific deal chat for types in a fixed NTF_OPENS_CHAT
// allowlist, AND only when data.chatRoomId happened to be present —
// every other case (including any chat-carrying notification that
// somehow fell outside that allowlist) fell through to opening the
// generic inbox with no way to reach the actual related thread. The
// fix here is data-driven instead of type-allowlist-driven: ANY
// notification that actually carries a chatRoomId routes to that
// specific chat, regardless of its `type`; only a notification with no
// chatRoomId at all falls back to the generic inbox. This can't
// silently misroute a new/renamed type the way a hardcoded Set could.
//
// This only returns the *decision* (chat vs inbox + the chatRoomId),
// not a URL — app/messages has no real chat-room route yet to link
// into, so building a URL here would be dead code until that page
// exists. Whatever opens app/messages next can consume this directly.
export type NotificationTarget =
  | { kind: "chat"; chatRoomId: string; chatName?: string; sellerUid?: string; buyerUid?: string; expiresAt?: unknown }
  | { kind: "inbox" };

export function resolveNotificationTarget(n: AppNotification): NotificationTarget {
  if (n.chatRoomId) {
    return {
      kind: "chat",
      chatRoomId: n.chatRoomId,
      chatName: n.chatName,
      sellerUid: n.sellerUid,
      buyerUid: n.buyerUid,
      expiresAt: n.expiresAt,
    };
  }
  return { kind: "inbox" };
}

// ── Live subscription ────────────────────────────────────────────────
//
// Mirrors window.__startGlobalNotifyListener/__stopGlobalNotifyListener:
// one onSnapshot on users/{uid}/notifications ordered newest-first,
// capped at 30. Splits incoming docs into two buckets on first snapshot
// vs later ones — first snapshot = existing unread backlog ("missed
// while away"), later additions/modifications with createdAt at or
// after subscribe-time = live, toast immediately. Already-read docs are
// tracked as seen and never toasted or queued.
export interface UseNotificationsResult {
  live: AppNotification[]; // newly arrived while subscribed — for the toast stack
  missed: AppNotification[]; // unread backlog from before this session — for the "missed" panel
  dismissLive: (id: string) => void;
  consumeMissed: () => AppNotification[]; // snapshot + clear the missed queue, for the panel to page through
  markRead: (id: string) => Promise<void>;
}

export function useNotifications(uid: string | null | undefined): UseNotificationsResult {
  const [live, setLive] = useState<AppNotification[]>([]);
  const [missed, setMissed] = useState<AppNotification[]>([]);
  const seenIds = useRef<Set<string>>(new Set());
  const sessionStart = useRef<number>(0);
  const firstSnap = useRef<boolean>(true);

  useEffect(() => {
    if (!uid) {
      setLive([]);
      setMissed([]);
      return;
    }

    seenIds.current = new Set();
    sessionStart.current = Date.now();
    firstSnap.current = true;
    setLive([]);
    setMissed([]);

    let unsub: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      const { collection, query, limit, onSnapshot } = await import("firebase/firestore");
      const { db } = await import("@/lib/firebase");
      if (cancelled) return;

      // No orderBy() — see the matching comment in useNotificationCenter
      // above for why: it silently excludes any doc missing the field
      // being sorted on, which some older/malformed notification docs do.
      // docChanges() below doesn't care about server-side order, so
      // dropping orderBy costs nothing here and fixes the same class of
      // "notification exists but never appears" gap this hook had too.
      const q = query(collection(db, "users", uid, "notifications"), limit(30));

      unsub = onSnapshot(
        q,
        (snap) => {
          const newlyMissed: AppNotification[] = [];
          const newlyLive: AppNotification[] = [];

          snap.docChanges().forEach((change) => {
            if (change.type !== "added" && change.type !== "modified") return;
            const d = change.doc;
            const data = d.data() as Omit<AppNotification, "id">;
            if (seenIds.current.has(d.id)) return;
            if (data.read) {
              seenIds.current.add(d.id);
              return;
            }

            const createdAtMs = ntfToMillis(data.createdAt);

            if (!firstSnap.current && createdAtMs >= sessionStart.current) {
              seenIds.current.add(d.id);
              newlyLive.push({ id: d.id, ...data });
            } else {
              newlyMissed.push({ id: d.id, ...data });
            }
          });

          if (newlyLive.length) setLive((prev) => [...newlyLive, ...prev]);
          if (newlyMissed.length) {
            setMissed((prev) => {
              const merged = [...prev];
              for (const item of newlyMissed) {
                if (!merged.find((m) => m.id === item.id)) merged.push(item);
              }
              merged.sort((a, b) => ntfToMillis(b.createdAt) - ntfToMillis(a.createdAt));
              return merged;
            });
          }

          firstSnap.current = false;
        },
        (err) => {
          console.error("[useNotifications] listener error:", err);
        }
      );
    })();

    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [uid]);

  const dismissLive = useCallback((id: string) => {
    setLive((prev) => prev.filter((n) => n.id !== id));
  }, []);

  // Snapshots the current missed queue for the panel to page through
  // (stable while paging even if new live notifications arrive), then
  // clears it — mirrors the original's _ntfMissedItems/_ntfMissedQueue
  // split.
  const consumeMissed = useCallback((): AppNotification[] => {
    let snapshot: AppNotification[] = [];
    setMissed((prev) => {
      snapshot = prev.slice(0, 20);
      return [];
    });
    return snapshot;
  }, []);

  const markRead = useCallback(
    async (id: string) => {
      if (!uid) return;
      try {
        const { doc, updateDoc } = await import("firebase/firestore");
        const { db } = await import("@/lib/firebase");
        await updateDoc(doc(db, "users", uid, "notifications", id), { read: true });
      } catch {
        /* non-fatal — mirrors the original's silent catch */
      }
    },
    [uid]
  );

  return { live, missed, dismissLive, consumeMissed, markRead };
}

// ── Full notification center list ────────────────────────────────────
//
// Separate from useNotifications() above, which only exists to feed the
// toast stack + "missed while away" carousel and intentionally never
// exposes already-read items. The notification center (bell icon in the
// announcement bar) needs the full recent history — read and unread —
// so sellers/buyers can review deals and messages they've already seen,
// not just what's new. Ordered newest-first, capped at 50.
export interface UseNotificationCenterResult {
  items: AppNotification[];
  loading: boolean;
  unreadCount: number;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

export function useNotificationCenter(uid: string | null | undefined, active: boolean): UseNotificationCenterResult {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!uid || !active) return;
    let cancelled = false;
    setLoading(true);

    let unsub: (() => void) | undefined;
    (async () => {
      const { collection, query, limit, onSnapshot } = await import("firebase/firestore");
      const { db } = await import("@/lib/firebase");
      if (cancelled) return;

      // Deliberately no orderBy() here. Firestore's orderBy(field) drops
      // any document where that field is missing/undefined entirely from
      // the result set — silently, no error. Some notification docs (older
      // ones, or ones written by a path that predates createdAt being
      // required) don't have it, so an orderBy("createdAt") query was
      // returning zero results for real users while the separate
      // where("read","==",false) count query (no orderBy, so nothing gets
      // excluded) kept counting them fine — exactly the "badge shows a
      // number but the list is empty" symptom this was fixing. Sorting is
      // done client-side below instead, which never excludes anything.
      const q = query(collection(db, "users", uid, "notifications"), limit(50));
      unsub = onSnapshot(
        q,
        (snap) => {
          if (cancelled) return;
          const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AppNotification, "id">) }));
          rows.sort((a, b) => ntfToMillis(b.createdAt) - ntfToMillis(a.createdAt));
          setItems(rows);
          setLoading(false);
        },
        (err) => {
          console.error("[useNotificationCenter] listener error:", err);
          if (!cancelled) setLoading(false);
        }
      );
    })();

    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [uid, active]);

  const unreadCount = items.filter((n) => !n.read).length;

  const markRead = useCallback(
    async (id: string) => {
      if (!uid) return;
      try {
        const { doc, updateDoc } = await import("firebase/firestore");
        const { db } = await import("@/lib/firebase");
        await updateDoc(doc(db, "users", uid, "notifications", id), { read: true });
      } catch {
        /* non-fatal */
      }
    },
    [uid]
  );

  const markAllRead = useCallback(async () => {
    if (!uid) return;
    const unread = items.filter((n) => !n.read);
    if (!unread.length) return;
    try {
      const { doc, writeBatch } = await import("firebase/firestore");
      const { db } = await import("@/lib/firebase");
      const batch = writeBatch(db);
      unread.forEach((n) => batch.update(doc(db, "users", uid, "notifications", n.id), { read: true }));
      await batch.commit();
    } catch {
      /* non-fatal */
    }
  }, [uid, items]);

  return { items, loading, unreadCount, markRead, markAllRead };
}

// Lightweight unread-count-only hook for the bell badge in the
// announcement bar — subscribes independently of whether the full
// notification center modal is open, so the badge stays live in the
// background. Capped at 50 like the center itself; "9+" display is
// handled by the component, not here.
export function useUnreadNotificationCount(uid: string | null | undefined): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!uid) {
      setCount(0);
      return;
    }
    let cancelled = false;
    let unsub: (() => void) | undefined;

    (async () => {
      const { collection, query, where, onSnapshot } = await import("firebase/firestore");
      const { db } = await import("@/lib/firebase");
      if (cancelled) return;

      const q = query(collection(db, "users", uid, "notifications"), where("read", "==", false));
      unsub = onSnapshot(
        q,
        (snap) => {
          if (!cancelled) setCount(snap.size);
        },
        (err) => {
          console.error("[useUnreadNotificationCount] listener error:", err);
        }
      );
    })();

    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [uid]);

  return count;
}
