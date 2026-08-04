import type { Metadata } from "next";
import { getPublicBaseUrl } from "@/lib/server/adminDb";
import SettingsPageClient from "@/components/settings/SettingsPageClient";

// Own explicit metadata per settings panel — each of the 14 panels now
// has its own real URL (/settings/security, /settings/billing, etc, see
// the sibling [panel]/page.tsx) and its own title/description here,
// instead of every panel silently sharing one generic title. This is the
// "account" panel's URL specifically — plain /settings means Account,
// same convention as /myprofile meaning the "profile" tab (no
// /settings/account URL exists; see SettingsPageClient's PANEL_PATHS).
// Still noindex/nofollow (same treatment as /dashboard, /myprofile —
// robots.ts's disallow list blocks by path prefix so it already covers
// every panel sub-route too): this is an auth-gated page a crawler can't
// sign in to see, so there's no actual search-ranking value — this
// metadata is purely for the browser tab title and for link
// previews/bookmarks a signed-in user shares or saves.
const TITLE = "Account Settings — Siterifty";
const DESCRIPTION = "Manage your Siterifty account, display name, username, and email.";

export function generateMetadata(): Metadata {
  const url = `${getPublicBaseUrl()}/settings`;
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: url },
    robots: { index: false, follow: false },
    openGraph: { title: TITLE, description: DESCRIPTION, url, type: "website" },
    twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
  };
}

export default function SettingsPage() {
  return <SettingsPageClient initialPanel="account" />;
}
