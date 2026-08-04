import { CheckoutRouteSkeleton } from "@/components/messages/CheckoutRoute";

// Next's route-level loading UI for this segment. Without this, Next
// fell back to the generic marketplace-grid-shaped app/loading.tsx
// (SiteriftyLoader) while this route's JS/data resolved — a shape that
// doesn't remotely match the checkout layout, so the page briefly showed
// the wrong skeleton (or, once that swapped out, a flash of the bare
// footer before real content replaced it). This renders the exact same
// skeleton CheckoutRoute itself shows while the deal room doc is still
// loading, so there's no visible seam between this and the real content.
export default function Loading() {
  return <CheckoutRouteSkeleton />;
}
