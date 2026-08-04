import { SellerProfileSkeleton } from "./SellerProfileClient";

// Next's route-level loading UI for /seller/[id]. Without this, Next
// fell back to the generic marketplace-grid-shaped app/loading.tsx
// (SiteriftyLoader) while getSellerFullProfile resolved server-side —
// a nav+search+banner+cards shape that looks nothing like a seller
// profile, so the page briefly showed the wrong skeleton before the
// real header/bio/listings swapped in (reads as a layout "pop"/flash).
// This renders the exact same sp-loading skeleton SellerProfileClient
// itself shows while seller data is still loading, so there's no
// visible seam between this and the real content.
export default function Loading() {
  return <SellerProfileSkeleton />;
}
