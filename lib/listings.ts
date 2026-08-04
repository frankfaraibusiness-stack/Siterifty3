// Shared types + client fetch helpers for /api/listings.
//
// Mirrors the real server contract in app/api/listings/_handler.js
// (ported byte-for-byte from the original api/listings.js) — see that
// file's top-of-file comment block for the full action list. This file
// only covers what the marketplace grid needs so far: `listing.feed`.
//
// Listing objects here are raw Firestore docs (`{ id, ...d.data() }`),
// so this type is intentionally a superset covering website/app/game
// fields — most fields are optional because a given listing only has
// the ones relevant to its `type`.

export type ListingType = "website" | "app" | "game" | "3d";

export interface ListingFinancials {
  price?: number;
  revenue?: number;
  expenses?: number;
  profit?: number;
}

export type SaleType = "fixed" | "auction";

// Minimum-increment rule is fixed at 10% platform-wide (not seller-
// configurable) — see MIN_BID_INCREMENT_PCT in _handler.js, the single
// source of truth this constant mirrors for client-side display/preview
// only. The server always re-validates independently of anything sent
// by the client.
export const MIN_BID_INCREMENT_PCT = 0.10;

export type AuctionStatus = "scheduled" | "live" | "ended";

export interface AuctionBid {
  bidderId: string;
  bidderHandle?: string;
  amount: number;
  placedAt?: unknown;
}

export interface AuctionInfo {
  startPrice: number;
  startTime: string;
  endTime: string;
  currentBid?: number | null;
  currentBidderId?: string | null;
  currentBidderHandle?: string | null;
  bidCount?: number;
  status: AuctionStatus;
  winnerId?: string | null;
  closedAt?: unknown;
}

export interface ListingTech {
  frontend?: string;
  backend?: string;
  database?: string;
  monetization?: string;
}

// Mirrors the `settings` sub-object as read by the app-listing modal body
// (category/age/structure/reason) — the original reuses this same field
// name across website/app/game types with type-specific keys, so like the
// rest of this file it's kept as a loose superset rather than split per type.
export interface ListingSettings {
  category?: string;
  age?: string;
  location?: string; // website-type only, mirrors settings.location in mpOpenModal's website branch
  structure?: string;
  reason?: string;
  // 3D Asset listings only — see AssetListingForm.tsx's own FORMAT_OPTIONS/
  // LICENSE_OPTIONS (not shared with any other listing type's settings).
  format?: string;
  license?: string;
}

// Monthly traffic claim + its supporting analytics screenshots (GA4,
// Search Console, host panel, etc). Optional overall, but once a visits
// number is entered at least one screenshot is required client-side.
export interface ListingTraffic {
  monthlyVisits?: number;
  proofUrls?: string[];
}

export interface ListingBuildFile {
  filename?: string;
  url?: string | null;
  storagePath?: string | null;
}

export interface AttachedRepo {
  fullName?: string;
  htmlUrl?: string;
  private?: boolean;
  language?: string;
}

// Per-platform install/engagement stats for store-distributed app & game
// listings (iOS/Android only — see PLATFORM_META.isStore). Required
// client-side whenever that platform is marked Live.
export interface PlatformStats {
  installs?: number;
  mau?: number;
}

