import type { Metadata } from "next";
import { getPublicBaseUrl } from "@/lib/server/adminDb";
import LeaderboardClient from "@/components/leaderboard/LeaderboardClient";

// Ports the '/leaderboard' entry from logout-share.js's SECTION_META +
// applySection() — the original applied this title/description via JS on
// every SPA navigation to /leaderboard; here it's real static metadata on
// a real route, which is strictly better for SEO (a crawler sees it
// without executing JS). Public — no sign-in required to browse, matching
// the original's own comment at core-early.js's '/leaderboard' branch.
const TITLE = "Top Sellers Leaderboard | Siterifty";
const DESCRIPTION =
  "See Siterifty\u2019s top-ranked sellers of websites, apps, and games, ranked by completed deals and buyer trust.";

export function generateMetadata(): Metadata {
  const url = `${getPublicBaseUrl()}/leaderboard`;
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: url },
    openGraph: { title: TITLE, description: DESCRIPTION, url, type: "website" },
    twitter: { card: "summary", title: TITLE, description: DESCRIPTION },
  };
}

export default function LeaderboardPage() {
  return <LeaderboardClient />;
}
