import { Suspense } from "react";
import InboxShell, { InboxShellSkeleton } from "@/components/messages/InboxShell";

// Real routed page (not a modal) — same convention as /dashboard and
// /settings. useSearchParams inside InboxShell (for the ?tab= deep link)
// requires a Suspense boundary at the page level in the App Router.
// Fallback matches InboxShell's own real layout (header/tabs/skeleton
// rows) instead of the generic marketplace-grid-shaped SiteriftyLoader,
// which doesn't resemble this page and read as a jarring flash before
// swapping to real content.
export default function MessagesPage() {
  return (
    <Suspense fallback={<InboxShellSkeleton />}>
      <InboxShell />
    </Suspense>
  );
}