export interface Listing {
  id: string;
  type: ListingType;
  title?: string;
  description?: string;
  tagline?: string;
  url?: string;
  isTemplate?: boolean;
  status?: string;
  ownerId?: string;
  ownerEmail?: string;
  ownerPlan?: string;
  financials?: ListingFinancials & { model?: string; subMonthly?: number; subAnnual?: number };
  // Defaults to "fixed" for any listing that predates this field. When
  // "auction", `financials.price` is unused for the buy side — bidding
  // reads/writes exclusively through `auction` below.
  saleType?: SaleType;
  auction?: AuctionInfo;
  traffic?: ListingTraffic;
  tech?: ListingTech;
  settings?: ListingSettings;
  images?: string[];
  imageCover?: string;
  appIcon?: string;
  category?: string;
  gameType?: string;
  videoUrl?: string;
  previewUrl?: string;
  // 3D Asset listings only — the resolved iframe src URL for the seller's
  // live embed (Sketchfab or any other platform), stored server-side after
  // extraction/validation (see lib/embedUrl.ts + _handler.js's
  // extractEmbedSrc/isValidEmbedUrl). Always a bare validated URL, never
  // raw HTML — see AssetIframe.tsx for the one place this gets rendered.
  embedUrl?: string;
  // Platform selection + store links for app listings — mirrors
  // listing.platforms in the original (selected/iosUrl/androidUrl/webUrl/
  // previewUrl), plus the per-platform "Not Live" state + uploaded build
  // files nested alongside it (see buildPlatforms/buildNotLive in
  // _handler.js — this nested shape is preserved server-side, not
  // flattened).
  platforms?: {
    selected?: string[];
    iosUrl?: string | null;
    androidUrl?: string | null;
    webUrl?: string | null;
    // Present for Game listings, which can also distribute on Steam or as
    // a direct desktop download alongside/instead of iOS/Android/Web.
    steamUrl?: string | null;
    desktopUrl?: string | null;
    previewUrl?: string | null;
    notLive?: { ios?: boolean; android?: boolean; web?: boolean };
    // iOS/Android "not live" builds are always an externally-hosted link
    // now (Drive/Dropbox/etc) — Siterifty never stores APK/IPA binaries.
    // Only "web" not-live still uploads a file (html/css/js, zipped into
    // one archive if there was more than one — see zipIfMultiple in
    // AppListingForm.tsx), since that's small and can be rendered live.
    iosBuildUrl?: string | null;
    androidBuildUrl?: string | null;
    webBuildFiles?: ListingBuildFile[] | null;
    // Installs + Monthly Active Users per store-distributed platform
    // (iOS/Android only — see PlatformStats/PLATFORM_META.isStore).
    // Required client-side whenever that platform is marked Live.
    stats?: { ios?: PlatformStats; android?: PlatformStats };
  };
  // Link to an externally-hosted build for an app that isn't published
  // anywhere yet (globalNotLive) — never an uploaded binary.
  globalBuildUrl?: string;
  additionalFiles?: ListingBuildFile[];
  notLive?: boolean;
  // Legacy binary uploads (older listings created before the link-only
  // change to app builds) — no current form writes these, but existing
  // listings that already have them still need to render/download them.
  apkUrl?: string;
  apkStorageUrl?: string;
  apkIpaFileName?: string;
  apkFileName?: string;
  notLiveBuildFiles?: { global?: ListingBuildFile[] };
  attachedRepo?: AttachedRepo;
  transferMethods?: string[];
  saves?: number;
  boostedUntil?: number | { toMillis?: () => number; seconds?: number };
  createdAt?: unknown;
  // Domain ownership verification (see /api/listings listing.verify-*).
  // Optional — publishing never requires this; it only controls whether a
  // green "Verified" badge is shown on the listing.
  verified?: boolean;
  verifiedDomain?: string;
  verifiedAt?: unknown;
  verification?: { domain: string; token: string };
  // Store-link plausibility check (see listing.link-check) for app/game
  // listings whose only proof is a Play Store/App Store/itch.io link — NOT
  // ownership proof, just "we checked the link resolves and looks related".
  linkCheck?: { url: string; status: "link-checked" | "link-provided"; checkedAt?: unknown };
}

export interface FeedResponse {
  listings: Listing[];
  seed: number;
  cursor: Record<string, number>;
  exhausted: boolean;
}

export interface SimilarResponse {
  listings: Listing[];
}

export interface BoostedAdsResponse {
  listings: Listing[];
}

export interface SearchResponse {
  listings: Listing[];
  query: string;
}

interface ApiEnvelopeOk<T> {
  ok: true;
  data: T;
}
interface ApiEnvelopeFail {
  ok: false;
  error: { message: string; code: string };
}
type ApiEnvelope<T> = ApiEnvelopeOk<T> | ApiEnvelopeFail;

export class ListingsApiError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

async function callListingsApi<T>(action: string, params: object = {}): Promise<T> {
  const res = await fetch("/api/listings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...params }),
  });
  const out: ApiEnvelope<T> = await res.json();
  if (out.ok === false) throw new ListingsApiError(out.error.message, out.error.code);
  return out.data;
}

