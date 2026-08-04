// Client fetch helper for the `listing.discover` action (app/api/listings/
// _handler.js's handleDiscover) — powers the full-screen Discover panel
// (components/marketplace/DiscoverPanel.tsx), which replaced the old small
// "AI Search" popup. Nothing here calls an AI model — this is a plain
// random-slice browse/discovery surface, deliberately unranked (see
// handleDiscover's own comment for why: scoring would mean maintaining
// extra engagement counters across a lot of docs for a payoff that isn't
// worth the added read/write cost). Mirrors lib/premiumSellers.ts's
// fetch-helper shape exactly.
import { auth } from "@/lib/firebase";
import type { Listing } from "@/lib/listings";

export interface DiscoverBlog {
  id: string;
  title: string;
  description: string;
  coverImage: string;
  createdAt: number | null;
}

// Full listing objects now — same shape the main marketplace feed returns
// (images, financials, ownerId, ownerPlan, etc.), not a stripped-down
// lite version. See handleDiscover in app/api/listings/_handler.js.
export type DiscoverListing = Listing;

export interface DiscoverSeller {
  uid: string;
  username: string;
  profilePic: string;
  plan: string;
  rating: number;
  ratingCount: number;
}

interface DiscoverResponse {
  blogs: DiscoverBlog[];
  listings: DiscoverListing[];
  sellers: DiscoverSeller[];
  seed: number;
}

interface ApiEnvelopeOk<T> {
  ok: true;
  data: T;
}
interface ApiEnvelopeFail {
  ok: false;
  error: { message: string; code: string };
}

// `seed` must be echoed back verbatim on subsequent calls within the same
// session to keep the same shuffled slice stable (e.g. across a re-render) —
// same convention fetchPremiumSellers/handleFeed already use. Pass null/
// omit to get a fresh random slice (e.g. a "Shuffle" action, or a fresh
// panel open).
export async function fetchDiscover(seed?: number | null): Promise<DiscoverResponse> {
  const user = auth.currentUser;
  const idToken = user ? await user.getIdToken() : null;
  const resp = await fetch("/api/listings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "listing.discover", idToken, seed: seed ?? null }),
  });
  const json: ApiEnvelopeOk<DiscoverResponse> | ApiEnvelopeFail = await resp.json();
  if (!("ok" in json) || !json.ok) {
    throw new Error((json as ApiEnvelopeFail)?.error?.message || "Failed to load Discover");
  }
  return json.data;
}
