import type { Metadata } from "next";
import { getPublicBaseUrl } from "@/lib/server/adminDb";
import { staticOgImage, SUPPORT_OG_IMAGE } from "@/lib/og/staticOgImage";
import StaticPage, { StaticSection } from "@/components/layout/StaticPage";

// Reuses the page's own eyebrow/title/intro verbatim as SEO copy.
const TITLE = "Buyer Protection — You're covered, deal by deal | Siterifty";
const DESCRIPTION =
  "Escrow is the core of it, but buyer protection on Siterifty covers a few more things worth knowing before you buy.";

export function generateMetadata(): Metadata {
  const url = `${getPublicBaseUrl()}/buyer-protection`;
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

export default function BuyerProtectionPage() {
  return (
    <StaticPage
      eyebrow="Buyer Protection"
      title="You're covered, deal by deal"
      intro="Escrow is the core of it, but buyer protection on Siterifty covers a few more things worth knowing before you buy."
    >
      <StaticSection heading="Your payment is never released blind">
        <p>
          Funds stay held by PayPal — authorized at checkout but not released — until you confirm
          you received what was promised, or the 72-hour verification window passes. If a seller
          marks a deal delivered and you don&apos;t agree, you don&apos;t have to confirm — raise a
          dispute instead and the payment stays frozen. You check out normally; you never need to
          link or share anything with the seller&apos;s own PayPal account.
        </p>
      </StaticSection>

      <StaticSection heading="Disputes are reviewed by a person">
        <p>
          Opening a dispute doesn&apos;t just cancel the deal automatically — it hands the case to
          our team, who reviews the deal chat, the listing, and both sides&apos; account history
          before deciding how funds are released. Reviews are typically completed within 24–48
          hours.
        </p>
      </StaticSection>

      <StaticSection heading="Everything happens in one paper trail">
        <p>
          All deal communication and file delivery happens inside the deal chat, not over email
          or a third-party tool. That means if a dispute is raised, there&apos;s a complete record
          of what was agreed and what was actually delivered — nothing depends on a screenshot or
          a &quot;they told me&quot; claim.
        </p>
      </StaticSection>

      <StaticSection heading="Reporting bad actors">
        <p>
          You can report a listing or a seller directly from their profile. Reports are reviewed
          by our team and aren&apos;t visible to the reported seller, so there&apos;s no risk of
          retaliation for flagging something that looks wrong.
        </p>
      </StaticSection>

      <StaticSection heading="What buyer protection doesn't cover">
        <p>
          Escrow protects the payment itself — it doesn&apos;t evaluate the quality of what
          you&apos;re buying ahead of time. Review a listing&apos;s description, financials, and
          seller history carefully before opening a deal, the same way you would with any other
          marketplace purchase.
        </p>
      </StaticSection>
    </StaticPage>
  );
}
