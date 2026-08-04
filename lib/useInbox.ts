"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  collection,
  query,
  orderBy,
  getDocs,
  limit,
  startAfter,
  doc,
  updateDoc,
  type QueryDocumentSnapshot,
  type DocumentData,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

// Ports the shell (chats tab + deals tab + groups tab) of Js/inbox.js
// (lines 1-936 — everything before the deal-chat panel, which is its own
// hook/component in a later pass). Same Firestore paths, same pagination
// behavior (15/page, cursor-based, client-side role filter for deals),
// same field names written by app/api/deal's already-ported backend.

const IBX_PAGE = 15;

export interface ChatThread {
  chatRoomId: string;
  partnerUid: string | null;
  name: string;
  pic: string;
  lastMsg: string;
  ts: number | null;
  unread: boolean;
  isDealChat: boolean;
  chatName: string;
  expiresAt: number | null;
  sellerUid: string | null;
  buyerUid: string | null;
  listingId: string;
  listingTitle: string;
  listingImage: string;
  listingPrice: number | null;
}

export interface Deal {
  id: string;
  status: string;
  read?: boolean;
  sellerUid: string;
  buyerUid: string;
  createdAt?: unknown;
  listingTitle?: string;
  listingImage?: string;
  listingPrice?: number | null;
  listingId?: string;
  dealId?: string;
  message?: string;
  introMessage?: string;
  offerPrice?: number | null;
  counterOffer?: number | null;
  chatRoomId?: string;
  expiresAt?: number | null;
}

export interface InboxGroup {
  id: string;
  name: string;
  desc: string;
  color: string;
}

export const IBX_GROUPS: InboxGroup[] = [
  { id: "all", name: "For All Niches", desc: "Everyone welcome — chat about anything", color: "#a3e635" },
  { id: "gaming", name: "Gaming", desc: "Games, reviews, deals, and drops", color: "#818cf8" },
  { id: "websites", name: "Websites", desc: "Buy, sell, and discuss website listings", color: "#38bdf8" },
  { id: "apps", name: "Apps", desc: "Mobile & web apps marketplace chat", color: "#f472b6" },
  { id: "show_work", name: "Show Your Work", desc: "Share what you're building or selling", color: "#fb923c" },
  { id: "best_deals", name: "Best Deals", desc: "Hot listings and limited-time offers", color: "#facc15" },
  { id: "startups", name: "Startups & SaaS", desc: "Revenue-generating products and micro-SaaS", color: "#34d399" },
  { id: "design", name: "Design & UI", desc: "UI kits, templates, and creative assets", color: "#e879f9" },
  { id: "collab", name: "Collab & Co-found", desc: "Find partners, co-founders, and collaborators", color: "#f97316" },
];

export type InboxTab = "chats" | "deals" | "groups";
export type DealSubTab = "received" | "sent";

function toMillis(v: unknown): number | null {
  if (!v) return null;
  if (typeof v === "number") return v;
  const t = v as { toMillis?: () => number; seconds?: number };
  if (typeof t.toMillis === "function") return t.toMillis();
  if (typeof t.seconds === "number") return t.seconds * 1000;
  return null;
}

function threadFromDoc(d: QueryDocumentSnapshot<DocumentData>): ChatThread {
  const t = d.data();
  return {
    chatRoomId: d.id,
    partnerUid: t.partnerUid || null,
    name: t.partnerName || "User",
    pic: t.partnerPic || "",
    lastMsg: t.lastMessage || "",
    ts: toMillis(t.lastAt),
    unread: t.unread === true || Boolean(t.unreadCount && t.unreadCount > 0),
    isDealChat: !!t.isDealChat,
    chatName: t.chatName || "",
    expiresAt: t.expiresAt || null,
    sellerUid: t.sellerUid || null,
    buyerUid: t.buyerUid || null,
    listingId: t.listingId || "",
    listingTitle: t.listingTitle || "",
    listingImage: t.listingImage || "",
    listingPrice: t.listingPrice ?? null,
  };
}

