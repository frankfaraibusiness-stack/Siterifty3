import { InboxShellSkeleton } from "@/components/messages/InboxShell";

// Next's route-level loading UI for /messages and its sub-routes (deal,
// checkout, transfer, group — none of which define their own more
// specific loading.tsx except checkout). Previously this fell through to
// the generic marketplace-grid-shaped app/loading.tsx (SiteriftyLoader)
// — a nav+search+banner+cards shape with nothing in common with the
// inbox layout, so clicking into Messages from the profile page briefly
// showed the wrong skeleton before InboxShell's real header/tabs/rows
// swapped in. This renders the exact same shell InboxShell itself uses.
export default function Loading() {
  return <InboxShellSkeleton />;
}
