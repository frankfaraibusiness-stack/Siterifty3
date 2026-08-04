"use client";

import { useSeller } from "@/lib/useSeller";
import Stars from "./Stars";
import SellerBadges from "@/components/seller/SellerBadges";

interface SellerStripProps {
  ownerId?: string;
  fallbackHandle: string; // ownerEmail?.split('@')[0] — shown until the real seller doc loads
  onViewSeller?: () => void; // app/game cards: renders an inline "View seller" link inside the strip.
  // Site card omits this — it renders its own separate "Seller" ghost
  // button as a sibling in .sr-site-actions, outside .sr-seller, matching
  // the original template exactly.
}

// Shared avatar/name/stars strip, reused across all three card types.
// Now includes the plan/deal-tier trust badges (SellerBadges) using
// whatever plan/dealsCompleted useSeller's lightweight fetch already
// pulled — see useSeller.ts's own comment for why followerCount (and
// therefore the follower-based verified-blue tier) is intentionally
// left out here and only shown on the full seller profile page.
export default function SellerStrip({ ownerId, fallbackHandle, onViewSeller }: SellerStripProps) {
  const seller = useSeller(ownerId);
  const displayName = seller?.username || fallbackHandle;
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <div className="sr-seller">
      <div className="sr-av" data-init={initial}>
        {seller?.profilePic ? (
          <img
            src={seller.profilePic}
            alt={displayName}
            onError={(e) => {
              (e.currentTarget.parentElement as HTMLElement).textContent = initial;
            }}
          />
        ) : (
          initial
        )}
      </div>
      <div className="sr-seller-txt">
        <span className="sr-seller-name">
          <span className="sr-seller-name-text">{displayName}</span>
          {seller ? <SellerBadges seller={{ plan: seller.plan, dealsCompleted: seller.dealsCompleted }} /> : null}
        </span>
        <span className="sr-seller-stars">
          <Stars rating={seller?.rating || 0} count={seller?.ratingCount || 0} />
        </span>
      </div>
      {onViewSeller ? (
        <button
          type="button"
          className="sr-text-link"
          onClick={(e) => {
            e.stopPropagation();
            onViewSeller();
          }}
        >
          View seller
        </button>
      ) : null}
    </div>
  );
}
