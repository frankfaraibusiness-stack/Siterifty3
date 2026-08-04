import type { Metadata } from "next";
import { getPublicBaseUrl } from "@/lib/server/adminDb";
import SellWebsiteClient from "./SellWebsiteClient";

// Own metadata + OG image so this route stops silently inheriting /sell's
// (or the root layout's) title/description/image. OG image reuses the
// exact banner already shown for "Website" on the /sell type-picker card —
// keeps the share-preview consistent with what a user actually clicked.
const TITLE = "Sell Your Website — List on Siterifty";
const DESCRIPTION =
  "List a live site, SaaS, or online business for sale on Siterifty. Escrow-protected deals, verified buyers, no upfront fees.";
const WEBSITE_OG_IMAGE =
  "https://cdn.phototourl.com/member/2026-07-23-94028826-7b73-44cb-aa8e-784df56bc085.jpg";

export function generateMetadata(): Metadata {
  const url = `${getPublicBaseUrl()}/sell/website`;
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: url },
    openGraph: {
      title: TITLE,
      description: DESCRIPTION,
      url,
      type: "website",
      images: [{ url: WEBSITE_OG_IMAGE, width: 1200, height: 630, alt: "Sell your website on Siterifty" }],
    },
    twitter: {
      card: "summary_large_image",
      title: TITLE,
      description: DESCRIPTION,
      images: [WEBSITE_OG_IMAGE],
    },
  };
}

export default function SellWebsitePage() {
  return <SellWebsiteClient />;
}
