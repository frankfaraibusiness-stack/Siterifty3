import type { Metadata } from "next";
import { getPublicBaseUrl } from "@/lib/server/adminDb";
import MyProfilePageClient from "@/components/profile/MyProfilePageClient";

// Own explicit metadata (title/description/canonical) per profile tab —
// each of /myprofile, /myprofile/listings, /myprofile/favorites, and
// /myprofile/following now has its own real URL and its own copy here
// (see the sibling [tab]/page.tsx for the other three), instead of every
// tab silently sharing one generic title. Still noindex/nofollow (same
// treatment as /dashboard, /settings — see robots.ts's disallow list,
// which blocks by path prefix so it already covers these sub-routes
// too): this is an auth-gated page a crawler can't sign in to see, so
// there's no actual search-ranking value here — this metadata is purely
// for the browser tab title, and for link previews/bookmarks a signed-in
// user shares or saves.
const TITLE = "My Profile — Siterifty";
const DESCRIPTION = "View and manage your Siterifty profile, account details, and public seller info.";

export function generateMetadata(): Metadata {
  const url = `${getPublicBaseUrl()}/myprofile`;
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: url },
    robots: { index: false, follow: false },
    openGraph: { title: TITLE, description: DESCRIPTION, url, type: "website" },
    twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
  };
}

export default function MyProfilePage() {
  return <MyProfilePageClient initialTab="profile" />;
}
