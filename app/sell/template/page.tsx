import type { Metadata } from "next";
import { getPublicBaseUrl } from "@/lib/server/adminDb";
import SellTemplateClient from "./SellTemplateClient";

// Own metadata + OG image so this route stops silently inheriting /sell's
// (or the root layout's) title/description/image. OG image reuses the
// exact banner already shown for "Template" on the /sell type-picker card.
const TITLE = "Sell Your Template — List on Siterifty";
const DESCRIPTION =
  "List a design or code template for sale on Siterifty. Escrow-protected deals, verified buyers, no upfront fees.";
const TEMPLATE_OG_IMAGE =
  "https://cdn.phototourl.com/member/2026-07-23-510375af-9619-486a-b1cd-da57626b1755.jpg";

export function generateMetadata(): Metadata {
  const url = `${getPublicBaseUrl()}/sell/template`;
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: url },
    openGraph: {
      title: TITLE,
      description: DESCRIPTION,
      url,
      type: "website",
      images: [{ url: TEMPLATE_OG_IMAGE, width: 1200, height: 630, alt: "Sell your template on Siterifty" }],
    },
    twitter: {
      card: "summary_large_image",
      title: TITLE,
      description: DESCRIPTION,
      images: [TEMPLATE_OG_IMAGE],
    },
  };
}

export default function SellTemplatePage() {
  return <SellTemplateClient />;
}
