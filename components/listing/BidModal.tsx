"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { useAuthModal } from "@/components/auth/AuthModalProvider";
import { useScrollLock } from "@/lib/useScrollLock";
import { useCurrency } from "@/lib/CurrencyContext";
import { useAuctionTimer } from "@/lib/useAuctionTimer";
import { placeBid, ListingsApiError, MIN_BID_INCREMENT_PCT } from "@/lib/listings";
import type { Listing } from "@/lib/listings";

// Mirrors the buildAuction/handleBid pair in _handler.js for the live
// minimum-bid preview shown as the bidder types — display only. The
// server independently recomputes and enforces this same 10% rule against
// its own just-read copy of the listing, so a stale/mismatched client
// value here can never let an actual under-minimum bid through; worst
// case the server rejects it and BidModal shows the returned message.
function minValidBid(baseline: number): number {
  return Math.round(baseline * (1 + MIN_BID_INCREMENT_PCT) * 100) / 100;
}

export default function BidModal({
  listing,
  onClose,
  onBidPlaced,
}: {
  listing: Listing;
  onClose: () => void;
  onBidPlaced?: (currentBid: number) => void;
}) {
  const { user } = useAuth();
  const { openAuthModal } = useAuthModal();
  const { formatBalance } = useCurrency();
  const auction = listing.auction!;
  const { phase, label } = useAuctionTimer(auction);

  const [amt, setAmt] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [localCurrentBid, setLocalCurrentBid] = useState(auction.currentBid ?? null);
  const [localBidCount, setLocalBidCount] = useState(auction.bidCount ?? 0);

  useScrollLock(true);

  useEffect(() => {
    if (!user) {
      onClose();
      openAuthModal();
    }
    // Only checked once on mount, mirroring DonateOverlay's same guard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const baseline = typeof localCurrentBid === "number" ? localCurrentBid : auction.startPrice;
  const minBid = minValidBid(baseline);
  const amtNum = parseFloat(amt);
  const isOwner = listing.ownerId === user?.uid;

  async function handleSubmit() {
    setMsg(null);
    if (!user) {
      onClose();
      openAuthModal();
      return;
    }
    if (isOwner) {
      setMsg({ text: "You can't bid on your own listing.", ok: false });
      return;
    }
    if (phase !== "live") {
      setMsg({
        text: phase === "upcoming" ? "This auction hasn't started yet." : "This auction has ended.",
        ok: false,
      });
      return;
    }
    if (!amtNum || amtNum < minBid) {
      setMsg({ text: `Your bid must be at least ${formatBalance(minBid)}.`, ok: false });
      return;
    }

    setSubmitting(true);
    try {
      const idToken = await user.getIdToken();
      const result = await placeBid({ idToken, listingId: listing.id, amount: amtNum });
      setLocalCurrentBid(result.currentBid);
      setLocalBidCount((c) => c + 1);
      setMsg({ text: `✓ Bid placed at ${formatBalance(result.currentBid)}!`, ok: true });
      setAmt("");
      onBidPlaced?.(result.currentBid);
    } catch (err) {
      // ListingsApiError carries the exact server-rejection message (e.g.
      // "Your bid must be at least $110.00…", "This auction has already
      // ended.") — surfaced verbatim rather than a generic failure banner,
      // since the server's copy already explains exactly what to fix.
      const message =
        err instanceof ListingsApiError ? err.message : "Something went wrong. Please try again.";
      setMsg({ text: message, ok: false });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      id="srfBidOverlay"
      className="active"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div id="srfBidBox">
        <div id="srfBidStickyHeader">
          <button id="srfBidClose" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <div id="srfBidHeader">
            <div id="srfBidTitle">Bid on {listing.title || "this listing"}</div>
            <div id="srfBidSubtitle" data-phase={phase}>
              {phase === "upcoming" && <>Starts in {label}</>}
              {phase === "live" && <>Ends in {label}</>}
              {phase === "ended" && <>This auction has ended</>}
            </div>
          </div>
        </div>

        <div id="srfBidScroll" data-scroll-lock-exempt>
          <div id="srfBidSummary">
            <div className="sp-donate-summary-stat">
              <div className="sp-donate-summary-val">
                {formatBalance(typeof localCurrentBid === "number" ? localCurrentBid : auction.startPrice)}
              </div>
              <div className="sp-donate-summary-lbl">{localBidCount ? "Current bid" : "Starting price"}</div>
            </div>
            <div className="sp-donate-summary-divider" />
            <div className="sp-donate-summary-stat">
              <div className="sp-donate-summary-val">{localBidCount}</div>
              <div className="sp-donate-summary-lbl">{localBidCount === 1 ? "Bid" : "Bids"}</div>
            </div>
          </div>

          {phase === "live" && !isOwner ? (
            <>
              <div className="wallet-field-label" style={{ marginTop: 4 }}>
                Your bid (minimum {formatBalance(minBid)})
              </div>
              <div className="wallet-amount-input-wrap">
                <span className="wallet-amount-currency">$</span>
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder={minBid.toFixed(2)}
                  min={minBid}
                  step={0.01}
                  value={amt}
                  onChange={(e) => setAmt(e.target.value)}
                />
              </div>
              <div className="wallet-fee-breakdown">
                <div className="wallet-fee-line">
                  <span>Minimum next bid (+10%)</span>
                  <span>{formatBalance(minBid)}</span>
                </div>
              </div>
            </>
          ) : null}

          {isOwner && (
            <div className="wallet-msg" style={{ marginTop: 4 }}>
              You&apos;re the seller — you can&apos;t bid on your own listing.
            </div>
          )}

          {msg && <div className={`wallet-msg ${msg.ok ? "ok" : "err"}`}>{msg.text}</div>}

          {phase === "live" && !isOwner ? (
            <button
              id="srfBidSubmitBtn"
              onClick={handleSubmit}
              disabled={submitting || !amtNum || amtNum < minBid}
            >
              {submitting ? "Placing bid…" : "Place bid"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
