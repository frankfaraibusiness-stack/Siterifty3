import type { Metadata } from "next";
import { getPublicBaseUrl } from "@/lib/server/adminDb";
import { staticOgImage, SUPPORT_OG_IMAGE } from "@/lib/og/staticOgImage";
import StaticPage, { StaticSection } from "@/components/layout/StaticPage";

// Standalone Privacy Policy — the combined Terms & Privacy page's section 7
// covers this briefly; this page is the full version linked from there and
// meant to sit at the /privacy path most users, crawlers, and app-store
// reviewers expect to find it at.
const TITLE = "Privacy Policy | Siterifty";
const DESCRIPTION =
  "What data Siterifty collects, why, who it's shared with, and how to access, export, or delete yours.";

export function generateMetadata(): Metadata {
  const url = `${getPublicBaseUrl()}/privacy`;
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

export default function PrivacyPage() {
  return (
    <StaticPage
      eyebrow="Legal"
      title="Privacy Policy"
      intro="Last updated: this page explains what we collect, why, who we share it with, and how to control your data."
    >
      <StaticSection heading="1. Data we collect">
        <p>We collect only what's needed to run the marketplace:</p>
        <ul style={{ margin: "10px 0 0", paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
          <li><strong style={{ color: "var(--mp-text)" }}>Account data</strong> — email, username, avatar, and authentication identifiers from Firebase Auth.</li>
          <li><strong style={{ color: "var(--mp-text)" }}>Listing &amp; deal content</strong> — anything you post, plus messages exchanged with buyers/sellers in a deal.</li>
          <li><strong style={{ color: "var(--mp-text)" }}>Wallet &amp; transaction history</strong> — your boost-only wallet balance, marketplace sale/fee records, and payout requests tied to your account.</li>
          <li><strong style={{ color: "var(--mp-text)" }}>Payment data</strong> — handled directly by PayPal at checkout and for payouts; Siterifty receives transaction confirmations, authorization/capture identifiers, and (for payouts) the PayPal email, bank, or Bitcoin address you provide — never your full card number or bank login credentials.</li>
          <li><strong style={{ color: "var(--mp-text)" }}>Device &amp; usage data</strong> — session info, rough location (for currency/geo defaults), and push notification subscriptions if you opt in.</li>
        </ul>
      </StaticSection>

      <StaticSection heading="2. How we use it">
        <p>
          To operate your account, process deals and PayPal-held payments, prevent fraud and abuse,
          send transactional notifications (deal updates, disputes, payouts), and — only if you've
          opted in — push notifications. We don't use your data to build advertising profiles, and
          we don't sell it.
        </p>
      </StaticSection>

      <StaticSection heading="3. Who we share it with">
        <p>We share data with the vendors that make the platform work, and no one else:</p>
        <ul style={{ margin: "10px 0 0", paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
          <li><strong style={{ color: "var(--mp-text)" }}>Firebase</strong> (Google) — authentication, database, and storage.</li>
          <li><strong style={{ color: "var(--mp-text)" }}>PayPal</strong> — payment authorization and holding at checkout, capturing/releasing funds when a deal completes, seller payouts, and Pro subscription billing. PayPal may also independently use transaction data for its own fraud, risk, and compliance screening, under PayPal's own privacy policy.</li>
          <li><strong style={{ color: "var(--mp-text)" }}>Push notification services</strong> — only for accounts that enable push notifications.</li>
        </ul>
        <p style={{ marginTop: 10 }}>
          We may also disclose data if legally required to, or to investigate fraud, security
          incidents, or violations of our Terms.
        </p>
      </StaticSection>

      <StaticSection heading="4. Cookies &amp; similar technologies">
        <p>We use a small number of cookies and local-storage entries, grouped by purpose:</p>
        <ul style={{ margin: "10px 0 0", paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
          <li><strong style={{ color: "var(--mp-text)" }}>Essential</strong> — keeping you signed in, securing your session, and protecting against fraud. These can&apos;t be disabled without breaking core functionality.</li>
          <li><strong style={{ color: "var(--mp-text)" }}>Preference</strong> — remembering your currency, theme, and similar display settings.</li>
          <li><strong style={{ color: "var(--mp-text)" }}>Payment</strong> — cookies set by PayPal&apos;s checkout components while you're on a checkout or payout screen, governed by PayPal&apos;s own cookie policy, not ours.</li>
        </ul>
        <p style={{ marginTop: 10 }}>
          We don't use third-party advertising or cross-site tracking cookies, and Siterifty itself
          doesn't run any ad network on the platform.
        </p>
      </StaticSection>

      <StaticSection heading="5. Data retention">
        <p>
          We keep account and transaction data for as long as your account is active, and for a
          reasonable period after — generally to satisfy tax, dispute, and fraud-prevention
          obligations tied to completed deals. If you delete your account, we remove personal data
          that isn't needed for those obligations.
        </p>
      </StaticSection>

      <StaticSection heading="6. Your rights">
        <p>
          Depending on where you live, you may have the right to access, correct, export, or delete
          your personal data, and to object to or restrict certain processing. You can update most
          account data yourself in Settings, or contact us to make a request. We'll respond within
          the timeframe required by applicable law (e.g. 30 days under GDPR/CCPA).
        </p>
      </StaticSection>

      <StaticSection heading="7. International transfers">
        <p>
          Siterifty's infrastructure providers (Firebase, PayPal) may process and store data outside
          your country of residence. Where required, we rely on those providers' own compliance
          mechanisms (such as EU Standard Contractual Clauses) for cross-border transfers.
        </p>
      </StaticSection>

      <StaticSection heading="8. Children's privacy">
        <p>
          Siterifty isn't directed at children, and we don't knowingly collect data from anyone
          under 16. Buying or selling on Siterifty requires being at least 18, or the age of
          majority in your jurisdiction. If you believe a child has provided us data, contact us
          and we'll remove it.
        </p>
      </StaticSection>

      <StaticSection heading="9. Changes to this policy">
        <p>
          We may update this policy as the platform evolves — including as our payment model
          changes. Material changes will be reflected here with an updated date.
        </p>
      </StaticSection>

      <StaticSection heading="10. Contact">
        <p>
          Questions about this policy, or a data access/deletion request? Reach out at{" "}
          <strong style={{ color: "var(--mp-text)" }}>support@siterifty.com</strong>.
        </p>
      </StaticSection>
    </StaticPage>
  );
}
