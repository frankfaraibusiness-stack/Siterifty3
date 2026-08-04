import type { Metadata } from "next";
import { Suspense } from "react";
import { getPublicBaseUrl } from "@/lib/server/adminDb";
import DonatePageClient, { DonatePageSkeleton } from "./DonatePageClient";

// Same treatment as /onboarding, /upgrade — own explicit metadata so this
// route doesn't inherit the root layout's site-wide title/description.
// noindex: this is a signed-in-only action page with no SEO value.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const url = `${getPublicBaseUrl()}/donate/${id}`;
  return {
    title: "Support a Seller — Siterifty",
    description: "Send a donation directly to a Siterifty seller's wallet.",
    alternates: { canonical: url },
    robots: { index: false, follow: false },
  };
}

export default async function DonatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<DonatePageSkeleton />}>
      <DonatePageClient sellerUid={id} />
    </Suspense>
  );
}
