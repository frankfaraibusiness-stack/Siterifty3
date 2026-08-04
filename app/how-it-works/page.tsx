import type { Metadata } from "next";
import { getPublicBaseUrl } from "@/lib/server/adminDb";
import { staticOgImage, SUPPORT_OG_IMAGE } from "@/lib/og/staticOgImage";
import StaticPage, { StaticSection } from "@/components/layout/StaticPage";

// Reuses the page's own eyebrow/title/intro verbatim as SEO copy.
const TITLE = "How It Works — From listing to payout | Siterifty";
const DESCRIPTION =
  "Every deal on Siterifty follows the same escrow-protected process, whether you're buying or selling.";

export function generateMetadata(): Metadata {
  const url = `${getPublicBaseUrl()}/how-it-works`;
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

const STEPS = [
  {
    n: "1",
    title: "Browse or list",
    body: "Buyers browse websites, apps, games, and templates on the marketplace. Sellers list what they've built — screenshots, financials, and a description of what's included in the sale.",
  },
  {
    n: "2",
    title: "Start a deal",
    body: "A buyer messages the seller from the listing to open a deal. The seller can accept, reject, or counter — nothing is final until they accept.",
  },
  {
    n: "3",
    title: "Fund escrow at checkout",
    body: "Once accepted, the buyer heads to a dedicated checkout page to review the order and pay — this isn't a wallet balance debit. Payment is held in escrow until delivery is confirmed, so the seller has a real, committed payment waiting, and the buyer knows it can't be released until they confirm receipt.",
  },
  {
    n: "4",
    title: "Seller delivers",
    body: "The seller hands over the files, credentials, or transfer details through the deal chat and marks the deal delivered.",
  },
  {
    n: "5",
    title: "Buyer confirms (or funds auto-release)",
    body: "The buyer has 72 hours to check everything and confirm receipt, which releases the funds. If they don't respond, funds release to the seller automatically once the window passes — the deal doesn't just stall forever.",
  },
  {
    n: "6",
    title: "Payout, minus platform fee",
    body: "The seller's wallet is credited the sale price minus Siterifty's platform fee, which scales down from 20% to 5% depending on their plan.",
  },
];

export default function HowItWorksPage() {
  return (
    <StaticPage
      eyebrow="How It Works"
      title="From listing to payout"
      intro="Every deal on Siterifty follows the same escrow-protected process, whether you're buying or selling."
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {STEPS.map((s) => (
          <div key={s.n} style={{ display: "flex", gap: 16 }}>
            <div
              style={{
                flexShrink: 0,
                width: 34,
                height: 34,
                borderRadius: "50%",
                background: "var(--mp-accent-muted)",
                border: "1px solid var(--mp-accent-border)",
                color: "var(--mp-accent)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 800,
                fontSize: 14,
              }}
            >
              {s.n}
            </div>
            <div>
              <div style={{ color: "var(--mp-text)", fontWeight: 750, fontSize: 15.5, marginBottom: 4 }}>
                {s.title}
              </div>
              <div style={{ color: "var(--mp-text-sec)", fontSize: 14.5, lineHeight: 1.7 }}>{s.body}</div>
            </div>
          </div>
        ))}
      </div>

      <StaticSection heading="If something goes wrong">
        <p>
          Either side can raise a dispute at any point before funds release. That freezes the
          escrow immediately, and our team reviews the case within 24–48 hours — see{" "}
          <a href="/buyer-protection" style={{ color: "var(--mp-accent)" }}>
            Buyer Protection
          </a>{" "}
          for details.
        </p>
      </StaticSection>
    </StaticPage>
  );
}
