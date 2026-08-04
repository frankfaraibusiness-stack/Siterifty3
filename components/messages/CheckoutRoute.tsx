"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/AuthContext";
import { useDealChat } from "@/lib/useDealChat";
import { useCurrency } from "@/lib/CurrencyContext";
import SignInRequired from "@/components/auth/SignInRequired";
import { buildListingSlug } from "@/lib/slug";

// Real buyer checkout summary for a deal — reached via DealChatPanel's
// "Pay Now" CTA (handlePay). Same "give it a real route" reasoning as
// TransferDealRoute.tsx: a proper navigation entry rather than a modal
// glued to the chat, so refresh/back/share all behave normally.
//
// Every number and label here is real deal data (useDealChat's room —
// same source DealChatPanel itself reads), not placeholder content. The
// one thing that is NOT real yet is the actual charge: Siterifty doesn't
// currently hold a money-transmitter/custodial license to move funds
// directly (see handlePay's own comment in DealChatPanel.tsx), so the
// "Pay" action below shows the same honest "new checkout is coming"
// state instead of pretending to process a card. Swap PAY_LIVE to true
// (and wire submitPayment) once a licensed escrow/split provider is
// integrated — nothing else on this page needs to change.
const PAY_LIVE = false;

// Flat buyer service fee — the buyer-side platform cut. This is separate
// from (and unaffected by) the seller's plan-based payout fee, which is
// computed later at release time (see app/api/deal/_handler.js) and is
// not shown here since it doesn't affect what the buyer owes.
const BUYER_FEE_RATE = 0.1;

