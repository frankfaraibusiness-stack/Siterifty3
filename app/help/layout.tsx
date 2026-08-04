import type { Metadata } from "next";
import { getPublicBaseUrl } from "@/lib/server/adminDb";

// HelpPage is a "use client" component (live FAQ search + filtering), so
// it can't export metadata itself — same route-scoped-layout pattern as
// app/contact/layout.tsx.
const TITLE = "Help Center | Siterifty";
const DESCRIPTION =
  "Answers to common questions about buying, selling, escrow, disputes, accounts, and billing on Siterifty.";

export function generateMetadata(): Metadata {
  const url = `${getPublicBaseUrl()}/help`;
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: url },
    openGraph: { title: TITLE, description: DESCRIPTION, url, type: "website" },
    twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
  };
}

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return children;
}