export function useInbox() {
  const [tab, setTabState] = useState<InboxTab>("chats");
  const [dealSubTab, setDealSubTabState] = useState<DealSubTab>("received");

  const [chats, setChats] = useState<ChatThread[]>([]);
  const [chatsLoading, setChatsLoading] = useState(false);
  const [chatsLoadingMore, setChatsLoadingMore] = useState(false);
  const [chatsExhausted, setChatsExhausted] = useState(false);
  const chatsLastDoc = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
  const chatsIds = useRef<Set<string>>(new Set());

  const [deals, setDeals] = useState<Deal[]>([]);
  const [dealsLoading, setDealsLoading] = useState(false);
  const [dealsLoadingMore, setDealsLoadingMore] = useState(false);
  const [dealsExhausted, setDealsExhausted] = useState(false);
  const dealsLastDoc = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
  const dealsIds = useRef<Set<string>>(new Set());

  const [chatsUnread, setChatsUnread] = useState(0);
  const [dealsUnread, setDealsUnread] = useState(0);

  // ── Chats: initial load ──
  const loadChats = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) {
      setChats([]);
      setChatsLoading(false);
      return;
    }
    setChatsLoading(true);
    try {
      const q = query(
        collection(db, "users", user.uid, "threads"),
        orderBy("lastAt", "desc"),
        limit(IBX_PAGE)
      );
      const snap = await getDocs(q);
      chatsLastDoc.current = snap.docs[snap.docs.length - 1] || null;
      setChatsExhausted(snap.docs.length < IBX_PAGE);
      const rows = snap.docs.map(threadFromDoc);
      chatsIds.current = new Set(rows.map((r) => r.chatRoomId));
      setChats(rows);
      setChatsUnread(rows.filter((r) => r.unread).length);
    } catch (e) {
      console.error("IBX chats error:", e);
      setChats([]);
    } finally {
      setChatsLoading(false);
    }
  }, []);

  const loadMoreChats = useCallback(async () => {
    const user = auth.currentUser;
    if (!user || chatsLoadingMore || chatsExhausted || !chatsLastDoc.current) return;
    setChatsLoadingMore(true);
    try {
      const q = query(
        collection(db, "users", user.uid, "threads"),
        orderBy("lastAt", "desc"),
        startAfter(chatsLastDoc.current),
        limit(IBX_PAGE)
      );
      const snap = await getDocs(q);
      chatsLastDoc.current = snap.docs[snap.docs.length - 1] || chatsLastDoc.current;
      setChatsExhausted(snap.docs.length < IBX_PAGE);
      const fresh = snap.docs.map(threadFromDoc).filter((r) => !chatsIds.current.has(r.chatRoomId));
      fresh.forEach((r) => chatsIds.current.add(r.chatRoomId));
      if (fresh.length) setChats((prev) => [...prev, ...fresh]);
    } catch (e) {
      console.error("IBX load more chats:", e);
    } finally {
      setChatsLoadingMore(false);
    }
  }, [chatsLoadingMore, chatsExhausted]);

  // ── Deals: initial load (client-side role filter, same as original) ──
  const loadDeals = useCallback(async (sub: DealSubTab) => {
    const user = auth.currentUser;
    if (!user) {
      setDeals([]);
      setDealsLoading(false);
      return;
    }
    setDealsLoading(true);
    try {
      const uid = user.uid;
      const q = query(
        collection(db, "users", uid, "deals"),
        orderBy("createdAt", "desc"),
        limit(IBX_PAGE)
      );
      const snap = await getDocs(q);
      const allDeals: Deal[] = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Deal));
      const filtered = allDeals.filter((d) => (sub === "received" ? d.sellerUid === uid : d.buyerUid === uid));

      if (snap.empty || filtered.length === 0) {
        dealsLastDoc.current = null;
        setDealsExhausted(true);
        dealsIds.current = new Set();
        setDeals([]);
        setDealsUnread(0);
        return;
      }

      dealsLastDoc.current = snap.docs[snap.docs.length - 1] || null;
      setDealsExhausted(snap.docs.length < IBX_PAGE);
      dealsIds.current = new Set(filtered.map((d) => d.id));
      setDeals(filtered);
      const unreadCount = allDeals.filter((d) => d.read === false && d.sellerUid === uid).length;
      setDealsUnread(unreadCount);
    } catch (e) {
      console.error("IBX deals error:", e);
      setDeals([]);
    } finally {
      setDealsLoading(false);
    }
  }, []);

  const loadMoreDeals = useCallback(
    async (sub: DealSubTab) => {
      const user = auth.currentUser;
      if (!user || dealsLoadingMore || dealsExhausted || !dealsLastDoc.current) return;
      setDealsLoadingMore(true);
      try {
        const uid = user.uid;
        const q = query(
          collection(db, "users", uid, "deals"),
          orderBy("createdAt", "desc"),
          startAfter(dealsLastDoc.current),
          limit(IBX_PAGE)
        );
        const snap = await getDocs(q);
        dealsLastDoc.current = snap.docs[snap.docs.length - 1] || dealsLastDoc.current;
        setDealsExhausted(snap.docs.length < IBX_PAGE);
        const filtered: Deal[] = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as Deal))
          .filter((d) => (sub === "received" ? d.sellerUid === uid : d.buyerUid === uid))
          .filter((d) => !dealsIds.current.has(d.id));
        filtered.forEach((d) => dealsIds.current.add(d.id));
        if (filtered.length) setDeals((prev) => [...prev, ...filtered]);
      } catch (e) {
        console.error("IBX load more deals:", e);
      } finally {
        setDealsLoadingMore(false);
      }
    },
    [dealsLoadingMore, dealsExhausted]
  );

  const resetChats = useCallback(() => {
    chatsLastDoc.current = null;
    chatsIds.current = new Set();
    setChatsExhausted(false);
    setChats([]);
  }, []);

  const resetDeals = useCallback(() => {
    dealsLastDoc.current = null;
    dealsIds.current = new Set();
    setDealsExhausted(false);
    setDeals([]);
  }, []);

  const setTab = useCallback(
    (next: InboxTab) => {
      setTabState(next);
      if (next === "chats") {
        resetChats();
        loadChats();
      } else if (next === "deals") {
        resetDeals();
        loadDeals(dealSubTab);
      }
    },
    [resetChats, loadChats, resetDeals, loadDeals, dealSubTab]
  );

  const setDealSubTab = useCallback(
    (next: DealSubTab) => {
      setDealSubTabState(next);
      resetDeals();
      loadDeals(next);
    },
    [resetDeals, loadDeals]
  );

  // Initial load for the default tab, once auth is ready.
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    const unsub = auth.onAuthStateChanged((user) => {
      if (!user) return;
      if (didInit.current) return;
      didInit.current = true;
      loadChats();
    });
    return () => unsub();
  }, [loadChats]);

  // ── Deal row actions (accept / reject / cancel) — same /api/deal calls,
  // same response shape (chatRoomId, expiresAt), same 409 "already" handling. ──
  const acceptDeal = useCallback(async (dealId: string) => {
    const user = auth.currentUser;
    if (!user) throw new Error("Not signed in");
    const idToken = await user.getIdToken();
    const resp = await fetch("/api/deal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "accept-deal", idToken, dealId }),
    });
    const out = await resp.json();
    if (!resp.ok) throw new Error(out.error || "Could not accept deal");
    setDeals((prev) =>
      prev.map((d) => (d.id === dealId ? { ...d, status: "accepted", chatRoomId: out.chatRoomId, expiresAt: out.expiresAt } : d))
    );
    return out as { chatRoomId: string; expiresAt: number };
  }, []);

  const rejectDeal = useCallback(async (dealId: string) => {
    const user = auth.currentUser;
    if (!user) throw new Error("Not signed in");
    const idToken = await user.getIdToken();
    const resp = await fetch("/api/deal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reject-deal", idToken, dealId }),
    });
    const out = await resp.json();
    if (!resp.ok) throw new Error(out.error || "Could not reject deal");
    setDeals((prev) => prev.map((d) => (d.id === dealId ? { ...d, status: "rejected" } : d)));
  }, []);

  const cancelDeal = useCallback(async (dealId: string) => {
    const user = auth.currentUser;
    if (!user) throw new Error("Not signed in");
    const idToken = await user.getIdToken();
    const resp = await fetch("/api/deal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel-deal", idToken, dealId }),
    });
    const out = await resp.json();
    if (!resp.ok) throw new Error(out.error || "Could not cancel deal");
    setDeals((prev) => prev.filter((d) => d.id !== dealId));
  }, []);

  const markDealRead = useCallback(async (dealId: string) => {
    const user = auth.currentUser;
    if (!user) return;
    try {
      await updateDoc(doc(db, "users", user.uid, "deals", dealId), { read: true });
      setDeals((prev) => prev.map((d) => (d.id === dealId ? { ...d, read: true } : d)));
      setDealsUnread((prev) => Math.max(0, prev - 1));
    } catch {
      // non-fatal — same as original's swallowed catch
    }
  }, []);

  return {
    tab,
    setTab,
    dealSubTab,
    setDealSubTab,
    chats,
    chatsLoading,
    chatsLoadingMore,
    chatsExhausted,
    loadMoreChats,
    chatsUnread,
    deals,
    dealsLoading,
    dealsLoadingMore,
    dealsExhausted,
    loadMoreDeals,
    dealsUnread,
    acceptDeal,
    rejectDeal,
    cancelDeal,
    markDealRead,
  };
}

export function relTime(ts: number | null): string {
  if (!ts) return "";
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return "Just now";
  if (diff < 3600) return Math.floor(diff / 60) + "m";
  if (diff < 86400) return Math.floor(diff / 3600) + "h";
  if (diff < 172800) return "Yesterday";
  return Math.floor(diff / 86400) + "d";
}

export function countdownText(expiresAt: number): string {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return "Expired";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}

export function dealChatName(listingTitle: string): string {
  const words = (listingTitle || "Untitled").trim().split(/\s+/);
  const short = words.length > 2 ? words.slice(0, 2).join(" ") + "…" : words.join(" ");
  return "Deal · " + short;
}
