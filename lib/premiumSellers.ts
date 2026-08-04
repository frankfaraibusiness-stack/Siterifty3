// Client fetch helper for the `listing.premium-sellers` action (ported
// server-side already in app/api/listings/_handler.js, byte-for-byte
// copy of the original's handlePremiumSellers). Powers the "Premium
// sellers" strip at the top of the marketplace (mpLoadTopSellers /
// mpFetchPremiumSellers in the original marketplace.js).
import { auth } from "@/lib/firebase";

export interface PremiumSeller {
  uid: string;
  username: string;
  profilePic: string;
  plan: string;
  rating: number;
  ratingCount: number;
  dealsCompleted: number;
  followerCount: number;
  listingCount: number;
}

interface PremiumSellersResponse {
  sellers: PremiumSeller[];
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
// session so the same random pool of 5 stays stable — mirrors the
// original's module-scoped _mpPremiumSeed convention exactly.
export async function fetchPremiumSellers(seed?: number | null): Promise<PremiumSellersResponse> {
  const user = auth.currentUser;
  const idToken = user ? await user.getIdToken() : null;
  const resp = await fetch("/api/listings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "listing.premium-sellers", idToken, seed: seed ?? null }),
  });
  const json: ApiEnvelopeOk<PremiumSellersResponse> | ApiEnvelopeFail = await resp.json();
  if (!("ok" in json) || !json.ok) {
    throw new Error((json as ApiEnvelopeFail)?.error?.message || "Failed to load premium sellers");
  }
  return json.data;
}
