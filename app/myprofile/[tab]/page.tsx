import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicBaseUrl } from "@/lib/server/adminDb";
import MyProfilePageClient from "@/components/profile/MyProfilePageClient";
import type { ParentTab } from "@/components/profile/MyProfileHub";

// The other 3 profile tabs, each as their own real URL with their own
// metadata — see app/myprofile/page.tsx (the "profile" tab, which stays
// at the bare /myprofile URL) for the sibling route and the full
// reasoning on why this exists (noindex, robots.ts already covers this
// whole prefix, etc). MyProfileHub.tsx's own selectTab keeps the URL in
// sync with whichever tab is open as the user clicks around after
// landing here.
const TAB_META: Record<string, { tab: ParentTab; title: string; description: string }> = {
  listings: {
    tab: "listings",
    title: "My Listings — Siterifty",
    description: "Manage the apps, games, websites, and 3D assets you're currently selling on Siterifty.",
  },
  favorites: {
    tab: "favorites",
    title: "My Favorites — Siterifty",
    description: "Listings you've saved on Siterifty, all in one place.",
  },
  following: {
    tab: "following",
    title: "Following — Siterifty",
    description: "Sellers you follow on Siterifty.",
  },
};

export async function generateMetadata({ params }: { params: Promise<{ tab: string }> }): Promise<Metadata> {
  const { tab } = await params;
  const meta = TAB_META[tab];
  if (!meta) return {};
  const url = `${getPublicBaseUrl()}/myprofile/${tab}`;
  return {
    title: meta.title,
    description: meta.description,
    alternates: { canonical: url },
    robots: { index: false, follow: false },
    openGraph: { title: meta.title, description: meta.description, url, type: "website" },
    twitter: { card: "summary_large_image", title: meta.title, description: meta.description },
  };
}

export default async function MyProfileTabPage({ params }: { params: Promise<{ tab: string }> }) {
  const { tab } = await params;
  const meta = TAB_META[tab];
  if (!meta) notFound();
  return <MyProfilePageClient initialTab={meta.tab} />;
}
