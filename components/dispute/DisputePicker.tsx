"use client";

import { useEffect, useState } from "react";
import { auth, db } from "@/lib/firebase";
import { useScrollLock } from "@/lib/useScrollLock";

// Ports window.__openDisputePicker from Js/misc-modals.js (lines 153-331)
// + the #srfDisputeOverlay markup (index.html lines 5384-5443). CSS
// classes (#srfDisputeOverlay, .srf-dispute-*, etc.) already exist in
// app/globals.css from Step 1, unchanged here.
//
// This is a standalone deal-selection flow, not a reuse of
// lib/useDealChat.ts's raiseDispute() — that hook is scoped to one
// already-open chat room (useDealChat(chatRoomId)), whereas this picker
// needs to list *all* of the signed-in user's disputable deals across
// every chat room first, exactly like the original's own direct
// Firestore query (there's no list-my-disputable-deals API action to
// call instead). Once a deal is picked, submission still goes through
// the same /api/deal { action: 'escrow-dispute' } the chat panel uses.
export interface DisputableDeal {
  dealId: string;
  chatRoomId: string;
  listingTitle?: string;
  sellerUid?: string;
  buyerUid?: string;
  sellerName?: string;
  buyerName?: string;
  paymentStatus?: string;
  escrowAmount?: number | null;
  offerPrice?: number | null;
  listingPrice?: number | null;
}

// A deal the user has already disputed at some point — read straight off
// their own users/{uid}/deals docs, which handleEscrowDispute() mirrors
// disputedAt/disputeReason onto at filing time, and which the resolve/
// release/refund paths already mirror paymentStatus + completedAt/
// refundedAt onto regardless of whether resolution came from a normal
// delivery confirmation or an admin dispute resolution. "Pending" is
// paymentStatus === 'disputed'; anything else (complete/refunded) that
// still carries a disputedAt is a resolved dispute.
export interface DisputeHistoryItem {
  dealId: string;
  listingTitle?: string;
  paymentStatus?: string;
  disputeReason?: string;
  disputedAt?: { toMillis?: () => number; seconds?: number } | number | null;
  completedAt?: { toMillis?: () => number; seconds?: number } | number | null;
  refundedAt?: { toMillis?: () => number; seconds?: number } | number | null;
}

// Statuses still eligible to dispute — mirrors the server-side check in
// /api/deal's escrow-dispute action exactly, so nothing shown here could
// fail server-side.
const DISPUTABLE_STATUSES = ["funded", "delivered"];

function fmtAmount(d: DisputableDeal): string {
  const amt =
    typeof d.escrowAmount === "number"
      ? d.escrowAmount
      : typeof d.offerPrice === "number"
        ? d.offerPrice
        : typeof d.listingPrice === "number"
          ? d.listingPrice
          : null;
  return amt != null ? "$" + amt.toLocaleString() : "—";
}

function otherParty(d: DisputableDeal, myUid: string): string {
  const iAmSeller = d.sellerUid === myUid;
  return iAmSeller ? d.buyerName || "the buyer" : d.sellerName || "the seller";
}

function statusLabel(status?: string): string {
  return status === "delivered" ? "Delivered — awaiting your confirmation" : "Funded — in escrow";
}

// Firestore Timestamp | millis | null → millis, defensively (mirrors the
// boostDaysLeft-style helpers used elsewhere in this app for the same
// "could be a real Timestamp or a plain number depending on write path"
// situation).
function toMillis(v: DisputeHistoryItem["disputedAt"]): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v.seconds === "number") return v.seconds * 1000;
  return null;
}

