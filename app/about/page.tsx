import type { Metadata } from "next";
import { getPublicBaseUrl } from "@/lib/server/adminDb";
import { staticOgImage, SUPPORT_OG_IMAGE } from "@/lib/og/staticOgImage";
import StaticPage, { StaticSection } from "@/components/layout/StaticPage";

// Reuses the page's own eyebrow/title/intro verbatim as SEO copy — keeps
// on-page content and metadata from drifting apart, same reasoning as
// the other static pages in this batch.
const TITLE = "About Us — Built for the builder. | Siterifty";
const DESCRIPTION =
  "Siterifty is a marketplace where indie developers buy and sell websites, apps, games, and templates — with escrow protection on every deal.";

export function generateMetadata(): Metadata {
  const url = `${getPublicBaseUrl()}/about`;
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

export default function AboutPage() {
  return (
    <StaticPage
      eyebrow="About Us"
      title="Built for the builder."
      intro="Siterifty is a marketplace where indie developers buy and sell websites, apps, games, and templates — with escrow protection on every deal."
    >
      <StaticSection heading="Why Siterifty exists">
        <p>
          Most marketplaces for digital products are built for agencies and big studios. Siterifty
          is built for the developer shipping solo — the one who spent a few weekends on a
          side project, or built a small SaaS that didn&apos;t take off the way they hoped, and
          just wants a straightforward, fair place to sell it to someone who will.
        </p>
      </StaticSection>

      <StaticSection heading="What we do differently">
        <p>
          Every sale on Siterifty goes through escrow: a buyer&apos;s payment is held until they
          confirm they&apos;ve received what they paid for, so neither side has to trust a
          stranger with their money up front. Platform fees scale down as sellers grow — sellers
          on a free plan keep 70% of every sale, and that share climbs with paid plans, instead
          of everyone paying the same cut regardless of volume.
        </p>
      </StaticSection>

      <StaticSection heading="Who's behind it">
        <p>
          Siterifty is an independently built platform — one developer, one vision, written the
          same way most of the products sold here were: alone, nights and weekends, for other
          people doing the same thing. If you&apos;re an indie hacker looking for a place to sell
          what you&apos;ve built, this is who it&apos;s for.
        </p>
      </StaticSection>
    </StaticPage>
  );
}
