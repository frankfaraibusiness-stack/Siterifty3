import type { Metadata } from "next";
import { getPublicBaseUrl } from "@/lib/server/adminDb";

// ContactPage is a "use client" component (live Firestore form submission),
// so it can't export metadata itself. This is the first route-scoped
// layout.tsx in the app — a new pattern, added purely so client-only pages
// can still carry real per-page SEO metadata.
const TITLE = "Contact Us | Siterifty";
const DESCRIPTION =
  "Get in touch with the Siterifty team about your account, a deal, billing, or a bug — we're here to help.";

export function generateMetadata(): Metadata {
  const url = `${getPublicBaseUrl()}/contact`;
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: url },
    openGraph: { title: TITLE, description: DESCRIPTION, url, type: "website" },
    twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
  };
}

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return children;
}