function fmtDate(v: DisputeHistoryItem["disputedAt"]): string {
  const ms = toMillis(v);
  if (!ms) return "";
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

type LoadState = "loading" | "empty" | "error" | "ready";
type Tab = "file" | "history";
type HistoryState = "loading" | "empty" | "error" | "ready";

export default function DisputePicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  useScrollLock(open);
  const [tab, setTab] = useState<Tab>("file");

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [emptyTitle, setEmptyTitle] = useState("No deals yet");
  const [emptyMsg, setEmptyMsg] = useState(
    "You don't have any in-progress deals that can be disputed right now. This only applies to deals that are funded or delivered but not yet complete."
  );
  const [deals, setDeals] = useState<DisputableDeal[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [myUid, setMyUid] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const [historyState, setHistoryState] = useState<HistoryState>("loading");
  const [history, setHistory] = useState<DisputeHistoryItem[]>([]);

  // Ports _loadDeals — runs once each time the picker opens (App Router
  // has no direct equivalent of "call this function to open me", so the
  // parent controls `open` and this effect-free load happens on mount
  // via the open-gated render below rather than a useEffect, since the
  // original's own load only ever runs from a single button click too).
  async function loadDeals() {
    setLoadState("loading");
    setSelectedId("");
    setReason("");
    setErr("");

    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Please sign in first.");
      setMyUid(user.uid);

      const { collection, query, where, getDocs } = await import("firebase/firestore");

      const snap = await getDocs(
        query(collection(db, "users", user.uid, "deals"), where("paymentStatus", "in", DISPUTABLE_STATUSES))
      );

      const loaded: DisputableDeal[] = snap.docs
        .map((docSnap) => {
          const data = docSnap.data() as Record<string, unknown>;
          const deal: DisputableDeal = {
            dealId: (data.dealId as string) || docSnap.id,
            chatRoomId: (data.chatRoomId as string) || "",
            listingTitle: data.listingTitle as string | undefined,
            sellerUid: data.sellerUid as string | undefined,
            buyerUid: data.buyerUid as string | undefined,
            sellerName: data.sellerName as string | undefined,
            buyerName: data.buyerName as string | undefined,
            paymentStatus: data.paymentStatus as string | undefined,
            escrowAmount: data.escrowAmount as number | null | undefined,
            offerPrice: data.offerPrice as number | null | undefined,
            listingPrice: data.listingPrice as number | null | undefined,
          };
          return deal;
        })
        // must have an active deal chat to dispute
        .filter((d) => d.chatRoomId);

      if (!loaded.length) {
        setDeals([]);
        setLoadState("empty");
        return;
      }

      setDeals(loaded);
      setSelectedId(loaded[0].dealId);
      setLoadState("ready");
    } catch (e) {
      console.error("[dispute picker] load failed", e);
      setEmptyTitle("Could not load deals");
      setEmptyMsg(e instanceof Error ? e.message : "Something went wrong loading your deals. Please try again.");
      setLoadState("error");
    }
  }

  // Loads every deal the user has ever disputed (pending or resolved),
  // newest first. A deal only shows here once disputedAt is actually set
  // on it, which handleEscrowDispute() now mirrors at filing time.
  async function loadHistory() {
    setHistoryState("loading");
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Please sign in first.");
      setMyUid(user.uid);

      const { collection, query, where, orderBy, getDocs } = await import("firebase/firestore");

      let snap;
      try {
        snap = await getDocs(
          query(collection(db, "users", user.uid, "deals"), where("disputedAt", "!=", null), orderBy("disputedAt", "desc"))
        );
      } catch {
        // Composite index on (disputedAt != null, disputedAt desc) may not
        // exist yet on older projects — fall back to an unordered scan and
        // sort client-side rather than hard-failing the whole tab.
        snap = await getDocs(query(collection(db, "users", user.uid, "deals"), where("disputedAt", "!=", null)));
      }

      const loaded: DisputeHistoryItem[] = snap.docs.map((docSnap) => {
        const data = docSnap.data() as Record<string, unknown>;
        return {
          dealId: docSnap.id,
          listingTitle: data.listingTitle as string | undefined,
          paymentStatus: data.paymentStatus as string | undefined,
          disputeReason: data.disputeReason as string | undefined,
          disputedAt: data.disputedAt as DisputeHistoryItem["disputedAt"],
          completedAt: data.completedAt as DisputeHistoryItem["completedAt"],
          refundedAt: data.refundedAt as DisputeHistoryItem["refundedAt"],
        };
      });

      loaded.sort((a, b) => (toMillis(b.disputedAt) || 0) - (toMillis(a.disputedAt) || 0));

      setHistory(loaded);
      setHistoryState(loaded.length ? "ready" : "empty");
    } catch (e) {
      console.error("[dispute picker] history load failed", e);
      setHistoryState("error");
    }
  }

  // Fire the load exactly once per open — mirrors the original calling
  // _loadDeals() fresh every time the dispute button is clicked.
  useEffect(() => {
    if (!open) return;
    setTab("file");
    setSubmitted(false);
    loadDeals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open && tab === "history") loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab]);

  if (!open) return null;

  const selected = deals.find((d) => d.dealId === selectedId);

  async function handleSubmit() {
    if (!selected) return;
    const trimmed = reason.trim();
    if (trimmed.length < 10) {
      setErr("Please describe the issue in a bit more detail (at least 10 characters).");
      return;
    }
    setErr("");
    setSubmitting(true);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Please sign in first.");
      const idToken = await user.getIdToken();

      const resp = await fetch("/api/deal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "escrow-dispute",
          idToken,
          chatRoomId: selected.chatRoomId,
          dealId: selected.dealId,
          reason: trimmed,
        }),
      });
      const out = await resp.json();
      if (!resp.ok) throw new Error(out.error || "Could not submit dispute");

      // Shows the in-modal success panel below instead of a native
      // window.alert() — same overlay/box, no browser chrome, and the
      // person can see it as long as they need rather than it vanishing
      // on its own like a toast would.
      setSubmitted(true);
    } catch (e) {
      console.error("[dispute picker] submit failed", e);
      setErr(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      id="srfDisputeOverlay"
      className="visible"
      style={{ display: "flex" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div id="srfDisputeBox">
        <div id="srfDisputeHeader">
          <div id="srfDisputeIcon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <div>
            <div id="srfDisputeTitle">{tab === "file" ? "Raise a Dispute" : "My Disputes"}</div>
            <div id="srfDisputeSub">{tab === "file" ? "Select the deal you'd like to flag" : "Pending and completed disputes"}</div>
          </div>
          <button id="srfDisputeClose" aria-label="Close" type="button" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {!submitted && (
          <div id="srfDisputeTabs">
            <button type="button" className={`srf-dispute-tab${tab === "file" ? " active" : ""}`} onClick={() => setTab("file")}>
              Raise a Dispute
            </button>
            <button type="button" className={`srf-dispute-tab${tab === "history" ? " active" : ""}`} onClick={() => setTab("history")}>
              My Disputes
            </button>
          </div>
        )}

        <div id="srfDisputeBody" data-scroll-lock-exempt>
          {submitted ? (
            <div id="srfDisputeSuccess" style={{ display: "flex" }}>
              <div id="srfDisputeSuccessIcon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </div>
              <div id="srfDisputeSuccessTitle">Dispute submitted</div>
              <div id="srfDisputeSuccessMsg">Funds are frozen and our team will review within 24–48 hours.</div>
            </div>
          ) : tab === "file" ? (
            <>
              {loadState === "loading" && (
                <div id="srfDisputeLoading" style={{ display: "flex" }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="12" cy="12" r="9" opacity="0.25" />
                    <path d="M21 12a9 9 0 00-9-9" />
                  </svg>
                  Loading your deals…
                </div>
              )}

              {(loadState === "empty" || loadState === "error") && (
                <div id="srfDisputeEmpty" style={{ display: "flex" }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 12h6M9 16h6M9 8h6" />
                    <rect x="4" y="3" width="16" height="18" rx="2" />
                  </svg>
                  <div id="srfDisputeEmptyTitle">{emptyTitle}</div>
                  <div id="srfDisputeEmptyMsg">{emptyMsg}</div>
                </div>
              )}

              {loadState === "ready" && (
                <div id="srfDisputeForm" style={{ display: "flex" }}>
                  <div>
                    <label className="srf-dispute-label" htmlFor="srfDisputeSelect">
                      Deal
                    </label>
                    <div id="srfDisputeSelectWrap">
                      <select
                        id="srfDisputeSelect"
                        value={selectedId}
                        onChange={(e) => setSelectedId(e.target.value)}
                      >
                        {deals.map((d) => (
                          <option key={d.dealId} value={d.dealId}>
                            {d.listingTitle || "Untitled listing"} — with {otherParty(d, myUid)} ({fmtAmount(d)})
                          </option>
                        ))}
                      </select>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </div>
                  </div>

                  {selected && (
                    <div id="srfDisputeDealMeta" style={{ display: "flex" }}>
                      <span>
                        Amount in escrow: <b>{fmtAmount(selected)}</b> · {statusLabel(selected.paymentStatus)}
                      </span>
                    </div>
                  )}

                  <div>
                    <label className="srf-dispute-label" htmlFor="srfDisputeReason">
                      What went wrong?
                    </label>
                    <textarea
                      id="srfDisputeReason"
                      maxLength={500}
                      placeholder="Briefly describe the issue — our team will review within 24–48 hours."
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                    <div id="srfDisputeCharCount">{reason.length} / 500</div>
                  </div>

                  {err && <div id="srfDisputeError" style={{ display: "block" }}>{err}</div>}
                </div>
              )}
            </>
          ) : (
            <>
              {historyState === "loading" && (
                <div id="srfDisputeLoading" style={{ display: "flex" }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="12" cy="12" r="9" opacity="0.25" />
                    <path d="M21 12a9 9 0 00-9-9" />
                  </svg>
                  Loading your disputes…
                </div>
              )}

              {(historyState === "empty" || historyState === "error") && (
                <div id="srfDisputeEmpty" style={{ display: "flex" }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 12h6M9 16h6M9 8h6" />
                    <rect x="4" y="3" width="16" height="18" rx="2" />
                  </svg>
                  <div id="srfDisputeEmptyTitle">
                    {historyState === "error" ? "Could not load disputes" : "No disputes yet"}
                  </div>
                  <div id="srfDisputeEmptyMsg">
                    {historyState === "error"
                      ? "Something went wrong loading your dispute history. Please try again."
                      : "Disputes you raise or that are raised against your deals will show up here."}
                  </div>
                </div>
              )}

              {historyState === "ready" && (
                <div id="srfDisputeHistoryList">
                  {history.map((h) => {
                    const isPending = h.paymentStatus === "disputed";
                    const resolvedAt = h.completedAt ?? h.refundedAt;
                    return (
                      <div className="srf-dispute-history-item" key={h.dealId}>
                        <div className="srf-dispute-history-top">
                          <div className="srf-dispute-history-title">{h.listingTitle || "Untitled listing"}</div>
                          <span className={`srf-dispute-status-pill ${isPending ? "pending" : "completed"}`}>
                            {isPending ? "Pending" : "Completed"}
                          </span>
                        </div>
                        {h.disputeReason && <div className="srf-dispute-history-reason">{h.disputeReason}</div>}
                        <div className="srf-dispute-history-meta">
                          Filed {fmtDate(h.disputedAt)}
                          {!isPending && resolvedAt ? ` · Resolved ${fmtDate(resolvedAt)}` : ""}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        <div id="srfDisputeActions">
          {submitted ? (
            <button className="srf-dispute-btn cancel" type="button" onClick={onClose}>
              Done
            </button>
          ) : (
            <>
              <button className="srf-dispute-btn cancel" type="button" onClick={onClose}>
                Cancel
              </button>
              {tab === "file" && loadState === "ready" && (
                <button
                  className={`srf-dispute-btn submit${submitting ? " is-loading" : ""}`}
                  type="button"
                  style={{ display: "flex" }}
                  disabled={submitting}
                  onClick={handleSubmit}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="12" cy="12" r="9" opacity="0.25" />
                    <path d="M21 12a9 9 0 00-9-9" />
                  </svg>
                  <span>{submitting ? "Submitting…" : "Submit Dispute"}</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
