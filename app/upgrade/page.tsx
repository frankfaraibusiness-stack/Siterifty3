import type { Metadata } from "next";
import { Suspense } from "react";
import { getPublicBaseUrl } from "@/lib/server/adminDb";
import UpgradePageClient, { UpgradePageSkeleton } from "./UpgradePageClient";

// Own explicit metadata, same treatment as /onboarding and /dashboard —
// otherwise this route silently inherits the root layout's site-wide
// (homepage) title/description/OG image.
const TITLE = "Upgrade Your Plan — Siterifty";
const DESCRIPTION =
  "Compare Siterifty seller plans — lower fees, more listings, priority placement, and dedicated support as you scale.";

export function generateMetadata(): Metadata {
  const url = `${getPublicBaseUrl()}/upgrade`;
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: url },
    robots: { index: false, follow: false },
  };
}

export default function UpgradePage() {
  return (
    <Suspense fallback={<UpgradePageSkeleton />}>
      <UpgradePageClient />
    </Suspense>
  );
}
