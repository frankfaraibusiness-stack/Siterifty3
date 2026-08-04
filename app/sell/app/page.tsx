import type { Metadata } from "next";
import { getPublicBaseUrl } from "@/lib/server/adminDb";
import SellAppClient from "./SellAppClient";

// Own metadata + OG image so this route stops silently inheriting /sell's
// (or the root layout's) title/description/image. OG image reuses the
// exact banner already shown for "App" on the /sell type-picker card.
const TITLE = "Sell Your App — List on Siterifty";
const DESCRIPTION =
  "List a mobile or web app for sale on Siterifty. Escrow-protected deals, verified buyers, no upfront fees.";
const APP_OG_IMAGE =
  "https://cdn.phototourl.com/member/2026-07-23-a4b0ee23-15a4-44b5-8ea7-b86414ea3e1f.jpg";

export function generateMetadata(): Metadata {
  const url = `${getPublicBaseUrl()}/sell/app`;
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: url },
    openGraph: {
      title: TITLE,
      description: DESCRIPTION,
      url,
      type: "website",
      images: [{ url: APP_OG_IMAGE, width: 1200, height: 630, alt: "Sell your app on Siterifty" }],
    },
    twitter: {
      card: "summary_large_image",
      title: TITLE,
      description: DESCRIPTION,
      images: [APP_OG_IMAGE],
    },
  };
}

export default function SellAppPage() {
  return <SellAppClient />;
}
