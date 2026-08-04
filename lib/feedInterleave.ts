// Ports the ad/promo cadence logic from marketplace.js's mpRenderCards —
// _mpShouldShowSellerPromo, _mpShouldShowAiPromo, and the AD_CADENCE
// modulo checks. The original counts listings "since reset" across the
// whole session (not restarted each "load more" batch) so the rhythm
// continues seamlessly on infinite scroll; this is reproduced here by
// taking a running `startCount` (how many real listing cards have
// already been rendered before this call) rather than always starting
// from 0.
//
// Ad cadence is responsive-aware: the marketplace grid renders 1 column
// on phone, 2 on tablet (~768–1023px), 3 on desktop (~1024px+) — see
// .mp-grid's auto-fill/minmax sizing in globals.css. "Every N listings"
// only reads as "every N/columns rows" if N actually divides evenly by
// the live column count, so a single cadence number can't be right at
// every breakpoint: every-4 makes sense as "every other row" on phone
// (1 col) but is "every 2 rows" on tablet (2 cols) and an awkward
// mid-row break on desktop (3 cols). Instead of picking one number and
// living with it looking wrong somewhere, each ad slot below is placed
// at the position that's a clean row-boundary for ITS OWN target
// breakpoint (phone: every 4, tablet: every 6 = 3 rows of 2, desktop:
// every 9 = 3 rows of 3), and AdSlot/globals.css show only the one
// matching the current viewport via CSS media queries — so there's
// never more than one ad rendered per position, just a different unit
// picked per breakpoint.
export type AdBreakpoint = "phone" | "tablet" | "desktop";

export type FeedItem =
  | { kind: "listing"; id: string }
  | { kind: "ad"; id: string; adKind: "rect" | "banner" | "leaderboard"; targetBreakpoint: AdBreakpoint }
  | { kind: "seller-promo"; id: string }
  | { kind: "ai-promo"; id: string };

// listing-count -> mobile ad kind, same rhythm as before (rect wins over
// banner when both would fire on the same count).
const AD_CADENCE = { rect: 8, banner: 4 };
// Tablet (2-col) row-aligned cadence: every 3 rows of 2 = every 6 listings.
const TABLET_AD_CADENCE = 6;
// Desktop (3-col) row-aligned cadence: every 3 rows of 3 = every 9 listings.
const DESKTOP_AD_CADENCE = 9;

// First seller-promo card at listing #5, then every 15 after that
// (5, 20, 35, 50, ...) — an explicit two-part rule (first interval differs
// from repeat interval), not a single modulo.
const SELLER_PROMO_FIRST = 5;
const SELLER_PROMO_REPEAT = 15;
function shouldShowSellerPromo(count: number): boolean {
  if (count < SELLER_PROMO_FIRST) return false;
  return (count - SELLER_PROMO_FIRST) % SELLER_PROMO_REPEAT === 0;
}

// First AI-tools promo card at listing #10, then every 20 after that
// (10, 30, 50, 70, ...) — same two-part shape, independent counter.
const AI_PROMO_FIRST = 10;
const AI_PROMO_REPEAT = 20;
function shouldShowAiPromo(count: number): boolean {
  if (count < AI_PROMO_FIRST) return false;
  return (count - AI_PROMO_FIRST) % AI_PROMO_REPEAT === 0;
}

// Builds the full interleaved feed (listing cards + seller-promo/AI-promo
// cards + ad slots) for a full listing-id array, counting from 0 — used
// whenever the grid does a full reset (filter/search change, retry).
// `listingIds` should be in the exact order they'll be rendered.
export function buildInterleavedFeed(listingIds: string[]): FeedItem[] {
  return buildInterleavedFeedFrom(listingIds, 0);
}

// Same as above but continuing a running count — used when appending a
// "load more" batch, so the ad/promo rhythm doesn't restart at 0 for
// every page.
export function buildInterleavedFeedFrom(listingIds: string[], startCount: number): FeedItem[] {
  const out: FeedItem[] = [];
  let count = startCount;
  for (const id of listingIds) {
    out.push({ kind: "listing", id });
    count++;

    if (shouldShowSellerPromo(count)) {
      out.push({ kind: "seller-promo", id: `promo-seller-${count}` });
    }
    if (shouldShowAiPromo(count)) {
      out.push({ kind: "ai-promo", id: `promo-ai-${count}` });
    }

    // Phone ad (only one fires per count, rect takes priority — same
    // rhythm as before, shown only at phone widths).
    if (count % AD_CADENCE.rect === 0) {
      out.push({ kind: "ad", adKind: "rect", targetBreakpoint: "phone", id: `ad-rect-${count}` });
    } else if (count % AD_CADENCE.banner === 0) {
      out.push({ kind: "ad", adKind: "banner", targetBreakpoint: "phone", id: `ad-banner-${count}` });
    }

    // Tablet ad — independent cadence, own position, shown only at
    // tablet widths.
    if (count % TABLET_AD_CADENCE === 0) {
      out.push({ kind: "ad", adKind: "banner", targetBreakpoint: "tablet", id: `ad-tablet-${count}` });
    }

    // Desktop leaderboard ad — independent cadence, own position, shown
    // only at desktop widths.
    if (count % DESKTOP_AD_CADENCE === 0) {
      out.push({ kind: "ad", adKind: "leaderboard", targetBreakpoint: "desktop", id: `ad-desktop-${count}` });
    }
  }
  return out;
}
