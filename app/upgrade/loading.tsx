import { UpgradePageSkeleton } from "./UpgradePageClient";

// Next's route-level loading UI for /upgrade. Without this, Next fell
// back to the generic marketplace-grid-shaped app/loading.tsx
// (SiteriftyLoader), same mismatched-skeleton issue already fixed for
// /seller/[id], /messages, and the checkout route (see
// FIXES-README.txt). Renders the same hero + tab-row + 3-card grid
// shape as the real page.
export default function Loading() {
  return <UpgradePageSkeleton />;
}
