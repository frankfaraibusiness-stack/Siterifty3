// Ports sellerBadgesHtml + srDealTierFor from marketplace.js — the trust
// badge cluster shown next to a seller's name: premium-plan checkmark
// (lime), verified checkmark (blue via followers, gold via Legendary
// tier), and a deal-tier badge with exact completed-deal count.
//
// SR_PAID_PLANS mirrors the constant of the same name in marketplace.js
// (shared there with the listing card's Featured badge check).
const SR_PAID_PLANS = ["starter", "growth", "pro"];
const SR_VERIFIED_FOLLOWER_THRESHOLD = 1000;

// Ordered low → high; first match (scanned from the top, i.e. highest
// tier first) wins — same as the original's Array.find over this list.
const SR_DEAL_TIERS = [
  { key: "legendary", min: 100, label: "Legendary Seller", color: "#f2b632" },
  { key: "gold", min: 50, label: "Gold Seller", color: "#f2b632" },
  { key: "silver", min: 20, label: "Silver Seller", color: "#c0c5ce" },
  { key: "bronze", min: 5, label: "Bronze Seller", color: "#cd7f32" },
] as const;

function srDealTierFor(dealsCompleted: number) {
  const n = Number(dealsCompleted) || 0;
  return SR_DEAL_TIERS.find((t) => n >= t.min) || null;
}

const VerifiedCheckSvg = () => (
  <svg width="14" height="14" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="12" />
    <path d="M7 12.5l3 3 7-7" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Medal glyph (bronze/silver/gold share the same shape) vs. crown for
// legendary — matches SR_TIER_ICONS in the original.
function TierIcon({ tierKey }: { tierKey: string }) {
  if (tierKey === "legendary") {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24">
        <path d="M3 8l4 3 5-6 5 6 4-3-2 11H5L3 8z" />
        <circle cx="12" cy="19.5" r="1.4" />
      </svg>
    );
  }
  return (
    <svg width="12" height="12" viewBox="0 0 24 24">
      <circle cx="12" cy="10" r="7" />
      <path d="M8.5 16 6.5 22l5.5-3 5.5 3-2-6" fill="none" stroke="currentColor" strokeWidth="0" />
    </svg>
  );
}

export interface BadgeableSeller {
  followerCount?: number;
  dealsCompleted?: number;
  plan?: string;
}

export default function SellerBadges({ seller }: { seller: BadgeableSeller | null | undefined }) {
  if (!seller) return null;
  const followers = Number(seller.followerCount) || 0;
  const deals = Number(seller.dealsCompleted) || 0;
  const tier = srDealTierFor(deals);
  const isVerifiedByFollowers = followers >= SR_VERIFIED_FOLLOWER_THRESHOLD;
  const isLegendary = tier?.key === "legendary";
  const isPremiumPlan = !!seller.plan && SR_PAID_PLANS.includes(seller.plan);

  if (!isPremiumPlan && !isLegendary && !isVerifiedByFollowers && !tier) return null;

  const planLabel = seller.plan ? seller.plan.charAt(0).toUpperCase() + seller.plan.slice(1) : "";

  return (
    <span className="sr-badges">
      {isPremiumPlan && (
        <span
          className="sr-badge sr-badge-verified-premium"
          title={`Verified · ${planLabel} plan`}
          aria-label={`Verified · ${planLabel} plan`}
        >
          <VerifiedCheckSvg />
        </span>
      )}
      {(isLegendary || isVerifiedByFollowers) && (
        <span
          className={`sr-badge ${isLegendary ? "sr-badge-verified-gold" : "sr-badge-verified-blue"}`}
          title={isLegendary ? "Verified · Legendary Seller" : `Verified · ${followers.toLocaleString()}+ followers`}
          aria-label={
            isLegendary ? "Verified · Legendary Seller" : `Verified · ${followers.toLocaleString()}+ followers`
          }
        >
          <VerifiedCheckSvg />
        </span>
      )}
      {tier && (
        <span
          className={`sr-badge sr-badge-tier sr-badge-tier-${tier.key}`}
          title={`${tier.label} · ${deals.toLocaleString()} deals completed`}
          aria-label={`${tier.label} · ${deals.toLocaleString()} deals completed`}
        >
          <TierIcon tierKey={tier.key} />
          <span className="sr-badge-tier-count">{deals.toLocaleString()}</span>
        </span>
      )}
    </span>
  );
}