function usd(amount: number): string {
  return `$${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Loading placeholder for CheckoutRoute — same two-column shape
// (checkout-summary / checkout-payment) as the real content, built from
// the shared .skel-block shimmer class already used by
// ListingDetailSkeleton and the marketplace card skeletons, so it reads
// as "this page is arriving" rather than a dead blank screen.
export function CheckoutRouteSkeleton({ onBack }: { onBack?: () => void }) {
  return (
    <div className="checkout-route">
      <div className="checkout-shell">
        <button onClick={onBack} disabled={!onBack} className="checkout-close" aria-label="Back to chat">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to chat
        </button>

        <div className="checkout-summary">
          <div className="skel-block" style={{ width: 140, height: 22, borderRadius: 20, marginBottom: 14 }} />
          <div className="skel-block skel-text lg" style={{ width: "50%", marginBottom: 8 }} />
          <div className="skel-block skel-text" style={{ width: "75%", marginBottom: 20 }} />

          <div className="checkout-item">
            <div className="checkout-item-thumb">
              <div className="skel-block" style={{ width: "100%", height: "100%" }} />
            </div>
            <div className="checkout-item-info">
              <div className="skel-block skel-text" style={{ width: "70%" }} />
            </div>
            <div className="skel-block skel-text" style={{ width: 50 }} />
          </div>

          <div className="checkout-breakdown">
            <div className="skel-block skel-text" style={{ width: "100%", marginBottom: 10 }} />
            <div className="skel-block skel-text" style={{ width: "100%", marginBottom: 10 }} />
            <div className="skel-block skel-text" style={{ width: "100%" }} />
          </div>
        </div>

        <div className="checkout-payment">
          <div className="skel-block skel-text" style={{ width: "60%", marginBottom: 16 }} />
          <div className="skel-block" style={{ width: "100%", height: 46, borderRadius: 12 }} />
        </div>
      </div>
    </div>
  );
}

export default function CheckoutRoute({ chatRoomId }: { chatRoomId: string }) {
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const chat = useDealChat(chatRoomId);
  // Display-only conversion — same as every other price in the app
  // (marketplace cards, listing page, donate overlay). The actual charge
  // is always USD (see PAY_LIVE's comment below), so `usd()` stays
  // available for anywhere we need to be explicit about the real amount
  // billed, while formatBalance drives what the buyer sees as the
  // headline figures in their own local currency.
  const { formatBalance, currency } = useCurrency();
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  function goBackToChat() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.replace(`/messages/deal/${chatRoomId}`);
    }
  }

  if (authLoading) return null;

  if (!user) {
    return (
      <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <SignInRequired
          fullScreen={false}
          title="Sign in to continue checkout"
          description="This deal's checkout is only visible to the buyer once signed in."
        />
      </div>
    );
  }

  if (!chat.room) {
    // Room doc is still loading (or doesn't exist). Previously this
    // rendered nothing, which — combined with no route-level loading.tsx
    // for this segment — meant clicking "Pay Now" produced a blank page
    // (footer briefly visible with nothing above it) until the room doc
    // resolved. This skeleton mirrors the real checkout-summary /
    // checkout-payment two-block shape so the transition feels instant
    // and nothing ever "pops in" on top of empty space.
    return <CheckoutRouteSkeleton onBack={goBackToChat} />;
  }

  const { room } = chat;
  const isBuyer = user.uid === room.buyerUid;

  // Only the buyer ever has anything to pay here.
  if (!isBuyer) {
    return (
      <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ textAlign: "center", maxWidth: 360 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#f1f1f3", marginBottom: 8 }}>
            This checkout isn&apos;t yours
          </div>
          <div style={{ fontSize: 13.5, color: "rgba(255,255,255,0.5)", lineHeight: 1.6, marginBottom: 20 }}>
            Only the buyer on this deal can view its checkout.
          </div>
          <button onClick={goBackToChat} className="checkout-back-btn">
            Back to chat
          </button>
        </div>
      </div>
    );
  }

  // Already funded (or further along) — there's nothing left to pay,
  // checkout doesn't apply anymore. Send them back to the chat, which
  // shows the correct state (release/dispute actions, outcome banner,
  // etc.) for wherever the deal actually is now.
  if (room.paymentStatus !== "unfunded") {
    return (
      <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ textAlign: "center", maxWidth: 360 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#f1f1f3", marginBottom: 8 }}>
            This deal is already funded
          </div>
          <div style={{ fontSize: 13.5, color: "rgba(255,255,255,0.5)", lineHeight: 1.6, marginBottom: 20 }}>
            There&apos;s nothing left to pay — head back to the chat to see where things stand.
          </div>
          <button onClick={goBackToChat} className="checkout-back-btn">
            Back to chat
          </button>
        </div>
      </div>
    );
  }

  const listingPrice = room.listingPrice ?? 0;
  const buyerFee = Math.round(listingPrice * BUYER_FEE_RATE * 100) / 100;
  const total = listingPrice + buyerFee;
  const buyerName = profile?.username || user.email?.split("@")[0] || "You";
  const buyerEmail = user.email || "";
  const listingHref = room.listingId ? `/listing/${buildListingSlug(room.listingTitle, room.listingId)}` : null;

  async function handlePay() {
    setSubmitting(true);
    // See PAY_LIVE's comment at the top of this file — this intentionally
    // does not move any money. Same message DealChatPanel's own Pay Now
    // button shows, so the buyer sees one consistent story whether they
    // land here from the chat CTA or a direct link.
    await new Promise((r) => setTimeout(r, 400));
    setSubmitting(false);
    setNotice(
      "We're switching escrow payments to a new payment provider. Paying into escrow from here is temporarily unavailable — check back shortly."
    );
  }

  return (
    <div className="checkout-route">
      <div className="checkout-shell">
        <button onClick={goBackToChat} className="checkout-close" aria-label="Back to chat">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to chat
        </button>

        {/* Order summary — every figure is the real deal's data. */}
        <div className="checkout-summary">
          <div className="checkout-badge">Escrow-protected purchase</div>
          <h1 className="checkout-title">Checkout</h1>
          <p className="checkout-subtitle">Review your order before paying into escrow.</p>

          <div className="checkout-item">
            <div className="checkout-item-thumb">
              {room.listingImage ? (
                <img src={room.listingImage} alt="" />
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <circle cx="12" cy="12" r="10" />
                </svg>
              )}
            </div>
            <div className="checkout-item-info">
              <div className="checkout-item-name">{room.listingTitle || "Listing"}</div>
              {listingHref ? (
                <Link href={listingHref} className="checkout-item-link">
                  View listing
                </Link>
              ) : null}
            </div>
            <div className="checkout-item-price">{formatBalance(listingPrice)}</div>
          </div>

          <div className="checkout-breakdown">
            <div className="checkout-row">
              <span>Listing price</span>
              <span>{formatBalance(listingPrice)}</span>
            </div>
            <div className="checkout-row">
              <span>Buyer service fee (10%)</span>
              <span>{formatBalance(buyerFee)}</span>
            </div>
            <div className="checkout-fee-note">Covers secure escrow processing and platform protection.</div>
            <div className="checkout-row checkout-row-total">
              <span>Total due today</span>
              <span>{formatBalance(total)}</span>
            </div>
            {currency !== "USD" && (
              <div className="checkout-fee-note">
                Charged as {usd(total)} USD — your card/bank converts this to {currency} at checkout.
              </div>
            )}
          </div>

          <div className="checkout-trust">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <span>
              Funds are held in escrow until you confirm delivery — the seller is paid only after you release
              the funds.
            </span>
          </div>
        </div>

        {/* Payment */}
        <div className="checkout-payment">
          <div className="checkout-buyer-row">
            <div className="checkout-buyer-label">Buyer</div>
            <div className="checkout-buyer-value">
              {buyerName}
              {buyerEmail ? <span className="checkout-buyer-email"> · {buyerEmail}</span> : null}
            </div>
          </div>

          {notice ? (
            <div className="checkout-notice">{notice}</div>
          ) : (
            <div className="checkout-notice checkout-notice-quiet">
              Payment isn&apos;t live yet — we&apos;re finishing integration with a new escrow payment provider.
            </div>
          )}

          <button
            type="button"
            className="checkout-pay-btn"
            onClick={handlePay}
            disabled={submitting || !PAY_LIVE}
          >
            {submitting ? (
              "Processing…"
            ) : (
              <>
                Pay <span className="checkout-pay-amount">{formatBalance(total)}</span>
              </>
            )}
          </button>

          <div className="checkout-footer">
            <Link href="/help">Need help?</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
