"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import type { Listing } from "@/lib/listings";
import { aiStudioCall } from "@/lib/aiStudio";
import { useLimits } from "@/lib/useLimits";
import { useCurrency } from "@/lib/CurrencyContext";
import { useScrollLock } from "@/lib/useScrollLock";

// Ports the Send Deal popup + Deal Outcome popup from Js/marketplace.js
// (mpOpenDeal/mpCloseDeal/mpShowDealOutcome/_mpRenderOutcome/the
// mpDealSubmit click handler, lines ~3772-4117) + the #mpDealPopup /
// #mpDealOutcomePopup markup in index.html (lines 1997-2105). CSS
// classes (.mp-deal-*, .mp-outcome-*) already exist in app/globals.css
// from Step 1, unchanged here.
//
// Both popups are built as one component (not split into two, and not
// two separate providers) because they share state in the original:
// the outcome popup only ever opens as a direct continuation of a deal
// that was just sent from this same popup, and there is no other entry
// point into it. DealPopupProvider (sibling file) exposes the single
// `openDeal(listing)` entry point; everything else here is internal.
//
// DEAL_MSG_MIN_LENGTH now comes from useLimits() (GET /api/limits,
// LIMITS.deals.messageMinLength) inside the component below.
// FALLBACK_DEAL_MSG_MIN_LENGTH is used only until that fetch resolves.
//
// mpDealAiBtn ("✨ AI Assist"): earlier ported as omitted, on the belief
// it was dead/unwired in the original. That was wrong — it's wired in
// Js/ai-support-chat.js (loaded on every page, not marketplace.js where
// the rest of this popup's logic lives), calling window.__aiStudioCall
// ('deal-message-assist', {...}) to draft the buyer's message from the
// listing title/summary, offer amount, and whatever the buyer has typed
// so far. Ported below via the shared lib/aiStudio.ts helper.
const FALLBACK_DEAL_MSG_MIN_LENGTH = 30;

const SEND_DEAL_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

type OutcomeState = "auto_accept" | "pending";

interface LeafStyle {
  key: number;
  style: React.CSSProperties;
}

// Note: the offer amount input further down stays in raw USD — it's
// submitted straight to POST /api/deal as offerPrice with no conversion
// (see handleSubmit below), and app/api/paypal/_handler.js settles every
// real charge in USD regardless of display currency. Only the read-only
// "Listed price" figures (lPrice/listedPriceBox) convert for display.

