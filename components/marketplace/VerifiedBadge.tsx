import type { Listing } from "@/lib/listings";

// Shown next to a listing's title on cards (SiteCard/AppCard/GameCard) and
// on the listing detail page. Three trust tiers, in descending order of
// what they actually prove — see /api/listings' listing.verify-check and
// listing.link-check for exactly how each one is earned:
//
//   "Verified"      — listing.verified === true. Real proof: our backend
//                      fetched the listing's own domain and found the
//                      exact meta tag minted for THIS domain+listingId
//                      pair. The closest thing to "we confirmed you own
//                      this."
//   "Link checked"   — listing.linkCheck?.status === "link-checked". Only
//                      for app/game listings whose sole proof is a store
//                      link (no domain to put a meta tag on) — the store
//                      page loaded and mentioned the listing's title.
//                      Plausible, NOT ownership proof.
//   "Link provided"  — listing.linkCheck?.status === "link-provided", or
//                      any listing with a store/build link but no deeper
//                      check. The floor: we simply have a link on file.
//
// None of these are ever required to publish — see the optional
// verification steps in WebsiteListingForm.tsx / AppListingForm.tsx /
// GameListingForm.tsx. A listing with none of these badges is simply
// unverified, not flagged as suspicious.
export default function VerifiedBadge({ listing }: { listing: Listing }) {
  if (listing.verified) {
    return (
      <span className="sr-verified-badge sr-verified-badge--verified" title={`Domain ownership verified for ${listing.verifiedDomain || "this listing"}`}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
          <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Verified
      </span>
    );
  }
  if (listing.linkCheck?.status === "link-checked") {
    return (
      <span className="sr-verified-badge sr-verified-badge--checked" title="We confirmed this link resolves and appears to match this listing">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
          <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Link checked
      </span>
    );
  }
  if (listing.linkCheck?.status === "link-provided") {
    return (
      <span className="sr-verified-badge sr-verified-badge--provided" title="Seller provided this link — not independently checked">
        Link provided
      </span>
    );
  }
  return null;
}
