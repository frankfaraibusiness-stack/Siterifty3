"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { useAuthModal } from "@/components/auth/AuthModalProvider";
import SignInRequired from "@/components/auth/SignInRequired";
import { useAiSupportChatModal } from "@/components/support/AiSupportChatModalProvider";
import { useCurrency } from "@/lib/CurrencyContext";
import { useIsDesktop } from "@/lib/useIsDesktop";
import DealChatPanel from "./DealChatPanel";
import GroupChatPanel from "./GroupChatPanel";
import {
  useInbox,
  relTime,
  countdownText,
  IBX_GROUPS,
  type ChatThread,
  type Deal,
  type InboxTab,
} from "@/lib/useInbox";

// Firestore Timestamp | millis | undefined -> millis, mirrors useInbox's
// internal toMillis (kept local since that helper isn't exported).
function dealCreatedAtMillis(createdAt: unknown): number | null {
  if (!createdAt) return null;
  if (typeof createdAt === "number") return createdAt;
  const t = createdAt as { toMillis?: () => number; seconds?: number };
  if (typeof t.toMillis === "function") return t.toMillis();
  if (typeof t.seconds === "number") return t.seconds * 1000;
  return null;
}

// Ports the inbox shell from Js/inbox.js (lines 1-936): chats tab, deals
// tab (received/sent sub-tabs, accept/reject/cancel, expand-to-detail),
// groups tab. The deal-chat and group-chat panels those rows link out to
// are their own component in a later pass — for now their row actions
// are wired to navigate to the routed pages (/messages/deal/[id],
// /messages/group/[id]) that already exist as placeholders.

function Avatar({ pic, name }: { pic: string; name: string }) {
  const initial = (name || "U").charAt(0).toUpperCase();
  if (pic) {
    return (
      <div className="ibx-row-av">
        <img
          src={pic}
          alt={initial}
          onError={(e) => {
            const el = e.currentTarget.parentElement;
            if (el) el.textContent = initial;
          }}
        />
      </div>
    );
  }
  return <div className="ibx-row-av">{initial}</div>;
}

function ListingThumb({ img, title }: { img: string; title: string }) {
  const fallback = (title || "L").charAt(0).toUpperCase();
  if (img) {
    return (
      <div className="ibx-row-av ibx-listing-av">
        <img
          src={img}
          alt={fallback}
          style={{ objectFit: "cover", borderRadius: "0.55rem" }}
          onError={(e) => {
            const el = e.currentTarget.parentElement;
            if (el) el.innerHTML = `<span style="font-size:0.75rem;font-weight:800;">${fallback}</span>`;
          }}
        />
      </div>
    );
  }
  return <div className="ibx-row-av ibx-listing-av">{fallback}</div>;
}

function Skeleton({ n = 3 }: { n?: number }) {
  return (
    <>
      {Array.from({ length: n }).map((_, i) => (
        <div className="ibx-skeleton-row" key={i}>
          <div className="ibx-skel-circle" />
          <div className="ibx-skel-lines">
            <div className="ibx-skel-line" />
            <div className="ibx-skel-line short" />
          </div>
        </div>
      ))}
    </>
  );
}

// Route-level loading UI for /messages (see app/messages/loading.tsx).
// Mirrors the real ibx-box shell — header, tabs, skeleton rows — instead
// of the generic marketplace-grid-shaped SiteriftyLoader that used to
// show here via Suspense's fallback, which didn't match this page's
// layout at all (that fallback only covers the initial JS chunk anyway;
// InboxShell's real data fetch is client-side via useInbox and already
// shows this same Skeleton once mounted — this just extends the same
// look back to cover the route-transition gap before InboxShell mounts).
export function InboxShellSkeleton() {
  return (
    <div style={{ marginTop: 92, minHeight: "calc(100dvh - 92px)", background: "#080808", display: "flex", justifyContent: "center" }}>
      <div className="ibx-box" style={{ height: "calc(100dvh - 92px)" }}>
        <div className="ibx-header">
          <div className="ibx-header-left">
            <button className="ibx-back-btn" aria-label="Back" disabled>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="ibx-title">Messages &amp; Deals</span>
          </div>
        </div>
        <div className="ibx-tabs">
          <button className="ibx-tab active">Chats</button>
          <button className="ibx-tab">Deals</button>
          <button className="ibx-tab">Groups</button>
        </div>
        <div className="ibx-body">
          <Skeleton />
        </div>
      </div>
    </div>
  );
}

