import type { Metadata } from "next";
import { getPublicBaseUrl } from "@/lib/server/adminDb";
import { staticOgImage, SUPPORT_OG_IMAGE } from "@/lib/og/staticOgImage";
import StaticPage, { StaticSection } from "@/components/layout/StaticPage";

// Reuses the page's own eyebrow/title/intro verbatim as SEO copy.
const TITLE = "Escrow & Payments — How your money is protected | Siterifty";
const DESCRIPTION =
  "Every deal on Siterifty is funded through escrow — here's exactly what that means and where your money sits at each stage.";

export function generateMetadata(): Metadata {
  const url = `${getPublicBaseUrl()}/escrow`;
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

export default function EscrowPage() {
  return (
    <StaticPage
      eyebrow="Escrow & Payments"
      title="How your money is protected"
      intro="Every deal on Siterifty is funded through escrow — here's exactly what that means and where your money sits at each stage."
    >
      <StaticSection heading="What escrow means here">
        <p>
          When a buyer pays for a deal, PayPal authorizes and holds the payment — the money is
          never sent to the seller up front, and Siterifty never takes custody of it either. It
          only reaches the seller once the buyer confirms delivery, or once the 72-hour
          verification window passes without a dispute. At no point can a seller pull funds out of
          an unconfirmed deal, and at no point does Siterifty hold your money in its own accounts.
        </p>
      </StaticSection>

      <StaticSection heading="PayPal holds the money, not your Siterifty wallet">
        <p>
          Siterifty isn&apos;t a licensed money transmitter, so we don&apos;t hold customer funds
          ourselves. Every marketplace purchase is paid for directly through PayPal at checkout —
          PayPal authorizes the charge and holds it until the deal completes, then we instruct
          PayPal to capture and release it to the seller&apos;s payout method (minus the platform
          fee) once the buyer confirms.
        </p>
        <p style={{ marginTop: 10 }}>
          Your Siterifty <strong>wallet</strong> is a separate, much smaller thing: it&apos;s an
          in-app credit used only to boost your own listings. It isn&apos;t funded by card or bank
          transfer, can&apos;t be withdrawn, and can&apos;t be sent to other users — it exists
          purely for spending inside Siterifty, not as a place we hold your money.
        </p>
      </StaticSection>

      <StaticSection heading="Platform fees">
        <p>
          Siterifty takes a percentage of the sale price when a deal completes — never charged
          up front, and always shown at checkout before you confirm. The rate depends on the
          seller&apos;s plan at the time of sale:
        </p>
        <table style={{ width: "100%", marginTop: 12, borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--mp-border)" }}>
              <th style={{ textAlign: "left", padding: "8px 4px", color: "var(--mp-text)" }}>Plan</th>
              <th style={{ textAlign: "left", padding: "8px 4px", color: "var(--mp-text)" }}>Platform fee</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Free", "30%"],
              ["Starter", "24%"],
              ["Growth", "18%"],
              ["Pro", "12%"],
            ].map(([plan, fee]) => (
              <tr key={plan} style={{ borderBottom: "1px solid var(--mp-border)" }}>
                <td style={{ padding: "8px 4px" }}>{plan}</td>
                <td style={{ padding: "8px 4px", color: "var(--mp-accent)", fontWeight: 700 }}>{fee}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ marginTop: 10 }}>
          A separate buyer service fee is also shown at checkout, covering PayPal&apos;s
          escrow-style authorization and Siterifty&apos;s transaction processing.
        </p>
      </StaticSection>

      <StaticSection heading="Getting paid as a seller">
        <p>
          Once a deal completes, your share of the sale is credited to your withdrawable balance —
          not held by Siterifty as a stored balance, just tracked as money you&apos;re owed. From
          there you can request a payout to your PayPal email, bank account, or Bitcoin address, set
          up in Settings → Payments. Payouts are processed as real transfers out to you; they&apos;re
          never routed back through the in-app wallet.
        </p>
      </StaticSection>

      <StaticSection heading="Delivery & downloads">
        <p>
          Sellers deliver files, credentials, or transfer details directly inside the deal chat.
          Any files attached to a deal are only accessible to the buyer and seller on that
          specific deal — download links are short-lived and re-generated on request, not
          permanent public URLs.
        </p>
      </StaticSection>

      <StaticSection heading="If it goes wrong">
        <p>
          Either party can raise a dispute before funds release, which freezes the escrow
          immediately — no further action happens on that deal until our team reviews it, which
          we do within 24–48 hours. Because the money sits in a PayPal authorization rather than a
          Siterifty-held balance, a dispute resolved in the buyer&apos;s favor is refunded by voiding
          that authorization — nothing is ever captured until we're sure where it should go.
        </p>
      </StaticSection>
    </StaticPage>
  );
}
