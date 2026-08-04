"use client";

// Recently-viewed listings — purely client-side (localStorage), no
// Firestore reads/writes, no auth requirement. Records a lightweight
// snapshot of exactly the fields ListingCard's four variants (Site/App/
// Game/3D Asset) actually render — same subset SaveButton already
// snapshots for its own favorites doc — rather than a full Listing, so
// re-rendering a recently-viewed card never needs a second network fetch
// just to draw the strip.
//
// Deliberately NOT synced to Firestore / cross-device: this is meant to
// be an instant, always-available "what did I just look at" trail, not
// a durable feature — same tradeoff a browser's own history makes.
import type { Listing, ListingType } from "@/lib/listings";

const STORAGE_KEY = "srf_recently_viewed";
const MAX_ENTRIES = 16;

export interface RecentlyViewedEntry {
  id: string;
  title: string;
  type: ListingType;
  image: string;
  price: number | null;
  revenue: number | null;
  expenses: number | null;
  profit: number | null;
  ownerId: string | null;
  ownerEmail: string | null;
  viewedAt: number;
  // 3D-asset-only fields — undefined/omitted for every other type. Added
  // because AssetCard doesn't read images[]/financials at all for its
  // preview and stats; it reads listing.embedUrl (the live model embed)
  // and listing.settings.format/license/category. Without these, a 3D
  // asset reconstructed from a recently-viewed snapshot always showed
  // "No preview available" and "—" for Format/License even though the
  // real listing document had all three set.
  embedUrl?: string;
  category?: string;
  format?: string;
  license?: string;
}

function readAll(): RecentlyViewedEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(entries: RecentlyViewedEntry[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    // Storage can fail (quota, private-browsing restrictions) — this is
    // a non-critical enhancement, so fail silently rather than throw.
  }
}

// Records a view — called from ListingViewBeacon alongside the existing
// trackListing("listing.view", ...) analytics beacon. Moves the listing
// to the front if already present (most-recently-viewed first) instead
// of duplicating it.
//
// Snapshots the full financials trio (price/revenue/expenses/profit) —
// not just price — plus ownerId/ownerEmail, so a reconstructed card can
// show real revenue/expenses/profit instead of "—", and so "View seller"
// on a recently-viewed card actually has an id to navigate to. An
// earlier version only stored price, which meant every recently-viewed
// card showed blank financials and its seller strip's "View seller"
// silently did nothing (onOpenSeller received undefined).
//
// Also snapshots embedUrl/category/format/license for type==='3d' —
// AssetCard reads these instead of images[]/financials for its preview
// and stats grid, so without them a recently-viewed 3D asset could never
// render its model preview or Format/License, regardless of what the
// real listing document had.
export function recordRecentlyViewed(listing: Listing) {
  if (typeof window === "undefined" || !listing.id) return;
  const snapshot: RecentlyViewedEntry = {
    id: listing.id,
    title: listing.title || "Untitled",
    type: listing.type || "website",
    image: listing.images?.[2] || listing.imageCover || listing.images?.[0] || listing.appIcon || "",
    price: typeof listing.financials?.price === "number" ? listing.financials.price : null,
    revenue: typeof listing.financials?.revenue === "number" ? listing.financials.revenue : null,
    expenses: typeof listing.financials?.expenses === "number" ? listing.financials.expenses : null,
    profit: typeof listing.financials?.profit === "number" ? listing.financials.profit : null,
    ownerId: listing.ownerId || null,
    ownerEmail: listing.ownerEmail || null,
    viewedAt: Date.now(),
    ...(listing.type === "3d"
      ? {
          embedUrl: listing.embedUrl || undefined,
          category: listing.category || listing.settings?.category || undefined,
          format: listing.settings?.format || undefined,
          license: listing.settings?.license || undefined,
        }
      : {}),
  };
  const existing = readAll().filter((e) => e.id !== listing.id);
  writeAll([snapshot, ...existing]);
}

export function getRecentlyViewed(excludeId?: string): RecentlyViewedEntry[] {
  const all = readAll();
  return excludeId ? all.filter((e) => e.id !== excludeId) : all;
}

export function clearRecentlyViewed() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

// Reconstructs a minimal Listing-shaped object from a stored snapshot —
// enough for ListingCard's Site/App/Game/3D Asset variants to render
// correctly (title, image, full financials, owner), same posture as
// SaveButton's favorites-tab comment about rendering "a full card
// instantly without an extra per-item listing fetch". Includes ownerId/
// ownerEmail so SellerStrip's useSeller(ownerId) can resolve a real
// seller (name, avatar, badges) and so "View seller" has an id to
// navigate to — without ownerId there, onOpenSeller(undefined) was a
// no-op. For type==='3d', also restores embedUrl/settings.format/
// settings.license/category so AssetCard's model preview and stats
// grid render instead of falling back to "No preview available"/"—".
export function entryToListing(entry: RecentlyViewedEntry): Listing {
  return {
    id: entry.id,
    type: entry.type,
    title: entry.title,
    images: entry.image ? [entry.image, entry.image, entry.image] : [],
    financials: {
      ...(entry.price !== null ? { price: entry.price } : {}),
      ...(entry.revenue !== null ? { revenue: entry.revenue } : {}),
      ...(entry.expenses !== null ? { expenses: entry.expenses } : {}),
      ...(entry.profit !== null ? { profit: entry.profit } : {}),
    },
    ownerId: entry.ownerId || undefined,
    ownerEmail: entry.ownerEmail || undefined,
    ...(entry.type === "3d"
      ? {
          embedUrl: entry.embedUrl,
          category: entry.category,
          settings: {
            ...(entry.format ? { format: entry.format } : {}),
            ...(entry.license ? { license: entry.license } : {}),
            ...(entry.category ? { category: entry.category } : {}),
          },
        }
      : {}),
  };
}