// Fetches the full listing doc straight from Firestore by id. Unlike the
// original (where mpOpenModal only ever ran off an already-in-memory
// listing object handed to it by whichever card/list triggered it —
// there was no route that could cold-load a listing by id alone), a
// Next.js /listing/[id] page is directly linkable/refreshable, so this
// is the real source of truth for that route. Reads the same `listings`
// collection every other part of this app reads from (see e.g.
// marketplace.js's doc(db,'listings',listingId)). Returns null if the
// doc doesn't exist or was deleted.
export async function fetchListingById(id: string): Promise<Listing | null> {
  const { doc, getDoc } = await import("firebase/firestore");
  const { db } = await import("@/lib/firebase");
  const snap = await getDoc(doc(db, "listings", id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as Omit<Listing, "id">) };
}

// action: 'listing.feed' — public, no auth required. `seed`/`cursor` must
// be echoed back verbatim from the previous response to continue the same
// shuffled session (see _handler.js's handleFeed for why).
export async function fetchFeed(params: {
  seed?: number;
  cursor?: Record<string, number>;
  pageSize?: number;
  type?: ListingType;
  idToken?: string | null;
} = {}): Promise<FeedResponse> {
  return callListingsApi<FeedResponse>("listing.feed", params);
}

// action: 'listing.similar' — public, no auth required. Up to `limit`
// (server default 4, max 8) other active listings of the same type as
// `listingId`, closest in price first. Powers SimilarListingsStrip on the
// listing detail page.
export async function fetchSimilarListings(params: {
  listingId: string;
  limit?: number;
  idToken?: string | null;
}): Promise<SimilarResponse> {
  return callListingsApi<SimilarResponse>("listing.similar", params);
}

// action: 'listing.search' — public, no auth required. Server-side search
// against the FULL cached catalog pool (see _handler.js's handleSearch),
// not just whatever page of the feed happens to be loaded in the browser
// already. Replaces filtering `applyClientFilters`'s searchQuery branch
// against an in-memory `listings` array (see useMarketplaceFilters.ts) —
// that approach could only ever find listings the infinite-scroll feed had
// already fetched, so anything past the currently-loaded page was
// invisible to search. Empty/whitespace `q` returns an empty result
// immediately without a network call — see callers (SearchOverlay,
// MarketplaceFilterBar) for the debounce that wraps this.
export async function fetchSearchResults(params: {
  q: string;
  type?: ListingType;
  limit?: number;
  idToken?: string | null;
}): Promise<SearchResponse> {
  if (!params.q || !params.q.trim()) return { listings: [], query: "" };
  return callListingsApi<SearchResponse>("listing.search", params);
}

// action: 'listing.boosted-ads' — public, no auth required. Powers
// BoostedRow. Deliberately a SEPARATE call from fetchFeed, not derived from
// its results — sellers pay real money for this placement, and the feed
// pool it would otherwise share is cached server-side for up to an hour
// (see _getTypePool in _handler.js). This action reads Firestore's
// `boostedAds` collection directly on every call with no cache layer, so a
// boost purchased seconds ago — or a listing edited while boosted — shows
// up on the very next load. Call this fresh whenever BoostedRow mounts or
// the marketplace is revisited; don't cache/reuse its result the way feed
// pages are reused.
export async function fetchBoostedAds(params: {
  type?: ListingType;
  idToken?: string | null;
} = {}): Promise<BoostedAdsResponse> {
  return callListingsApi<BoostedAdsResponse>("listing.boosted-ads", params);
}

// Fire-and-forget analytics beacon — mirrors _mpTrackListing. Never throws
// into the caller; a failed impression/view ping should never break
// browsing.
export async function trackListing(action: "listing.impression" | "listing.view", listingId: string, idToken?: string | null) {
  if (!listingId) return;
  try {
    await fetch("/api/listings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, idToken: idToken || null, listingId }),
    });
  } catch (err) {
    console.error("[trackListing]", action, err);
  }
}

// action: 'listing.mine' — auth required, caller's own listings only.
// Minimal wrapper (Seller Dashboard calls the raw action directly via its
// own hook — see lib/useSellerDashboard.ts — this is for simpler callers
// like /aitools's verification card that just need "my listings", no
// dashboard-specific shaping).
export async function fetchMyListings(params: { idToken: string; status?: string }): Promise<{ listings: Listing[] }> {
  return callListingsApi<{ listings: Listing[] }>("listing.mine", params);
}

