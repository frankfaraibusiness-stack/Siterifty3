import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicBaseUrl } from "@/lib/server/adminDb";
import SettingsPageClient from "@/components/settings/SettingsPageClient";
import type { SettingsPanelId } from "@/components/settings/SettingsSidebar";

// The other 13 settings panels, each as their own real URL with their
// own metadata — see app/settings/page.tsx (the "account" panel, which
// stays at the bare /settings URL) for the sibling route and the full
// reasoning (noindex, robots.ts already covers this whole prefix, etc).
// SettingsPageClient's own selectPanel keeps the URL in sync with
// whichever panel is open as the user clicks around after landing here.
const PANEL_META: Record<string, { panel: SettingsPanelId; title: string; description: string }> = {
  security: {
    panel: "security",
    title: "Security Settings — Siterifty",
    description: "Manage your password, two-factor authentication, and login security on Siterifty.",
  },
  notifications: {
    panel: "notifications",
    title: "Notification Settings — Siterifty",
    description: "Choose which email and push notifications you receive from Siterifty.",
  },
  appearance: {
    panel: "appearance",
    title: "Appearance Settings — Siterifty",
    description: "Customize your Siterifty theme and display preferences.",
  },
  billing: {
    panel: "billing",
    title: "Billing & Plans — Siterifty",
    description: "Manage your Siterifty plan, billing details, and subscription.",
  },
  payments: {
    panel: "payments",
    title: "Payment Methods — Siterifty",
    description: "Manage the payment methods linked to your Siterifty account.",
  },
  api: {
    panel: "api",
    title: "API & Integrations — Siterifty",
    description: "Manage your Siterifty API keys and connected integrations.",
  },
  webhooks: {
    panel: "webhooks",
    title: "Webhooks — Siterifty",
    description: "Manage webhook endpoints for your Siterifty account.",
  },
  privacy: {
    panel: "privacy",
    title: "Privacy & Data — Siterifty",
    description: "Manage your profile visibility and data privacy settings on Siterifty.",
  },
  sessions: {
    panel: "sessions",
    title: "Active Sessions — Siterifty",
    description: "View and manage devices currently signed in to your Siterifty account.",
  },
  referrals: {
    panel: "referrals",
    title: "Referrals — Siterifty",
    description: "Invite others to Siterifty and track your referral rewards.",
  },
  analytics: {
    panel: "analytics",
    title: "Listing Analytics — Siterifty",
    description: "View performance analytics for your Siterifty listings.",
  },
  sellerbadge: {
    panel: "sellerbadge",
    title: "Seller Badge — Siterifty",
    description: "View and manage your Siterifty seller badge status.",
  },
  danger: {
    panel: "danger",
    title: "Danger Zone — Siterifty",
    description: "Deactivate or permanently delete your Siterifty account.",
  },
};

export async function generateMetadata({ params }: { params: Promise<{ panel: string }> }): Promise<Metadata> {
  const { panel } = await params;
  const meta = PANEL_META[panel];
  if (!meta) return {};
  const url = `${getPublicBaseUrl()}/settings/${panel}`;
  return {
    title: meta.title,
    description: meta.description,
    alternates: { canonical: url },
    robots: { index: false, follow: false },
    openGraph: { title: meta.title, description: meta.description, url, type: "website" },
    twitter: { card: "summary_large_image", title: meta.title, description: meta.description },
  };
}

export default async function SettingsPanelPage({ params }: { params: Promise<{ panel: string }> }) {
  const { panel } = await params;
  const meta = PANEL_META[panel];
  if (!meta) notFound();
  return <SettingsPageClient initialPanel={meta.panel} />;
}