export default function InboxShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { openAuthModal } = useAuthModal();
  const { openAiSupportChat } = useAiSupportChatModal();
  const inbox = useInbox();
  const isDesktop = useIsDesktop();

  // Deep-link: /messages?tab=deals lands directly on that tab.
  const didApplyParam = useRef(false);
  useEffect(() => {
    if (didApplyParam.current) return;
    const t = searchParams.get("tab");
    if (t === "chats" || t === "deals" || t === "groups") {
      didApplyParam.current = true;
      inbox.setTab(t as InboxTab);
    }
  }, [searchParams, inbox]);

  function switchTab(tab: InboxTab) {
    inbox.setTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    router.replace(url.pathname + "?" + url.searchParams.toString(), { scroll: false });
  }

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight > 120) return;
    if (inbox.tab === "chats" && !inbox.chatsLoadingMore && !inbox.chatsExhausted) inbox.loadMoreChats();
    if (inbox.tab === "deals" && !inbox.dealsLoadingMore && !inbox.dealsExhausted) inbox.loadMoreDeals(inbox.dealSubTab);
  }

  // Which row (chat/deal/group id) was just tapped and is currently
  // navigating. Previously tapping any row here — a deal chat, a plain
  // chat, a group — did nothing visible at all until DealChatPanel/
  // GroupChatPanel's data finished loading on the new route, so a tap on
  // a slow connection looked exactly like a tap that missed or a site
  // that's frozen. This flags the specific row that was tapped (not the
  // whole list) so the rest of the inbox stays interactive-looking while
  // that one row shows it registered. Still used on mobile (route
  // navigation has a real loading gap); on desktop the embedded panel
  // mounts immediately so this stays null there.
  const [openingRowId, setOpeningRowId] = useState<string | null>(null);

  // ── Desktop split-view selection ──
  // On a wide viewport, rows no longer navigate to /messages/deal/[id]
  // or /messages/group/[id] — they select a thread that renders as an
  // embedded pane on the right, list staying visible on the left, same
  // pattern as /settings. Mobile is untouched: rows still push a real
  // route and DealChatPanel/GroupChatPanel still render full-screen
  // exactly as before.
  const [selected, setSelected] = useState<{ kind: "deal" | "group"; id: string } | null>(null);

  function openChatRow(t: ChatThread) {
    if (t.isDealChat) {
      if (isDesktop) {
        setSelected({ kind: "deal", id: t.chatRoomId });
        return;
      }
      if (openingRowId) return;
      setOpeningRowId(t.chatRoomId);
      router.push(`/messages/deal/${t.chatRoomId}?from=chats`);
    } else if (t.partnerUid) {
      // 1:1 DM chat panel isn't ported yet (belongs to the same later pass
      // as the deal-chat panel) — route to the deal-chat page's shell
      // won't apply here, so fall back to the partner's profile for now.
      // This is a genuine navigation away from /messages either way, so
      // it stays a real route push on desktop too — there's no panel to
      // embed it as.
      if (openingRowId) return;
      setOpeningRowId(t.chatRoomId);
      router.push(`/seller/${t.partnerUid}`);
    }
  }

  function openDealRow(chatRoomId: string) {
    if (isDesktop) {
      setSelected({ kind: "deal", id: chatRoomId });
      return;
    }
    if (openingRowId) return;
    setOpeningRowId(chatRoomId);
    router.push(`/messages/deal/${chatRoomId}?from=deals`);
  }

  function openGroupRow(id: string) {
    if (isDesktop) {
      setSelected({ kind: "group", id });
      return;
    }
    if (openingRowId) return;
    setOpeningRowId(id);
    router.push(`/messages/group/${id}`);
  }

  // Auto-select a sensible first thread on desktop once each tab's data
  // has loaded, so the right pane is never just an empty "pick something"
  // placeholder on first load — matches the request that this behave like
  // Settings, where a panel is always showing. Only fires when nothing is
  // already selected and doesn't fight the user's own clicks: switching
  // tabs re-evaluates once that tab's rows exist, but re-selecting the
  // same thread on every data refresh is avoided by only running when
  // `selected` is null.
  useEffect(() => {
    if (!isDesktop || !user || selected) return;
    if (inbox.tab === "deals" && !inbox.dealsLoading) {
      const firstAccepted = inbox.deals.find((d) => d.status === "accepted" && d.chatRoomId);
      if (firstAccepted?.chatRoomId) setSelected({ kind: "deal", id: firstAccepted.chatRoomId });
    } else if (inbox.tab === "chats" && !inbox.chatsLoading) {
      const firstDealChat = inbox.chats.find((t) => t.isDealChat);
      if (firstDealChat) setSelected({ kind: "deal", id: firstDealChat.chatRoomId });
    } else if (inbox.tab === "groups") {
      setSelected({ kind: "group", id: IBX_GROUPS[0].id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDesktop, user, selected, inbox.tab, inbox.dealsLoading, inbox.chatsLoading, inbox.deals, inbox.chats]);

  // Switching tabs clears the current selection so e.g. leaving Groups
  // for Deals doesn't leave a group panel showing next to the deals list
  // — the auto-select effect above then picks a sensible default for the
  // newly active tab.
  useEffect(() => {
    setSelected(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inbox.tab]);

  const totalUnread = inbox.chatsUnread + inbox.dealsUnread;
  const showSplitPane = isDesktop && !!user;

  return (
    <div style={{ marginTop: 92, minHeight: "calc(100dvh - 92px)", background: "#080808", display: "flex", justifyContent: "center" }}>
      <div className={showSplitPane ? "ibx-box ibx-box-split" : "ibx-box"} style={{ height: "calc(100dvh - 92px)" }}>
        <div className="ibx-list-pane">
          <div className="ibx-header">
            <div className="ibx-header-left">
              <button className="ibx-back-btn" onClick={() => router.push("/myprofile")} aria-label="Back">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
              </button>
              <span className="ibx-title">Messages &amp; Deals</span>
            </div>
            <span className="ibx-unread-pill">{totalUnread > 0 ? (totalUnread > 99 ? "99+" : totalUnread) : ""}</span>
          </div>

          <div className="ibx-tabs">
            <button className={`ibx-tab${inbox.tab === "chats" ? " active" : ""}`} onClick={() => switchTab("chats")}>
              Chats
              {inbox.chatsUnread > 0 ? (
                <span className="ibx-tab-badge">{inbox.chatsUnread > 99 ? "99+" : inbox.chatsUnread}</span>
              ) : null}
            </button>
            <button className={`ibx-tab${inbox.tab === "deals" ? " active" : ""}`} onClick={() => switchTab("deals")}>
              Deals
              {inbox.dealsUnread > 0 ? (
                <span className="ibx-tab-badge">{inbox.dealsUnread > 99 ? "99+" : inbox.dealsUnread}</span>
              ) : null}
            </button>
            <button className={`ibx-tab${inbox.tab === "groups" ? " active" : ""}`} onClick={() => switchTab("groups")}>
              Groups
            </button>
          </div>

          <div className="ibx-body" onScroll={handleScroll}>
            {!user ? (
              <SignInRequired
                fullScreen={false}
                title="Sign in to see your messages"
                description="Your chats, deal conversations, and group threads are only visible once you're signed in."
              />
            ) : inbox.tab === "chats" ? (
              <ChatsTab
                inbox={inbox}
                onOpenChat={openChatRow}
                onOpenAiSupport={openAiSupportChat}
                openingRowId={openingRowId}
                selectedId={showSplitPane ? selected?.id ?? null : null}
              />
            ) : inbox.tab === "deals" ? (
              <DealsTab
                inbox={inbox}
                onOpenDealChat={openDealRow}
                openingRowId={openingRowId}
                selectedId={showSplitPane ? selected?.id ?? null : null}
              />
            ) : (
              <GroupsTab
                onOpenGroup={openGroupRow}
                openingRowId={openingRowId}
                selectedId={showSplitPane ? selected?.id ?? null : null}
              />
            )}
          </div>
        </div>

        {showSplitPane ? (
          <div className="ibx-detail-pane">
            {selected?.kind === "deal" ? (
              <DealChatPanel key={selected.id} chatRoomId={selected.id} embedded onBack={() => setSelected(null)} />
            ) : selected?.kind === "group" ? (
              <GroupChatPanel key={selected.id} groupId={selected.id} embedded onBack={() => setSelected(null)} />
            ) : (
              <div className="ibx-detail-empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                </svg>
                <p>Select a conversation</p>
                <span>Pick a deal, chat, or group from the list to view it here.</span>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Chats tab ──
function ChatsTab({
  inbox,
  onOpenChat,
  onOpenAiSupport,
  openingRowId,
  selectedId,
}: {
  inbox: ReturnType<typeof useInbox>;
  onOpenChat: (t: ChatThread) => void;
  onOpenAiSupport: () => void;
  openingRowId: string | null;
  selectedId?: string | null;
}) {
  if (inbox.chatsLoading) return <Skeleton />;

  return (
    <>
      <div className="ibx-row ibx-ai-row" style={{ paddingLeft: "1.5rem" }} onClick={onOpenAiSupport}>
        <div className="ibx-row-av ibx-ai-av">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a4 4 0 00-4 4v1a5 5 0 00-3 4.58V16a5 5 0 005 5h4a5 5 0 005-5v-4.42A5 5 0 0016 7V6a4 4 0 00-4-4z" />
            <circle cx="9" cy="13" r="1" fill="currentColor" stroke="none" />
            <circle cx="15" cy="13" r="1" fill="currentColor" stroke="none" />
          </svg>
        </div>
        <div className="ibx-row-content">
          <div className="ibx-row-name bold">
            AI Support<span className="ibx-ai-pill">Pinned</span>
          </div>
          <div className="ibx-row-sub">Ask questions, get help, or report a user</div>
        </div>
      </div>

      {inbox.chats.length === 0 ? (
        <div className="ibx-empty" style={{ paddingTop: "1rem" }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
          <div className="ibx-empty-text">No conversations yet</div>
          <div style={{ fontSize: "0.72rem", color: "#333", marginTop: 2 }}>Send a deal or message a seller to get started</div>
        </div>
      ) : (
        inbox.chats.map((t) => (
          <div
            key={t.chatRoomId}
            className={`ibx-row${selectedId === t.chatRoomId ? " ibx-row-selected" : ""}`}
            style={{ paddingLeft: t.unread ? "1.8rem" : "1.5rem" }}
            onClick={() => onOpenChat(t)}
          >
            {t.unread ? <span className="ibx-row-dot" /> : null}
            {t.isDealChat && t.listingImage ? <ListingThumb img={t.listingImage} title={t.listingTitle} /> : <Avatar pic={t.pic} name={t.name} />}
            <div className="ibx-row-content">
              <div className={`ibx-row-name${t.unread ? " bold" : ""}`}>
                {t.name}
                {t.isDealChat ? (
                  <span className="ibx-ai-pill" style={{ color: "#a3e635" }}>
                    Deal
                  </span>
                ) : null}
              </div>
              <div className="ibx-row-sub">{t.lastMsg || "No messages yet"}</div>
            </div>
            <div className="ibx-row-meta">
              {openingRowId === t.chatRoomId ? (
                <div className="ibx-load-more-spinner" style={{ width: 14, height: 14 }} />
              ) : (
                <div className="ibx-row-time">{relTime(t.ts)}</div>
              )}
            </div>
          </div>
        ))
      )}

      {inbox.chatsLoadingMore ? (
        <div className="ibx-load-more">
          <div className="ibx-load-more-spinner" />
        </div>
      ) : null}
    </>
  );
}

// ── Deals tab ──
function DealsTab({
  inbox,
  onOpenDealChat,
  openingRowId,
  selectedId,
}: {
  inbox: ReturnType<typeof useInbox>;
  onOpenDealChat: (chatRoomId: string) => void;
  openingRowId: string | null;
  selectedId?: string | null;
}) {
  return (
    <>
      <div className="ibx-deal-subtabs">
        <button
          className={`ibx-deal-subtab${inbox.dealSubTab === "received" ? " active" : ""}`}
          onClick={() => inbox.setDealSubTab("received")}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ width: 13, height: 13, verticalAlign: -2, marginRight: 5 }}
          >
            <path d="M22 12h-6l-2 3h-4l-2-3H2" />
            <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
          </svg>
          Received
        </button>
        <button
          className={`ibx-deal-subtab${inbox.dealSubTab === "sent" ? " active" : ""}`}
          onClick={() => inbox.setDealSubTab("sent")}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ width: 13, height: 13, verticalAlign: -2, marginRight: 5 }}
          >
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
          Sent
        </button>
      </div>

      {inbox.dealsLoading ? (
        <Skeleton />
      ) : inbox.deals.length === 0 ? (
        <div className="ibx-empty" style={{ paddingTop: "2.5rem" }}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ width: 40, height: 40, stroke: "#2a2a2a" }}
          >
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
          </svg>
          <div className="ibx-empty-text" style={{ fontSize: "0.92rem", color: "#444", fontWeight: 600 }}>
            {inbox.dealSubTab === "received" ? "No deals received yet" : "No deals sent yet"}
          </div>
          <div style={{ fontSize: "0.72rem", color: "#333", marginTop: 3, textAlign: "center", maxWidth: 200 }}>
            {inbox.dealSubTab === "received"
              ? "When buyers send you deal requests they'll appear here"
              : "Browse the marketplace and send a deal to a seller"}
          </div>
        </div>
      ) : (
        inbox.deals.map((d) => (
          <DealRow key={d.id} deal={d} inbox={inbox} onOpenDealChat={onOpenDealChat} openingRowId={openingRowId} selectedId={selectedId} />
        ))
      )}

      {inbox.dealsLoadingMore ? (
        <div className="ibx-load-more">
          <div className="ibx-load-more-spinner" />
        </div>
      ) : null}
    </>
  );
}

function DealRow({
  deal,
  inbox,
  onOpenDealChat,
  openingRowId,
  selectedId,
}: {
  deal: Deal;
  inbox: ReturnType<typeof useInbox>;
  onOpenDealChat: (chatRoomId: string) => void;
  openingRowId: string | null;
  selectedId?: string | null;
}) {
  const uid = useAuth().user?.uid || "";
  const { currency, formatPriceShort } = useCurrency();
  const [open, setOpenState] = useState(false);
  const [busy, setBusy] = useState<"" | "accepting" | "rejecting" | "cancelling">("");
  const [err, setErr] = useState("");

  const isUnread = deal.read === false && deal.sellerUid === uid;
  const isSeller = uid === deal.sellerUid;
  const badge =
    deal.status === "complete"
      ? "successful"
      : deal.status === "cancelled"
      ? "closed"
      : deal.status === "accepted"
      ? "accepted"
      : deal.status === "rejected"
      ? "rejected"
      : "pending";
  const badgeLabel =
    badge === "successful" ? "Deal Successful" : badge === "closed" ? "Deal Closed" : badge.charAt(0).toUpperCase() + badge.slice(1);
  const listedPriceStr = deal.listingPrice != null ? formatPriceShort(deal.listingPrice) : "—";

  async function toggleOpen() {
    const willOpen = !open;
    setOpenState(willOpen);
    if (willOpen && deal.read === false) {
      inbox.markDealRead(deal.id);
    }
  }

  async function handleAccept(e: React.MouseEvent) {
    e.stopPropagation();
    setErr("");
    setBusy("accepting");
    try {
      await inbox.acceptDeal(deal.id);
    } catch (e2: unknown) {
      const msg = e2 instanceof Error ? e2.message : "Could not accept deal";
      setErr(msg);
    } finally {
      setBusy("");
    }
  }

  async function handleReject(e: React.MouseEvent) {
    e.stopPropagation();
    setErr("");
    setBusy("rejecting");
    try {
      await inbox.rejectDeal(deal.id);
    } catch (e2: unknown) {
      const msg = e2 instanceof Error ? e2.message : "Could not reject deal";
      setErr(msg);
    } finally {
      setBusy("");
    }
  }

  async function handleCancel(e: React.MouseEvent) {
    e.stopPropagation();
    setErr("");
    setBusy("cancelling");
    try {
      await inbox.cancelDeal(deal.id);
    } catch (e2: unknown) {
      const msg = e2 instanceof Error ? e2.message : "Could not cancel deal";
      setErr(msg);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className={`${isUnread ? "ibx-deal-unread" : ""}${selectedId && deal.chatRoomId === selectedId ? " ibx-row-selected" : ""}`}>
      <div className="ibx-deal-row" onClick={toggleOpen}>
        {isUnread ? <span className="ibx-row-dot ibx-deal-dot" /> : null}
        {deal.listingImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="ibx-deal-thumb" src={deal.listingImage} alt="" onError={(e) => (e.currentTarget.style.display = "none")} />
        ) : (
          <div className="ibx-deal-thumb" />
        )}
        <div className="ibx-deal-info">
          <div className={`ibx-deal-title${isUnread ? " bold" : ""}`}>{deal.listingTitle || "Untitled"}</div>
          <div className="ibx-deal-msg">{deal.message || deal.introMessage || ""}</div>
          <div className="ibx-deal-footer">
            <span className={`ibx-deal-role ${isSeller ? "seller" : "buyer"}`}>{isSeller ? "Seller" : "Buyer"}</span>
            <span className={`ibx-deal-badge ${badge}`}>{badgeLabel}</span>
            {badge === "accepted" && deal.expiresAt ? <Countdown expiresAt={deal.expiresAt} /> : null}
            <span className="ibx-deal-ts">{relTime(dealCreatedAtMillis(deal.createdAt))}</span>
          </div>
        </div>
      </div>

      <div className={`ibx-deal-expand${open ? " open" : ""}`}>
        <div className="ibx-deal-expand-inner">
          {deal.offerPrice != null ? (
            <div className="ibx-deal-offer-highlight">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13, flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v8M8 12h8" />
              </svg>
              Buyer&apos;s offer: {formatPriceShort(deal.offerPrice)}
              {deal.listingPrice != null ? (
                <span style={{ color: "rgba(255,255,255,0.35)", fontSize: "0.72rem", fontWeight: 400 }}>
                  vs listed {formatPriceShort(deal.listingPrice)}
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="ibx-deal-detail-label">Opening message</div>
          <div className="ibx-deal-detail-val">{deal.introMessage || "—"}</div>
          <div className="ibx-deal-detail-label">Their message</div>
          <div className="ibx-deal-detail-val">{deal.message || "—"}</div>
          <div className="ibx-deal-detail-label">Listed price</div>
          <div className="ibx-deal-detail-val">{listedPriceStr}</div>
          {currency !== "USD" && (deal.offerPrice != null || deal.listingPrice != null || deal.counterOffer != null) && (
            <div style={{ fontSize: "0.68rem", color: "#555", marginTop: -4, marginBottom: 4 }}>
              Amounts shown converted to {currency} — deals settle in USD
            </div>
          )}
          {deal.counterOffer != null ? (
            <>
              <div className="ibx-deal-detail-label">Counter-offer sent</div>
              <div className="ibx-deal-detail-val" style={{ color: "#fbbf24", fontWeight: 700 }}>
                {formatPriceShort(deal.counterOffer)}
              </div>
            </>
          ) : null}
          <div className="ibx-deal-detail-label">Listing ID</div>
          <div className="ibx-deal-detail-val" style={{ fontSize: "0.72rem", fontFamily: "monospace", letterSpacing: "0.04em" }}>
            {deal.listingId || deal.dealId || "—"}
          </div>

          {err ? <div style={{ color: "#f87171", fontSize: 12, marginTop: 8 }}>{err}</div> : null}

          {isSeller && badge === "pending" ? (
            <div className="ibx-deal-actions">
              <button className="ibx-deal-accept-btn" disabled={busy !== ""} onClick={handleAccept}>
                {busy === "accepting" ? "Accepting…" : "Accept"}
              </button>
              <button className="ibx-deal-reject-btn" disabled={busy !== ""} onClick={handleReject}>
                Reject
              </button>
            </div>
          ) : null}

          {!isSeller && badge === "pending" ? (
            <button className="ibx-deal-cancel-btn" disabled={busy !== ""} onClick={handleCancel}>
              {busy === "cancelling" ? "Cancelling…" : "Cancel deal request"}
            </button>
          ) : null}

          {badge === "accepted" && deal.chatRoomId ? (
            <button
              className="ibx-open-chat-btn"
              disabled={openingRowId === deal.chatRoomId}
              onClick={(e) => {
                e.stopPropagation();
                onOpenDealChat(deal.chatRoomId!);
              }}
            >
              {openingRowId === deal.chatRoomId ? (
                <>
                  <span className="ibx-load-more-spinner" style={{ width: 13, height: 13, display: "inline-block", verticalAlign: -2, marginRight: 6 }} />
                  Opening…
                </>
              ) : (
                <>💬 Open Deal Chat</>
              )}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Countdown({ expiresAt }: { expiresAt: number }) {
  const [text, setText] = useState(() => countdownText(expiresAt));
  useEffect(() => {
    if (expiresAt <= Date.now()) return;
    const id = setInterval(() => setText(countdownText(expiresAt)), 60000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return <span className="ibx-deal-countdown">⏱ {text}</span>;
}

// ── Groups tab ──
function GroupIcon({ id }: { id: string }) {
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (id) {
    case "all":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
        </svg>
      );
    case "gaming":
      return (
        <svg {...common}>
          <rect x="2" y="6" width="20" height="12" rx="2" />
          <path d="M6 12h4" />
          <path d="M8 10v4" />
          <circle cx="16" cy="11" r="0.5" fill="currentColor" />
          <circle cx="18" cy="13" r="0.5" fill="currentColor" />
        </svg>
      );
    case "websites":
      return (
        <svg {...common}>
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8" />
          <path d="M12 17v4" />
        </svg>
      );
    case "apps":
      return (
        <svg {...common}>
          <rect x="5" y="2" width="14" height="20" rx="2" />
          <line x1="12" y1="18" x2="12.01" y2="18" />
        </svg>
      );
    case "show_work":
      return (
        <svg {...common}>
          <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
        </svg>
      );
    case "best_deals":
      return (
        <svg {...common}>
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
          <line x1="7" y1="7" x2="7.01" y2="7" />
        </svg>
      );
    case "startups":
      return (
        <svg {...common}>
          <path d="M22 2L11 13" />
          <path d="M22 2L15 22l-4-9-9-4 20-7z" />
        </svg>
      );
    case "design":
      return (
        <svg {...common}>
          <circle cx="13.5" cy="6.5" r="2.5" />
          <circle cx="17.5" cy="10.5" r="2.5" />
          <circle cx="8.5" cy="7.5" r="2.5" />
          <circle cx="6.5" cy="12.5" r="2.5" />
          <path d="M12 20c-4 0-8-2-8-6s4-6 8-6 8 2 8 6-4 6-8 6z" />
        </svg>
      );
    case "collab":
      return (
        <svg {...common}>
          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 00-3-3.87" />
          <path d="M16 3.13a4 4 0 010 7.75" />
        </svg>
      );
    default:
      return null;
  }
}

function GroupsTab({
  onOpenGroup,
  openingRowId,
  selectedId,
}: {
  onOpenGroup: (id: string) => void;
  openingRowId: string | null;
  selectedId?: string | null;
}) {
  const { user } = useAuth();
  const { openAuthModal } = useAuthModal();
  return (
    <div className="ibx-group-list">
      {IBX_GROUPS.map((g) => (
        <div
          key={g.id}
          className={`ibx-group-row${selectedId === g.id ? " ibx-row-selected" : ""}`}
          onClick={() => {
            if (!user) {
              openAuthModal();
              return;
            }
            onOpenGroup(g.id);
          }}
        >
          <div className="ibx-group-av" style={{ background: g.color + "18", color: g.color }}>
            <GroupIcon id={g.id} />
          </div>
          <div className="ibx-group-info">
            <div className="ibx-group-name">{g.name}</div>
            <div className="ibx-group-desc">{g.desc}</div>
          </div>
          <div className="ibx-group-meta">
            {openingRowId === g.id ? (
              <div className="ibx-load-more-spinner" style={{ width: 14, height: 14 }} />
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
                <path d="M9 18l6-6-6-6" />
              </svg>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
