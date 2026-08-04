import type { Metadata } from "next";
import { Suspense } from "react";
import { getPublicBaseUrl } from "@/lib/server/adminDb";
import OnboardingPageClient from "./OnboardingPageClient";

// Own explicit metadata so this route stops silently inheriting the root
// layout's site-wide (homepage) title/description/OG image — same
// treatment as /dashboard. noindex since this is a signed-in-only,
// mid-signup step with no SEO value (see robots.ts's disallow list).
const TITLE = "Welcome — Siterifty";
const DESCRIPTION = "Finish setting up your Siterifty account.";

export function generateMetadata(): Metadata {
  const url = `${getPublicBaseUrl()}/onboarding`;
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: url },
    robots: { index: false, follow: false },
  };
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={null}>
      <OnboardingPageClient />
    </Suspense>
  );
}
