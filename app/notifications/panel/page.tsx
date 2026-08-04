import type { Metadata } from "next";
import { getPublicBaseUrl } from "@/lib/server/adminDb";
import NotificationCenterPage from "@/components/notifications/NotificationCenterPage";

// Own explicit metadata, same convention as /dashboard and /settings —
// auth-gated page, noindex/nofollow. Also added "/notifications" to
// robots.ts's disallow list (it wasn't covered by any existing prefix
// rule there).
const TITLE = "Notifications — Siterifty";
const DESCRIPTION = "Deal offers, messages, and payment updates for your Siterifty account.";

export function generateMetadata(): Metadata {
  const url = `${getPublicBaseUrl()}/notifications/panel`;
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: url },
    robots: { index: false, follow: false },
    openGraph: { title: TITLE, description: DESCRIPTION, url, type: "website" },
    twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
  };
}

export default function NotificationsPanelPage() {
  return <NotificationCenterPage />;
}
