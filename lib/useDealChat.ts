"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  doc,
  getDoc,
  updateDoc,
  addDoc,
  deleteDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

// Ports the deal chat panel's data/state layer from Js/inbox.js
// (lines 937-2774 — everything after the inbox shell). Same Firestore
// paths (dealChats/{id}, dealChats/{id}/messages, users/{uid}/threads),
// same /api/deal escrow actions, same field names, same staleness-guard
// approach (generation counter) adapted to React's effect-cleanup model
// instead of a manually-tracked module-level _chatOpenGen.

export type PaymentStatus = "unfunded" | "funded" | "delivered" | "disputed" | "complete" | "refunded";

// How long a seller must wait before sending another payment-request
// reminder to the buyer for the same deal. Previously paymentRequestPending
// was a one-way flag that only ever got set, never cleared on its own —
// so once a seller sent one reminder, they were blocked from ever sending
// another for that deal (a lifetime-1 limit, not an anti-spam cooldown).
// Now it's a rolling window off paymentRequestedAt: sending is allowed
// again once this many ms have passed since the last request, still
// blocking rapid repeat sends without permanently locking the seller out.
const PAYMENT_REQUEST_COOLDOWN_MS = 60 * 60 * 1000;

export interface DealMessage {
  id: string;
  uid: string;
  type: "text" | "system" | "image" | "link" | "file" | "transfer_zip";
  text?: string;
  createdAt: number;
  imageUrl?: string;
  linkUrl?: string;
  linkTitle?: string;
  linkThumb?: string;
  fileName?: string;
  fileUrl?: string;
  storagePath?: string;
  fileSize?: number;
  items?: string[];
  fileCount?: number;
  senderName?: string;
  senderPic?: string;
  isBot?: boolean;
  aiWarning?: string;
}

export interface DealChatRoom {
  chatRoomId: string;
  chatName: string;
  sellerUid: string | null;
  buyerUid: string | null;
  expiresAt: number | null;
  listingId: string;
  listingTitle: string;
  listingImage: string;
  listingPrice: number | null;
  dealId: string | null;
  paymentStatus: PaymentStatus;
  escrowAmount: number | null;
  autoReleaseAt: number | null;
  transferMethods: string[];
  cancelled: boolean;
  active: boolean;
  cancelledBy: string | null;
  cancelledAt: number | null;
  deleteAt: number | null;
  autoCompleted: boolean;
  autoCancelled: boolean;
  // Set only by the server's deadline-expiry paths (see app/api/deal/
  // _handler.js's _cancelUnfundedExpiredRoom and the expiry branch of
  // _refundEscrowForRoom) — never by a manual in-chat cancel and never by
  // a successful completion. This is the single source of truth for
  // whether Reopen Deal should be offered; cancelled alone isn't enough,
  // since a manually-cancelled deal is also cancelled: true.
  expiryCancelled: boolean;
  paymentRequestPending: boolean;
  paymentRequestedAt: number | null;
}

function toMillis(v: unknown): number | null {
  if (!v) return null;
  if (typeof v === "number") return v;
  const t = v as { toMillis?: () => number; seconds?: number };
  if (typeof t.toMillis === "function") return t.toMillis();
  if (typeof t.seconds === "number") return t.seconds * 1000;
  return null;
}

function messageFromDoc(id: string, m: Record<string, unknown>): DealMessage {
  return {
    id,
    uid: (m.uid as string) || "",
    type: (m.type as DealMessage["type"]) || "text",
    text: m.text as string | undefined,
    createdAt: toMillis(m.createdAt) || 0,
    imageUrl: m.imageUrl as string | undefined,
    linkUrl: m.linkUrl as string | undefined,
    linkTitle: m.linkTitle as string | undefined,
    linkThumb: m.linkThumb as string | undefined,
    fileName: m.fileName as string | undefined,
    fileUrl: m.fileUrl as string | undefined,
    storagePath: m.storagePath as string | undefined,
    fileSize: m.fileSize as number | undefined,
    items: m.items as string[] | undefined,
    fileCount: m.fileCount as number | undefined,
    senderName: m.senderName as string | undefined,
    senderPic: m.senderPic as string | undefined,
    isBot: m.isBot as boolean | undefined,
    aiWarning: m.aiWarning as string | undefined,
  };
}

