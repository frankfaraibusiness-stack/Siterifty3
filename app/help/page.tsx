import type { Metadata } from "next";
import { getPublicBaseUrl } from "@/lib/server/adminDb";
import { staticOgImage, SUPPORT_OG_IMAGE } from "@/lib/og/staticOgImage";
import HelpContent from "./HelpContent";

// Split into a server page (for metadata) + client content (HelpContent.tsx,
// which needs useState/useMemo for live search, category filter, accordion).
// Same pattern as terms/buyer-protection/how-it-works/about/contact.
const TITLE = "Help Center — FAQs & Support | Siterifty";
const DESCRIPTION =
  "Answers on buying, selling, escrow and payments, disputes, your account, and billing — search the Siterifty FAQ or browse by topic.";

export function generateMetadata(): Metadata {
  const url = `${getPublicBaseUrl()}/help`;
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: url },
    openGraph: {
      title: TITLE,
      description: DESCRIPTION,
      url,
      type: "website",
      images: staticOgImage(SUPPORT_OG_IMAGE, "Siterifty Support").openGraphImages,
    },
    twitter: {
      card: "summary_large_image",
      title: TITLE,
      description: DESCRIPTION,
      images: staticOgImage(SUPPORT_OG_IMAGE, "Siterifty Support").twitterImages,
    },
  };
}

export default function HelpPage() {
  return <HelpContent />;
}