// Same 2h:00:00 countdown format as _mpOutcomeStartCountdown — in-memory
// only, resets if the popup is closed and reopened, exactly like the
// original (never persisted anywhere).
function useOutcomeCountdown(active: boolean) {
  const [label, setLabel] = useState("2:00:00");
  useEffect(() => {
    if (!active) return;
    let secondsLeft = 2 * 60 * 60;
    const render = () => {
      const h = Math.floor(secondsLeft / 3600);
      const m = Math.floor((secondsLeft % 3600) / 60);
      const s = secondsLeft % 60;
      setLabel(`${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
    };
    render();
    const timer = setInterval(() => {
      secondsLeft = Math.max(0, secondsLeft - 1);
      render();
      if (secondsLeft <= 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [active]);
  return label;
}

export default function DealPopup({
  listing,
  onClose,
}: {
  listing: Listing | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { limits } = useLimits();
  const { formatPrice } = useCurrency();
  const DEAL_MSG_MIN_LENGTH = limits.deals.messageMinLength ?? FALLBACK_DEAL_MSG_MIN_LENGTH;

  const [msg, setMsg] = useState("");
  const [offerInput, setOfferInput] = useState("");
  const [err, setErr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [leaves, setLeaves] = useState<LeafStyle[]>([]);

  const [outcome, setOutcome] = useState<OutcomeState | null>(null);
  const [outcomeChatRoomId, setOutcomeChatRoomId] = useState<string | null>(null);
  const outcomeCountdown = useOutcomeCountdown(outcome === "pending");

  // ── AI Assist (ports mpDealAiBtn from ai-support-chat.js) ──
  const [aiAssisting, setAiAssisting] = useState(false);

  const sendTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeAfterSuccessRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset all state every time a (possibly different) listing is opened —
  // same as mpOpenDeal resetting msgEl/charEl/errEl/successEl/submitEl on
  // every open, since this popup is reused across listings.
  useEffect(() => {
    if (listing) {
      setMsg("");
      setOfferInput("");
      setErr("");
      setSubmitting(false);
      setSuccess(false);
      setOutcome(null);
      setOutcomeChatRoomId(null);
    }
    return () => {
      if (sendTimeoutRef.current) clearTimeout(sendTimeoutRef.current);
      if (closeAfterSuccessRef.current) clearTimeout(closeAfterSuccessRef.current);
    };
  }, [listing]);

  // Both popups in this component are custom overlays (not <dialog>), so
  // like every other modal in the app they need the shared scroll lock —
  // otherwise the page underneath keeps scrolling while this is open.
  useScrollLock(Boolean(listing) || outcome !== null);

  if (!listing && outcome === null) return null;

  const buyerName = profile?.username || user?.displayName || user?.email?.split("@")[0] || "You";
  const buyerPic = profile?.profilePic || "";

  const typeWord = listing?.type === "app" ? "app" : listing?.type === "game" ? "game" : "website";
  const introMsg = `Hi! I'm interested in this ${typeWord} — is it still available?`;

  const cover = listing?.images?.[2] || listing?.imageCover || listing?.images?.[0] || "";
  const lTitle = listing?.title || "Untitled";
  const lDesc = listing?.description || "";

  async function handleAiAssist() {
    setAiAssisting(true);
    try {
      const result = await aiStudioCall<{ message?: string }>("deal-message-assist", {
        listingTitle: lTitle,
        listingSummary: lDesc,
        offerAmount: offerInput,
        userDraft: msg.trim(),
      });
      setMsg(result.message || "");
    } catch (e) {
      console.error("Deal message assist failed:", e);
      setErr("Could not generate a message right now — please try again or write your own.");
    } finally {
      setAiAssisting(false);
    }
  }
  const lPrice = formatPrice(listing?.financials?.price);
  const lId = listing?.id ? listing.id.slice(0, 8).toUpperCase() : "—";
  const listedPriceBox = formatPrice(listing?.financials?.price);

  function closeDeal() {
    if (sendTimeoutRef.current) clearTimeout(sendTimeoutRef.current);
    onClose();
  }

  function closeOutcome() {
    setOutcome(null);
  }

  // Ports _mpRenderOutcome's theming, trimmed down: only two outcomes are
  // reachable now, both resolved synchronously by create-deal's response.
  // "auto_accept" is the seller's built-in auto-accept firing instantly;
  // manual accept/reject happens later, asynchronously, via the Inbox —
  // not inside this popup — so those states no longer apply here.
  function renderOutcomeContent(state: OutcomeState) {
    if (state === "auto_accept") {
      return {
        theme: "theme-accept",
        title: "Deal auto-accepted!",
        sub: "This seller has auto-accept turned on and your offer met their threshold. You're in the deal chat now — let's get moving.",
        showTimer: false,
      };
    }
    return {
      theme: "theme-pending",
      title: "Offer pending",
      sub: "This deal needs the seller's review — they'll accept or reject it manually.",
      showTimer: true,
    };
  }

  async function handleSubmit() {
    if (!listing || !user) return;

    setErr("");
    const trimmed = msg.trim();
    if (trimmed.length < DEAL_MSG_MIN_LENGTH) {
      setErr(`Please write at least ${DEAL_MSG_MIN_LENGTH} characters in your message.`);
      return;
    }

    setSubmitting(true);
    // Safety net: if something hangs without throwing, don't leave the
    // button stuck forever — restore it after 15s, same as the original.
    sendTimeoutRef.current = setTimeout(() => {
      setSubmitting(false);
    }, 15000);

    try {
      const idToken = await user.getIdToken();

      const offerRaw = parseFloat(offerInput);
      const offerPrice = !isNaN(offerRaw) && offerRaw > 0 ? offerRaw : null;

      const resp = await fetch("/api/deal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create-deal",
          idToken,
          listingId: listing.id,
          message: trimmed,
          offerPrice,
        }),
      });
      const out = await resp.json();
      if (!resp.ok) {
        // 409 = duplicate pending deal already exists on this listing.
        // 400 = e.g. "You can't send a deal on your own listing" —
        // server-enforced, this popup has no client-side owner guard
        // of its own, same as the original.
        throw new Error(out.error || "Something went wrong. Please try again.");
      }

      if (sendTimeoutRef.current) clearTimeout(sendTimeoutRef.current);

      // create-deal now resolves the seller's built-in auto-accept
      // synchronously and returns the outcome directly (status +
      // chatRoomId when accepted), instead of us having to separately
      // read agentConfig and subscribe to the deal doc ourselves. Much
      // faster, and no risk of racing an in-flight auto-accept.
      const dealStatus = out.status as "accepted" | "pending" | undefined;
      const chatRoomId = out.chatRoomId as string | undefined;

      // Show success animation — same spawn-14-leaves trick as the original.
      setSuccess(true);
      setLeaves(
        Array.from({ length: 14 }, (_, i) => ({
          key: i,
          style: {
            left: `${20 + Math.random() * 60}%`,
            top: `${10 + Math.random() * 30}%`,
            animationDelay: `${(Math.random() * 0.6).toFixed(2)}s`,
            animationDuration: `${(1.1 + Math.random() * 0.8).toFixed(2)}s`,
            width: `${8 + Math.random() * 8}px`,
            height: `${11 + Math.random() * 8}px`,
            background: Math.random() > 0.4 ? "#a3e635" : Math.random() > 0.5 ? "#86efac" : "#4ade80",
            transform: `rotate(${Math.random() * 360}deg)`,
          },
        }))
      );

      // After the success tick, show the outcome directly from the
      // response — no extra reads, no waiting.
      closeAfterSuccessRef.current = setTimeout(() => {
        onClose();
        if (dealStatus === "accepted" && chatRoomId) {
          setOutcomeChatRoomId(chatRoomId);
          setOutcome("auto_accept");
        } else {
          setOutcome("pending");
        }
      }, 1400);
    } catch (e) {
      console.error("Deal send error:", e);
      if (sendTimeoutRef.current) clearTimeout(sendTimeoutRef.current);
      setErr(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  const outcomeContent = outcome ? renderOutcomeContent(outcome) : null;

  return (
    <>
      {listing && (
        <div
          id="mpDealPopup"
          style={{ display: "flex" }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeDeal();
          }}
        >
          <div className="mp-deal-box">
            <div className="mp-deal-header">
              <span className="mp-deal-header-title">Send Deal</span>
              <button className="mp-deal-close" onClick={closeDeal} aria-label="Close">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="mp-deal-buyer-row">
              <div className="mp-deal-buyer-av">
                {buyerPic ? <img src={buyerPic} alt={buyerName} /> : buyerName.charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="mp-deal-buyer-label">Sending as</div>
                <div className="mp-deal-buyer-name">{buyerName}</div>
              </div>
            </div>

            <div className="mp-deal-intro">{introMsg}</div>

            <div className="mp-deal-field">
              <label className="mp-deal-label">
                Your message <span className="mp-deal-req">*</span>
              </label>
              <textarea
                className="mp-deal-textarea"
                placeholder="Tell the seller more about yourself and why you're interested…"
                maxLength={1000}
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
              />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <button
                  type="button"
                  className="ai-autogen-btn"
                  id="mpDealAiBtn"
                  onClick={handleAiAssist}
                  disabled={aiAssisting}
                >
                  <span>{aiAssisting ? "✨ Writing…" : "✨ AI Assist"}</span>
                </button>
                <div className={`mp-deal-char${msg.length >= DEAL_MSG_MIN_LENGTH ? " ok" : ""}`}>
                  {msg.length} / {DEAL_MSG_MIN_LENGTH} min
                </div>
              </div>
            </div>

            <div className="mp-deal-offer-row">
              <div className="mp-deal-offer-field">
                <label className="mp-deal-label">
                  Your offer{" "}
                  <span style={{ color: "rgba(255,255,255,0.25)", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                    (optional, in USD)
                  </span>
                </label>
                <div className="mp-deal-offer-wrap">
                  <span className="mp-deal-currency">$</span>
                  <input
                    className="mp-deal-offer-input"
                    type="number"
                    min={1}
                    step={1}
                    placeholder="e.g. 500"
                    value={offerInput}
                    onChange={(e) => setOfferInput(e.target.value)}
                  />
                </div>
                <div className="mp-deal-offer-hint">Leave blank to offer listed price</div>
              </div>
              <div className="mp-deal-offer-field">
                <div className="mp-deal-label">Listed price</div>
                <div className="mp-deal-listed-price-box">{listedPriceBox}</div>
              </div>
            </div>

            <div className="mp-deal-preview">
              {cover && <img className="mp-deal-preview-img" src={cover} alt="" onError={(e) => (e.currentTarget.style.display = "none")} />}
              <div className="mp-deal-preview-info">
                <div className="mp-deal-preview-uid">ID: {lId}</div>
                <div className="mp-deal-preview-title">{lTitle}</div>
                <div className="mp-deal-preview-desc">{lDesc.slice(0, 80)}{lDesc.length > 80 ? "…" : ""}</div>
                <div className="mp-deal-preview-price">{lPrice}</div>
              </div>
            </div>

            {err && <div className="mp-deal-err">{err}</div>}

            {!success && (
              <button className="mp-deal-submit" disabled={submitting} onClick={handleSubmit}>
                {submitting ? "Sending…" : (<>{SEND_DEAL_ICON} Send Deal</>)}
              </button>
            )}

            {success && (
              <div className="mp-deal-success" style={{ display: "flex" }}>
                <div className="mp-deal-success-leaves">
                  {leaves.map((l) => (
                    <div key={l.key} className="mp-leaf" style={l.style} />
                  ))}
                </div>
                <svg className="mp-deal-tick" viewBox="0 0 52 52">
                  <circle className="mp-tick-circle" cx="26" cy="26" r="25" fill="none" />
                  <path className="mp-tick-check" fill="none" d="M14 27l8 8 16-16" />
                </svg>
                <div className="mp-deal-success-text">Deal sent!</div>
                <div className="mp-deal-success-sub">The seller will be notified.</div>
              </div>
            )}
          </div>
        </div>
      )}

      {outcome && outcomeContent && (
        <div
          id="mpDealOutcomePopup"
          style={{ display: "flex" }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeOutcome();
          }}
        >
          <div className={`mp-outcome-box ${outcomeContent.theme}`}>
            <button className="mp-outcome-close" onClick={closeOutcome} aria-label="Close">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            <div className="mp-outcome-icon-wrap">
              {outcome === "auto_accept" && (
                <svg viewBox="0 0 52 52">
                  <circle className="mp-outcome-circle" cx="26" cy="26" r="24" fill="none" />
                  <path className="mp-outcome-path" fill="none" d="M14 27l8 8 16-16" />
                </svg>
              )}
              {outcome === "pending" && (
                <svg viewBox="0 0 52 52">
                  <circle className="mp-outcome-circle" cx="26" cy="26" r="24" fill="none" />
                  <path className="mp-outcome-path-pending" fill="none" d="M26 14v12l8 6" />
                </svg>
              )}
            </div>
            <div className="mp-outcome-title">{outcomeContent.title}</div>
            <div className="mp-outcome-sub">{outcomeContent.sub}</div>
            {outcomeContent.showTimer && (
              <div className="mp-outcome-timer-wrap" style={{ display: "flex" }}>
                <div className="mp-outcome-timer-label">Sellers usually reply within</div>
                <div className="mp-outcome-timer">{outcomeCountdown}</div>
              </div>
            )}
            <button
              className="mp-outcome-ok"
              onClick={() => {
                if (outcome === "auto_accept" && outcomeChatRoomId) {
                  closeOutcome();
                  router.push(`/messages/deal/${outcomeChatRoomId}`);
                } else {
                  closeOutcome();
                }
              }}
            >
              {outcome === "auto_accept" ? "Open Deal Chat" : "Got it"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
