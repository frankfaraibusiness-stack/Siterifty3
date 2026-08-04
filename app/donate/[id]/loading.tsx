import { DonatePageSkeleton } from "./DonatePageClient";

// Next's route-level loading UI for /donate/[id]. Without this, Next
// fell back to the generic marketplace-grid-shaped app/loading.tsx
// (SiteriftyLoader) — a nav+search+banner+cards shape that has nothing
// to do with a donate page, same issue already fixed for /seller/[id],
// /messages, and the checkout route (see FIXES-README.txt). Renders the
// exact same skeleton DonatePageClient itself shows while seller data
// is still loading, so there's no visible seam.
export default function Loading() {
  return <DonatePageSkeleton />;
}
