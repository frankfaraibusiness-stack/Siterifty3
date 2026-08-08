"use client";

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useLimits, FALLBACK_LIMITS } from "@/lib/useLimits";
import { useCurrency } from "@/lib/CurrencyContext";

// Shown in place of the old plain-text "This deal chat expired…" banner
// whenever a deal chat is locked with reason "expired-reopenable" (see
// useDealChat.ts) — i.e. the room's expiresAt passed before either
// delivery or a manual cancel, so the server closed it on a missed
// deadline rather than by either party's choice. That's the ONE state
// this popup ever shows for: a manual in-chat cancel (locked reason
// "cancelled-deleting") never renders this, and neither does a
// successful completion (chat.outcome instead) — see DealChatPanel.tsx's
// call site, which gates this strictly on locked.reason.
//
// Reopening (see deal-chat-reopen in app/api/deal/_handler.js) charges a
// flat 15% penalty on the listing price to whichever side calls it, on
// top of whatever else they already owe on the deal — the buyer still
// separately pays the listing price into escrow afterward, and the
// seller still separately owes their normal plan-based sale fee out of
// the proceeds at release time. Both breakdowns are computed here,
// live, so either party can see the other side's math too before
// deciding whether to reopen or just let the deal die (Delete Deal).
export default function DealExpiredPopup({
  listingTitle,
  listingPrice,
  isSeller,
  sellerUid,
  submitting,
  onReopen,
  onDelete,
}: {
  listingTitle: string;
  listingPrice: number | null;
  isSeller: boolean;
  sellerUid: string | null;
  submitting: boolean;
  onReopen: () => void;
  onDelete: () => void;
}) {
  const { limits } = useLimits();
  const { formatBalance } = useCurrency();

  // The viewer's own plan is already known via useAuth elsewhere in the
  // app, but the SELLER's plan specifically is what determines the sale
  // fee row — and the viewer here might be the buyer, who has no reason
  // to already have the seller's plan in context. Same plain public-field
  // read fetchFullSeller/useSeller already use elsewhere (users/{uid}.plan
  // is a public field), fetched fresh on mount rather than threaded
  // through props from three components up.
  const [sellerPlan, setSellerPlan] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!sellerUid) return;
    getDoc(doc(db, "users", sellerUid))
      .then((snap) => {
        if (cancelled) return;
        setSellerPlan(snap.exists() ? (snap.data().plan as string) || "free" : "free");
      })
      .catch(() => {
        if (!cancelled) setSellerPlan("free");
      });
    return () => {
      cancelled = true;
    };
  }, [sellerUid]);

  const price = listingPrice ?? 0;
  const reopenRate = 0.15; // mirrors DEAL_REOPEN_PENALTY_RATE in app/api/deal/_handler.js
  const reopenFee = Math.round(price * reopenRate * 100) / 100;

  const plans = limits.plans || FALLBACK_LIMITS.plans;
  const saleFeeRate = sellerPlan ? (plans[sellerPlan as keyof typeof plans]?.saleFee ?? plans.free.saleFee) : null;
  const saleFeeAmount = saleFeeRate != null ? Math.round(price * saleFeeRate * 100) / 100 : null;

  return (
    <div id="dealExpiredPopup" role="dialog" aria-modal="true">
      <div className="dep-box">
        <div className="dep-icon">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        <div className="dep-title">This deal has expired</div>
        <div className="dep-sub">
          The delivery deadline for &quot;{listingTitle || "this deal"}&quot; passed before it was completed, so it
          was automatically closed. You can reopen it to pick up where you left off, or delete it for good.
        </div>

        <div className="dep-fee-card">
          <div className="dep-fee-row-header">Reopen fee (15% of {formatBalance(price)})</div>

          <div className={`dep-fee-side${isSeller ? " you" : ""}`}>
            <div className="dep-fee-side-label">
              Buyer pays to reopen
              {!isSeller && <span className="dep-you-tag">you</span>}
            </div>
            <div className="dep-fee-side-amount">{formatBalance(reopenFee)}</div>
            <div className="dep-fee-side-note">Paid only if the buyer reopens — separate from the listing price they&apos;ll still owe into escrow.</div>
          </div>

          <div className={`dep-fee-side${isSeller ? " you" : ""}`}>
            <div className="dep-fee-side-label">
              Seller pays to reopen
              {isSeller && <span className="dep-you-tag">you</span>}
            </div>
            <div className="dep-fee-side-amount">{formatBalance(reopenFee)}</div>
            <div className="dep-fee-side-note">
              {saleFeeAmount != null
                ? `On top of their normal ${(saleFeeRate! * 100).toFixed(saleFeeRate! * 100 % 1 === 0 ? 0 : 1)}% sale fee (${formatBalance(saleFeeAmount)}) taken from the sale at release.`
                : "Also still owes their normal plan-based sale fee at release, unaffected by this."}
            </div>
          </div>
        </div>

        <div className="dep-cta-stack">
          <button className="dep-cta dep-cta-reopen" disabled={submitting} onClick={onReopen}>
            {submitting ? "Reopening…" : `Reopen Deal — Pay ${formatBalance(reopenFee)}`}
          </button>
          <button className="dep-cta dep-cta-delete" disabled={submitting} onClick={onDelete}>
            Delete Deal
          </button>
        </div>
      </div>
    </div>
  );
}