// action: 'listing.create' — auth required. Mirrors the payload shape
// built by the old lfm/gfm/afm submit handlers (listing-form.js,
// listing-form-game.js, onboarding.js's app form) — see _handler.js's
// handleCreate for exactly which fields it reads.
export interface CreateListingParams {
  idToken: string;
  type: ListingType;
  isTemplate?: boolean;
  url?: string | null;
  // Optional template-build fields — only sent when type === 'website' &&
  // isTemplate. Mirrors the original lfm submit payload (tplBuildUrl for an
  // uploaded HTML/CSS/JS build hosted via /api/storage, tplDemoUrl for an
  // external demo link). Not currently persisted by handleCreate server-side,
  // same as the original client's payload — kept here for shape parity and
  // in case the handler is extended to store them later.
  tplBuildUrl?: string | null;
  tplDemoUrl?: string | null;
  title: string;
  description: string;
  images?: string[];
  appIcon?: string;
  category?: string;
  tech?: ListingTech;
  settings?: ListingSettings;
  financials: { price: number; revenue: number; expenses: number; revenueProofUrls?: string[] };
  traffic?: { monthlyVisits?: number; proofUrls?: string[] };
  transferMethods?: string[];
  gameType?: string;
  videoUrl?: string;
  previewUrl?: string;
  // 3D Asset listings only. Raw client input as the seller typed/pasted it
  // — either a bare embed URL or a full <iframe> snippet, whichever mode
  // they picked in AssetListingForm. The server (not this client) is what
  // extracts + validates the actual src url; see resolveEmbedUrl in
  // _handler.js. Never rendered client-side before that round-trip.
  embedCode?: string;
  platforms?: Listing["platforms"];
  additionalFiles?: ListingBuildFile[];
  // Global "app not published anywhere yet" flag + its build link — see
  // buildNotLive in _handler.js for the flag, globalBuildUrl for the link.
  // Distinct from the per-platform notLive nested inside `platforms` above.
  // Used by AppListingForm.tsx.
  notLive?: { ios?: boolean; android?: boolean; web?: boolean; global?: boolean };
  globalBuildUrl?: string;
  attachedRepo?: AttachedRepo | null;
  // Auction fields — see buildAuction in _handler.js for full validation
  // rules. Omit both (or send saleType: "fixed") for an ordinary
  // fixed-price listing; financials.price still governs that case exactly
  // as before. When saleType is "auction", `auction` is required and the
  // server computes/owns everything else on it (currentBid, bidCount,
  // status, winnerId) — this client only ever sends startPrice/startTime/
  // endTime, never the derived fields.
  saleType?: SaleType;
  auction?: { startPrice: number; startTime: string; endTime: string };
}

export async function createListing(
  params: CreateListingParams
): Promise<{ listingId: string; plan: string }> {
  return callListingsApi<{ listingId: string; plan: string }>("listing.create", params);
}

// action: 'listing.update' — auth required, owner-only (enforced server-side
// against listing.ownerId). Mirrors handleUpdate's accepted body fields
// exactly (see _handler.js) — type/status/ownerId/createdAt are deliberately
// not accepted here since the server never trusts/reads them from the
// request body for this action. Used by EditListingModal.tsx.
export interface UpdateListingParams {
  idToken: string;
  listingId: string;
  title: string;
  description: string;
  url?: string;
  category?: string;
  tech?: ListingTech;
  settings?: ListingSettings;
  financials?: { price: number | null; revenue: number | null; expenses: number | null };
  images?: string[];
  appIcon?: string;
  gameFile?: string;
  videoUrl?: string;
  previewUrl?: string;
  // 3D Asset listings only — see the matching field on CreateListingParams.
  embedCode?: string;
  platforms?: Listing["platforms"];
  transferMethods?: string[];
  apkUrl?: string;
  apkStorageUrl?: string;
  apkIpaFileName?: string;
  apkFileName?: string;
  // Legacy — older listings only, no current form writes this. Global
  // not-live builds are a link (globalBuildUrl) now, not an uploaded file.
  notLiveBuildFiles?: { global?: ListingBuildFile[] };
  additionalFiles?: ListingBuildFile[];
  notLive?: boolean;
  globalBuildUrl?: string;
  // See the matching fields on CreateListingParams above — omit both to
  // leave the listing's current sale mode untouched (same convention as
  // embedCode: omission means "not touching this field", not "clear it").
  saleType?: SaleType;
  auction?: { startPrice: number; startTime: string; endTime: string };
}

