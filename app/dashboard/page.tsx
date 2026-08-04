import type { Metadata } from "next";
import { getPublicBaseUrl } from "@/lib/server/adminDb";
import SellerDashboard from "@/components/dashboard/SellerDashboard";

// Own explicit metadata so this route stops silently inheriting the root
// layout's site-wide (homepage) title/description/OG image — a
// signed-in-only seller tool has nothing to do with the homepage's
// "Buy & Sell Websites, Apps & Games" pitch, and a link to /dashboard
// shared in chat previously showed the homepage's image/copy instead of
// its own. noindex since this is an auth-gated page a crawler can't
// actually sign in to see (same treatment /settings, /myprofile etc.
// already get via robots.ts's disallow list).
const TITLE = "Seller Dashboard — Siterifty";
const DESCRIPTION = "Manage your Siterifty listings, deals, and payouts from your seller dashboard.";
const DASHBOARD_OG_IMAGE =
  "https://cdn.phototourl.com/member/2026-07-20-0eb61213-7c0e-4533-82ed-b27f95c1b8c8.jpg";

export function generateMetadata(): Metadata {
  const url = `${getPublicBaseUrl()}/dashboard`;
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: url },
    robots: { index: false, follow: false },
    openGraph: {
      title: TITLE,
      description: DESCRIPTION,
      url,
      type: "website",
      images: [{ url: DASHBOARD_OG_IMAGE, width: 1200, height: 630, alt: "Siterifty Seller Dashboard" }],
    },
    twitter: {
      card: "summary_large_image",
      title: TITLE,
      description: DESCRIPTION,
      images: [DASHBOARD_OG_IMAGE],
    },
  };
}

export default function DashboardPage() {
  return <SellerDashboard />;
}
