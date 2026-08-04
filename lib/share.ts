// Share model — purely client-side, no server action needed (sharing a
// public URL requires no auth or write). Ports the destination-link
// builders from the old Js/logout-share.js share modal, but drops that
// file's __seo.listingUrl()/applyListing() machinery entirely — those
// existed only because the original SPA had no real per-route SEO
// (single index.html, meta tags patched in via JS). Next.js now gets
// real per-listing/per-seller URLs and metadata from generateMetadata
// directly (see app/listing/[id]/page.tsx, app/seller/[id]/page.tsx),
// so this file only needs to build the canonical link, not also
// rewrite <meta> tags client-side.
//
// "use client" — this is only ever called from interactive share
// buttons (listing body, seller header), and uses window.location /
// navigator APIs that don't exist server-side.
"use client";

import { buildListingSlug } from "@/lib/slug";

// Deliberately NOT importing lib/server/adminDb's getPublicBaseUrl here
// — that reads process.env directly and is meant for Server Components
// only. Client code gets the correct origin for free via
// window.location.origin, so no env lookup is needed at all in the
// browser; the hardcoded fallback only matters if this were ever
// somehow evaluated with no window (it shouldn't be, given "use client").
function baseUrl(): string {
  if (typeof window !== "undefined") return window.location.origin;
  return "https://siterifty.com";
}

export function listingShareUrl(listingId: string, title?: string): string {
  return `${baseUrl()}/listing/${buildListingSlug(title, listingId)}`;
}

// `username` is now the canonical /seller/[id] route segment (see
// app/seller/[id]/page.tsx) — usernames are unique (enforced in
// app/api/account/_handler.js's resolveUniqueUsername), so no id is
// needed in the URL at all, unlike listings which can share a title.
export function sellerShareUrl(username: string): string {
  return `${baseUrl()}/seller/${encodeURIComponent(username)}`;
}

export interface ShareDestination {
  id: string;
  label: string;
  // URL to open in a new tab for this destination.
  buildHref: (url: string, title: string) => string;
}

// Same seven curated destinations as the old share modal's button grid,
// same URL formats. "More" (native share sheet / copy fallback) is
// deliberately not in this list — it needs navigator.share/clipboard
// access at click time, not a static href, so the UI component calls
// nativeShare()/copyShareLink() below directly instead.
export const SHARE_DESTINATIONS: ShareDestination[] = [
  {
    id: "whatsapp",
    label: "WhatsApp",
    buildHref: (url, title) => `https://wa.me/?text=${encodeURIComponent(title + " " + url)}`,
  },
  {
    id: "x",
    label: "X",
    buildHref: (url, title) =>
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`,
  },
  {
    id: "facebook",
    label: "Facebook",
    buildHref: (url) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
  },
  {
    id: "telegram",
    label: "Telegram",
    buildHref: (url, title) =>
      `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`,
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    buildHref: (url) => `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
  },
  {
    id: "email",
    label: "Email",
    buildHref: (url, title) => `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(url)}`,
  },
  {
    id: "sms",
    label: "SMS",
    buildHref: (url, title) => `sms:?&body=${encodeURIComponent(title + " " + url)}`,
  },
];

// Copies to clipboard with the same textarea/execCommand fallback the
// original used for browsers that restrict the async Clipboard API.
export async function copyShareLink(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    return;
  } catch {
    // fall through to legacy fallback below
  }
  const ta = document.createElement("textarea");
  ta.value = url;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
  } catch {
    /* best-effort only */
  }
  ta.remove();
}

// Wraps navigator.share when available (mobile/OS share sheet), falling
// back to copyShareLink so the "More"/native button always does
// something useful rather than silently no-op on desktop browsers that
// lack the Web Share API. Returns true if a share/copy actually
// happened, false if the user cancelled the native sheet.
export async function nativeShare(url: string, title: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && "share" in navigator) {
    try {
      await navigator.share({ title, url });
      return true;
    } catch {
      // User cancelled — not an error, just no-op.
      return false;
    }
  }
  await copyShareLink(url);
  return true;
}