export function useDealChat(chatRoomId: string) {
  const [room, setRoom] = useState<DealChatRoom | null>(null);
  const [messages, setMessages] = useState<DealMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [chatError, setChatError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [locked, setLocked] = useState<{ locked: boolean; reason: string | null }>({ locked: false, reason: null });
  const [outcome, setOutcome] = useState<{ outcome: "successful" | "closed"; auto: boolean; expiryCancelled: boolean } | null>(null);

  const outcomeShown = useRef(false);
  const lastStatus = useRef<PaymentStatus | null>(null);

  // ── Load the room doc + subscribe to it live ──
  useEffect(() => {
    if (!chatRoomId) return;
    let cancelled = false;
    outcomeShown.current = false;
    lastStatus.current = null;
    setRoom(null);
    setOutcome(null);
    setChatError(null);

    async function init() {
      // First paint from a direct fetch (fast first render), then the
      // onSnapshot listener below keeps it live — same "instant paint,
      // then live" idea as the original's localStorage-cache-first approach.
      try {
        const snap = await getDoc(doc(db, "dealChats", chatRoomId));
        if (cancelled) return;
        if (snap.exists()) applyRoomData(snap.data());
      } catch (e) {
        console.warn("[useDealChat] initial room fetch failed", e);
      }
    }

    function applyRoomData(r: Record<string, unknown>) {
      if (cancelled) return;
      const status = ((r.paymentStatus as string) || "unfunded") as PaymentStatus;
      const nextRoom: DealChatRoom = {
        chatRoomId,
        chatName: (r.chatName as string) || "",
        sellerUid: (r.sellerUid as string) || null,
        buyerUid: (r.buyerUid as string) || null,
        expiresAt: (r.expiresAt as number) || null,
        listingId: (r.listingId as string) || "",
        listingTitle: (r.listingTitle as string) || "",
        listingImage: (r.listingImage as string) || "",
        listingPrice: r.listingPrice != null ? Number(r.listingPrice) : null,
        dealId: (r.dealId as string) || null,
        paymentStatus: status,
        escrowAmount: r.escrowAmount != null ? Number(r.escrowAmount) : null,
        autoReleaseAt: (r.autoReleaseAt as number) || null,
        transferMethods: (r.transferMethods as string[]) || [],
        cancelled: r.cancelled === true || r.active === false,
        active: r.active !== false,
        cancelledBy: (r.cancelledBy as string) || null,
        cancelledAt: (r.cancelledAt as number) || null,
        deleteAt: (r.deleteAt as number) || null,
        autoCompleted: r.autoCompleted === true,
        autoCancelled: r.autoCancelled === true,
        expiryCancelled: r.expiryCancelled === true,
        paymentRequestPending: r.paymentRequestPending === true,
        paymentRequestedAt: (r.paymentRequestedAt as number) || null,
      };
      setRoom(nextRoom);

      // A reopened deal (see reopenDeal below) sends paymentStatus back to
      // "unfunded" and cancelled back to false — the room is live and
      // non-terminal again. Clear the latched terminal-outcome banner and
      // its once-only guard so a *second* expiry/completion later in the
      // same reopened deal's life can still show its own banner, instead
      // of outcomeShown.current staying permanently tripped from the
      // deal's first, since-undone closure.
      if (!nextRoom.cancelled && status !== "complete" && status !== "refunded" && outcomeShown.current) {
        outcomeShown.current = false;
        setOutcome(null);
      }

      // Lock state
      const neverDelivered = status === "unfunded" || status === "funded";
      // Client-side deadline check — true the instant expiresAt passes, even
      // before the server's own check-deal-expiry call (fired below, and on
      // every deal chat open) has actually resolved the room server-side.
      // Kept as its own signal (not folded into nextRoom.expiryCancelled)
      // because there's a real gap between "deadline passed" and "server
      // marked it closed" — this covers exactly that gap so the panel shows
      // an accurate locked state immediately rather than waiting on a
      // round trip.
      const expiredClientSide = neverDelivered && nextRoom.expiresAt != null && Date.now() > nextRoom.expiresAt;
      if (nextRoom.cancelled) {
        if (status === "complete") {
          setLocked({ locked: false, reason: null });
        } else if (nextRoom.expiryCancelled) {
          // Server has resolved this as an expiry closure — reopenable.
          setLocked({ locked: true, reason: "expired-reopenable" });
        } else {
          setLocked({ locked: true, reason: "cancelled-deleting" });
        }
      } else if (expiredClientSide) {
        // Deadline has passed but the server hasn't resolved it yet (race,
        // or the fallback check below hasn't landed). Same reopenable
        // treatment — check-deal-expiry is in flight and will flip
        // nextRoom.cancelled + expiryCancelled true within moments; no
        // reason to show a different, non-reopenable state in the
        // meantime only to have it change again a second later.
        setLocked({ locked: true, reason: "expired-reopenable" });
      } else {
        setLocked({ locked: false, reason: null });
      }

      // Terminal outcome banner — once, same as the original's _chatOutcomeShown guard.
      // A funded deal that expired unresolved lands here too (paymentStatus
      // flips to "refunded" via _refundEscrowForRoom's expiry branch) — carry
      // expiryCancelled through so the panel can still offer Reopen Deal for
      // that case instead of treating it as a final, non-reopenable closure
      // like a manual refund or a dispute resolved for the buyer.
      if ((status === "complete" || status === "refunded") && !outcomeShown.current) {
        outcomeShown.current = true;
        setOutcome({
          outcome: status === "complete" ? "successful" : "closed",
          auto: nextRoom.autoCompleted || nextRoom.autoCancelled,
          expiryCancelled: nextRoom.expiryCancelled,
        });
      }
      lastStatus.current = status;
    }

    init();

    // Ask the server to resolve this deal right now if its deadline
    // already passed — safe no-op otherwise, covers the gap before/
    // without a cron job configured.
    (async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;
        const idToken = await user.getIdToken();
        await fetch("/api/deal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "check-deal-expiry", idToken, chatRoomId }),
        });
      } catch {
        // silent — non-critical
      }
    })();

    const unsub = onSnapshot(doc(db, "dealChats", chatRoomId), (snap) => {
      if (cancelled || !snap.exists()) return;
      applyRoomData(snap.data());
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [chatRoomId]);

  // ── Subscribe to messages ──
  useEffect(() => {
    if (!chatRoomId) return;
    let cancelled = false;
    setMessagesLoading(true);
    setMessages([]);

    const q = query(collection(db, "dealChats", chatRoomId, "messages"), orderBy("createdAt", "asc"), limit(50));
    let unsub: Unsubscribe | null = null;
    try {
      unsub = onSnapshot(
        q,
        (snap) => {
          if (cancelled) return;
          try {
            const rows = snap.docs.map((d) => messageFromDoc(d.id, d.data()));
            setMessages(rows);
            setMessagesLoading(false);
            setChatError(null);
          } catch (e) {
            console.error("[useDealChat] failed to process messages snapshot", e);
            setChatError("Messages aren't loading. Close and reopen this chat to retry.");
          }
        },
        (err) => {
          console.error("[useDealChat] messages listener error", err);
          setChatError("Messages aren't loading. Close and reopen this chat to retry.");
          setMessagesLoading(false);
        }
      );
    } catch (e) {
      console.error("[useDealChat] failed to attach messages listener", e);
      setChatError("Messages aren't loading. Close and reopen this chat to retry.");
      setMessagesLoading(false);
    }

    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [chatRoomId]);

  // ── Mark my own thread read the instant this chat is open ──
  useEffect(() => {
    if (!chatRoomId) return;
    const user = auth.currentUser;
    if (!user) return;
    updateDoc(doc(db, "users", user.uid, "threads", chatRoomId), { unread: false }).catch(() => {});
  }, [chatRoomId]);

  // ── Keep both participants' sidebar threads in sync ──
  const syncThreads = useCallback(
    async (previewText: string, sellerUid: string | null, buyerUid: string | null) => {
      const user = auth.currentUser;
      const now = Date.now();
      const senderUid = user?.uid || null;
      const jobs: Promise<void>[] = [];
      if (sellerUid) {
        const isSender = senderUid === sellerUid;
        jobs.push(
          updateDoc(doc(db, "users", sellerUid, "threads", chatRoomId), { lastMessage: previewText, lastAt: now, unread: !isSender }).catch(() => {})
        );
      }
      if (buyerUid) {
        const isSender = senderUid === buyerUid;
        jobs.push(
          updateDoc(doc(db, "users", buyerUid, "threads", chatRoomId), { lastMessage: previewText, lastAt: now, unread: !isSender }).catch(() => {})
        );
      }
      await Promise.all(jobs);
    },
    [chatRoomId]
  );

  // ── Send a text message (with AI scam guard) ──
  const sendMessage = useCallback(
    async (text: string): Promise<{ blocked?: string } | undefined> => {
      const trimmed = text.trim();
      if (!trimmed || !chatRoomId || !room) return undefined;
      const user = auth.currentUser;
      if (!user) return undefined;

      setSending(true);
      try {
        let scamWarning: string | undefined;
        try {
          const idToken = await user.getIdToken();
          const res = await fetch("/api/aistudio", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "scam-check", idToken, text, chatId: chatRoomId }),
          });
          const guard = await res.json();
          if (guard.action === "blocked") {
            return { blocked: guard.reason || "Suspicious pattern detected." };
          }
          if (guard.action === "warned") scamWarning = guard.warningText;
        } catch (err) {
          console.error("Scam guard check failed, allowing message through:", err);
        }

        const now = Date.now();
        await addDoc(collection(db, "dealChats", chatRoomId, "messages"), {
          uid: user.uid,
          text: trimmed,
          createdAt: now,
          type: "text",
          ...(scamWarning ? { aiWarning: scamWarning } : {}),
        });
        await updateDoc(doc(db, "dealChats", chatRoomId), { lastMessage: trimmed, lastAt: now });
        await syncThreads(trimmed, room.sellerUid, room.buyerUid);

        const otherUid = user.uid === room.sellerUid ? room.buyerUid : room.sellerUid;
        if (otherUid && otherUid !== user.uid) {
          await addDoc(collection(db, "users", otherUid, "notifications"), {
            type: "message",
            title: user.displayName || "Someone",
            body: trimmed.length > 80 ? trimmed.slice(0, 80) + "…" : trimmed,
            chatRoomId,
            chatName: room.chatName,
            sellerUid: room.sellerUid,
            buyerUid: room.buyerUid,
            expiresAt: room.expiresAt,
            read: false,
            createdAt: now,
          }).catch(() => {});
        }
      } finally {
        setSending(false);
      }
      return undefined;
    },
    [chatRoomId, room, syncThreads]
  );

  const deleteMessage = useCallback(
    async (id: string) => {
      try {
        await deleteDoc(doc(db, "dealChats", chatRoomId, "messages", id));
      } catch (e) {
        console.error(e);
      }
    },
    [chatRoomId]
  );

  // ── Escrow actions ──
  const postDealAction = useCallback(
    async (action: string, extra: Record<string, unknown> = {}) => {
      const user = auth.currentUser;
      if (!user) throw new Error("Not signed in");
      const idToken = await user.getIdToken();
      const resp = await fetch("/api/deal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, idToken, chatRoomId, dealId: room?.dealId || null, ...extra }),
      });
      const out = await resp.json();
      if (!resp.ok) throw new Error(out.error || "Request failed");
      return out;
    },
    [chatRoomId, room]
  );

  // FUTURE PAYMENT METHOD: wallet-to-wallet escrow funding. Kept in place
  // (not removed/deleted) but not currently wired to any UI — we don't
  // hold a money-transmitter/custodial license to let users pay other
  // users directly from wallet balance. Re-enable this once a licensed
  // payment provider is integrated for escrow funding. Until then, Pay
  // Now in DealChatPanel.tsx shows a "temporarily unavailable" notice
  // instead of calling this.
  const payEscrow = useCallback((amount: number) => postDealAction("escrow-pay", { amount }), [postDealAction]);
  const releaseEscrow = useCallback(() => postDealAction("escrow-release"), [postDealAction]);
  const raiseDispute = useCallback((reason: string) => postDealAction("escrow-dispute", { reason }), [postDealAction]);

  // Server-side now (deal-chat-cancel in app/api/deal/_handler.js) — this
  // used to write directly to Firestore from the client (active/cancelled/
  // cancelledBy/cancelledAt/deleteAt on the room, the system message, both
  // threads), which meant no participant check ever ran server-side and a
  // funded deal's escrow was never actually refunded on cancel. Same
  // outward behavior, just resolved server-side in one transaction.
  const cancelDeal = useCallback(() => postDealAction("deal-chat-cancel"), [postDealAction]);

  // Reopens a deal chat closed by a missed deadline (see DealChatRoom's
  // expiryCancelled — the server refuses this with a 409 for any other
  // closure reason). Charges the caller a flat 15% penalty on the listing
  // price from their own wallet balance, server-side, atomically with
  // reviving the room — see deal-chat-reopen in app/api/deal/_handler.js.
  // Returns the penalty actually charged so the caller can show it.
  const reopenDeal = useCallback(
    () => postDealAction("deal-chat-reopen") as Promise<{ success: boolean; penalty: number }>,
    [postDealAction]
  );

  const remindBuyer = useCallback(
    async (price: string) => {
      if (!room?.buyerUid) return;
      // Guard: don't let the seller spam unlimited payment requests —
      // block re-sending until PAYMENT_REQUEST_COOLDOWN_MS has passed
      // since the last one, rather than blocking forever after the
      // first send.
      const lastRequestedAt = room.paymentRequestedAt || 0;
      if (Date.now() - lastRequestedAt < PAYMENT_REQUEST_COOLDOWN_MS) return;
      const requestedAt = Date.now();
      await updateDoc(doc(db, "dealChats", chatRoomId), {
        paymentRequestPending: true,
        paymentRequestedAt: requestedAt,
      });
      await addDoc(collection(db, "users", room.buyerUid, "notifications"), {
        type: "payment_reminder",
        title: "Payment requested",
        body: `The seller is requesting payment of ${price} into escrow for "${room.chatName}".`,
        chatRoomId,
        dealId: room.dealId,
        read: false,
        createdAt: requestedAt,
      });
    },
    [chatRoomId, room]
  );

  return {
    room,
    messages,
    messagesLoading,
    chatError,
    sending,
    locked,
    outcome,
    sendMessage,
    deleteMessage,
    payEscrow,
    releaseEscrow,
    raiseDispute,
    cancelDeal,
    reopenDeal,
    remindBuyer,
    syncThreads,
  };
}

export function countdownParts(ms: number): string {
  if (ms <= 0) return "Expired";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}

export function verifyCountdownText(autoReleaseAt: number): string {
  const ms = autoReleaseAt - Date.now();
  if (ms <= 0) return "Verifying…";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `Auto-confirms in ${h}h ${m}m`;
}

export function paymentRequestCooldownText(paymentRequestedAt: number): string {
  const ms = paymentRequestedAt + PAYMENT_REQUEST_COOLDOWN_MS - Date.now();
  if (ms <= 0) return "";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `Try again in ${h}h ${m}m`;
  return `Try again in ${m}m`;
}

export function isPaymentRequestOnCooldown(paymentRequestedAt: number | null): boolean {
  if (!paymentRequestedAt) return false;
  return Date.now() - paymentRequestedAt < PAYMENT_REQUEST_COOLDOWN_MS;
}

export function deleteCountdownText(deleteAt: number): string {
  const ms = deleteAt - Date.now();
  if (ms <= 0) return "deleting chat…";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `chat will be deleted in ${m}m ${sec}s.`;
}
