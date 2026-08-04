import type { Metadata } from "next";
import { getPublicBaseUrl } from "@/lib/server/adminDb";
import { staticOgImage, SUPPORT_OG_IMAGE } from "@/lib/og/staticOgImage";
import StaticPage, { StaticSection } from "@/components/layout/StaticPage";

// Reuses the page's own eyebrow/title/intro verbatim as SEO copy.
const TITLE = "Terms & Privacy — Terms of Service & Privacy Policy | Siterifty";
const DESCRIPTION =
  "Last updated: these terms describe how buying, selling, and payments actually work on Siterifty.";

export function generateMetadata(): Metadata {
  const url = `${getPublicBaseUrl()}/terms`;
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

export default function TermsPage() {
  return (
    <StaticPage
      eyebrow="Terms & Privacy"
      title="Terms of Service & Privacy Policy"
      intro="Last updated: these terms describe how buying, selling, and payments actually work on Siterifty."
    >
      <StaticSection heading="1. What Siterifty is">
        <p>
          Siterifty is a marketplace connecting buyers and sellers of websites, apps, games, and
          templates. Siterifty facilitates the transaction — including payment holding via PayPal
          and dispute resolution — but is not a party to the underlying sale of the listed product
          itself, and does not itself take custody of buyer or seller funds.
        </p>
      </StaticSection>

      <StaticSection heading="2. Accounts">
        <p>
          You&apos;re responsible for the activity on your account and for keeping your login
          credentials secure. One person or business per account — accounts found to be shared or
          created to evade a restriction may be suspended. You must be at least 18 years old, or
          the age of majority in your jurisdiction, to buy or sell on Siterifty.
        </p>
      </StaticSection>

      <StaticSection heading="3. Listings">
        <p>
          Sellers are responsible for the accuracy of what they list — description, financials,
          and what&apos;s actually included in the sale. Listing something you don&apos;t have the
          right to sell (stolen code, unlicensed assets, someone else&apos;s product) is grounds
          for removal and account suspension. Weekly listing limits apply based on your plan.
        </p>
      </StaticSection>

      <StaticSection heading="4. Prohibited listings and conduct">
        <p>
          In addition to anything unlawful, the following may never be listed or sold on Siterifty:
        </p>
        <ul style={{ margin: "10px 0 0", paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
          <li>Stolen, pirated, or unlicensed code, assets, content, or accounts</li>
          <li>Malware, exploits, or anything designed to gain unauthorized access to a system</li>
          <li>Weapons, ammunition, explosives, or controlled/illegal substances</li>
          <li>Counterfeit goods or anything infringing a third party&apos;s intellectual property</li>
          <li>Adult content, gambling products, or anything targeting minors inappropriately</li>
          <li>Anything designed to facilitate fraud, money laundering, or evade sanctions</li>
        </ul>
        <p style={{ marginTop: 10 }}>
          Circumventing escrow (arranging payment outside the platform to avoid fees), harassment,
          fraud, and attempts to manipulate reviews, ratings, or the seller badge system are also
          grounds for suspension.
        </p>
      </StaticSection>

      <StaticSection heading="5. Payments — PayPal holds the money, not Siterifty">
        <p>
          Siterifty is not a licensed money transmitter and does not hold customer funds itself.
          Every marketplace purchase is paid for directly through PayPal at checkout. PayPal
          authorizes the buyer&apos;s payment and holds it — the funds are not released to the
          seller, and are not transferred to Siterifty — until the deal completes or is refunded.
          Buyers check out normally with their own PayPal account or card; sellers do not need to
          link or share a PayPal account with the buyer to receive payment.
        </p>
        <p style={{ marginTop: 10 }}>
          When a deal completes, Siterifty deducts a platform fee from the sale price and credits
          the remainder to the seller&apos;s withdrawable balance, which the seller can then have
          paid out to a PayPal email, bank account, or Bitcoin address on file. The fee rate depends
          on the seller&apos;s plan at the time of sale (currently 30% on Free, 24% on Starter, 18%
          on Growth, 12% on Pro), plus a separate buyer service fee — both are disclosed before you
          pay or accept a deal.
        </p>
      </StaticSection>

      <StaticSection heading="6. Wallet balance — boosting only">
        <p>
          Your Siterifty wallet balance is a separate, limited-purpose credit used only to boost
          your own listings for extra visibility in the marketplace feed. It cannot currently be
          added to by card, bank transfer, or PayPal deposit; cannot be withdrawn as cash; and
          cannot be sent to, or received from, another user. We are not licensed to hold or transmit
          customer funds through the wallet, so it is intentionally kept spend-only and non-transferable.
          Sending money between users (P2P transfer) and wallet-funded donations are temporarily
          unavailable for this reason and will return once Siterifty completes the relevant licensing
          (for transfers) or moves donations onto PayPal split payments — not onto wallet balance.
        </p>
      </StaticSection>

      <StaticSection heading="7. Escrow, holds, and disputes">
        <p>
          Funds a buyer pays for a deal are authorized and held by PayPal until the buyer confirms
          delivery, or the verification window (72 hours after the seller marks a deal delivered)
          passes without a dispute. Either party may raise a dispute before funds release, which
          freezes the held payment pending review by Siterifty&apos;s team. Siterifty&apos;s decision
          on a dispute determines whether we instruct PayPal to release the payment to the seller or
          void the authorization so the buyer is never charged.
        </p>
        <p style={{ marginTop: 10 }}>
          Because the payment is authorized (not immediately captured), it can expire under PayPal&apos;s
          own authorization window if a deal runs unusually long without resolution; we&apos;ll contact
          you if a deal is at risk of this so it can be re-authorized or resolved in time. Buyers should
          also be aware that disputing a charge directly with PayPal or their bank (a chargeback),
          instead of using Siterifty&apos;s dispute process, may delay resolution and can affect the
          seller&apos;s ability to deliver or be paid for the same deal — we ask both sides to use
          Siterifty&apos;s dispute flow first.
        </p>
      </StaticSection>

      <StaticSection heading="8. What data we collect">
        <p>
          Account data (email, username, avatar), listing and deal content, wallet and transaction
          history, PayPal transaction identifiers (not your full card or bank details), and basic
          usage data needed to operate the marketplace (session/device info for security, push
          notification subscriptions if you opt in). We don&apos;t sell your data to third parties.
          See our full{" "}
          <a href="/privacy" style={{ color: "var(--mp-accent)", fontWeight: 700 }}>
            Privacy Policy
          </a>{" "}
          for details on data retention, cookies, your rights, and how to request access or deletion.
        </p>
      </StaticSection>

      <StaticSection heading="9. Limitation of liability">
        <p>
          Siterifty facilitates transactions in good faith but doesn&apos;t guarantee the quality,
          legality, or performance of any listed product, and is not responsible for PayPal&apos;s
          own processing, holds, or account decisions. Our liability for any claim is limited to
          the fees Siterifty actually collected on the deal in question.
        </p>
      </StaticSection>

      <StaticSection heading="10. Changes to these terms">
        <p>
          We may update these terms as the platform evolves — including as our payment model
          changes (for example, if Siterifty becomes licensed to hold customer funds, or if
          P2P transfers or donations are re-enabled). Material changes will be reflected here
          with an updated date; continued use of Siterifty after a change means you accept the
          updated terms.
        </p>
      </StaticSection>

      <StaticSection heading="11. Contact">
        <p>
          Questions about these terms? Reach out at{" "}
          <strong style={{ color: "var(--mp-text)" }}>support@siterifty.com</strong>.
        </p>
      </StaticSection>
    </StaticPage>
  );
}