export async function updateListing(params: UpdateListingParams): Promise<Record<string, never>> {
  return callListingsApi<Record<string, never>>("listing.update", params);
}

// action: 'listing.bid' — auth required. Server enforces the 10%-over-
// current-bid minimum, the not-your-own-listing rule, and the auction's
// live window; this client sends only the raw amount and never computes
// or trusts a "minimum" of its own beyond what it shows as a live preview
// (see MIN_BID_INCREMENT_PCT above — UI-only, the server's copy in
// _handler.js is the one actually enforced). Throws ListingsApiError with
// code BID_TOO_LOW / AUCTION_ENDED / AUCTION_NOT_STARTED /
// CANNOT_BID_OWN_LISTING / NOT_AN_AUCTION on rejection — BidModal.tsx
// reads `.code` to show a specific inline message rather than a generic
// failure banner.
export async function placeBid(params: {
  idToken: string;
  listingId: string;
  amount: number;
}): Promise<{ currentBid: number }> {
  return callListingsApi<{ currentBid: number }>("listing.bid", params);
}

// Owner-only early cancel of an active boost — see handleUnboost in
// app/api/listings/_handler.js. No refund for unused days; just stops the
// listing from showing/behaving as boosted.
export async function unboostListing(params: { idToken: string; listingId: string }): Promise<Record<string, never>> {
  return callListingsApi<Record<string, never>>("listing.unboost", params);
}

// ── Domain ownership verification (action: 'listing.verify-generate' /
// 'listing.verify-check') — see _handler.js for the full server-side
// contract. Both owner-only; listingId must belong to the caller. Optional
// step — a listing publishes and stays fully usable whether or not this is
// ever run; it only controls the green "Verified" badge.
export interface VerifyGenerateResponse {
  domain: string;
  token: string;
  snippet: string;
}
export async function generateVerification(params: { idToken: string; listingId: string }): Promise<VerifyGenerateResponse> {
  return callListingsApi<VerifyGenerateResponse>("listing.verify-generate", params);
}

export interface VerifyCheckResponse {
  verified: boolean;
  domain: string;
}
export async function checkVerification(params: { idToken: string; listingId: string }): Promise<VerifyCheckResponse> {
  return callListingsApi<VerifyCheckResponse>("listing.verify-check", params);
}

// ── Store-link plausibility check (action: 'listing.link-check') — for
// app/game listings whose only proof is a Play Store/App Store/itch.io
// link. Best-effort, never a substitute for real domain verification — see
// _handler.js's handleLinkCheck for exactly what each status means.
export interface LinkCheckResponse {
  status: "link-checked" | "link-provided" | "invalid-url";
  reason?: string;
}
export async function checkStoreLink(params: { idToken: string; listingId: string; url: string }): Promise<LinkCheckResponse> {
  return callListingsApi<LinkCheckResponse>("listing.link-check", params);
}

// $ formatting for site cards — full number, comma-separated.
export function fmtPrice(n: number | undefined | null): string {
  return typeof n === "number" ? `$${n.toLocaleString()}` : "Make offer";
}

// $ formatting for app/game card stat strips — abbreviates large numbers
// (1.2M / 45k). Mirrors fmtFinVal in the original marketplace.js exactly.
export function fmtFinVal(n: number | undefined | null): string {
  if (n === null || n === undefined) return "—";
  if (Math.abs(n) >= 1_000_000) return "$" + (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (Math.abs(n) >= 10_000) return "$" + (n / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  return "$" + n.toLocaleString();
}

// Mirrors _isBoosted exactly — server Timestamp fields come back with
// .toMillis(), plain numbers stay numbers.
export function isBoosted(listing: Listing): boolean {
  const until = listing.boostedUntil;
  if (!until) return false;
  const ms =
    typeof until === "number"
      ? until
      : until.toMillis
      ? until.toMillis()
      : until.seconds
      ? until.seconds * 1000
      : 0;
  return ms > Date.now();
}

export const SR_PAID_PLANS = ["starter", "growth", "pro"] as const;

// Mirrors _isPremiumSeller — purely visual (shimmer), carries no
// placement/ranking weight. `ownerPlan` is attached server-side in the
// feed response.
export function isPremiumSeller(listing: Listing): boolean {
  return SR_PAID_PLANS.includes((listing.ownerPlan as any) || "free");
}
