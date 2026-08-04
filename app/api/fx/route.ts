// GET /api/fx — returns { base: "USD", rates: { EUR: 0.92, GBP: 0.79, ... },
// fetchedAt } for the currency-conversion display feature (Settings →
// Appearance → Currency). Display-only: escrow/PayPal always settle in
// USD (see app/api/paypal/_handler.js's hardcoded currency_code: 'USD') —
// nothing here ever touches an actual transaction amount.
//
// This is new plumbing, not a ported endpoint, so it's a native Route
// Handler rather than routed through the legacy action-dispatch adapter
// every other app/api/* folder uses (see ../listings/route.ts's comment
// for why that pattern exists elsewhere — there's no legacy .js file to
// port here, so there's nothing to gain by forcing this through it).
//
// Rate source: https://open.er-api.com — free, no API key, no signup,
// rates refresh once every 24h on their end. Cached here using the same
// fast-path-read / transactional-refresh-on-stale pattern
// listings/_handler.js's _getTypePool already uses for the feed cache,
// so concurrent cold-cache requests don't each hit the upstream API
// independently.

import { getAdminDb } from "@/lib/server/adminDb";
import { SUPPORTED_CURRENCIES } from "@/lib/currencies";

const FX_DOC_PATH = ["_cache", "fxRates"] as const;
const FX_TTL_MS = 12 * 60 * 60 * 1000; // 12h — well under the upstream's own 24h refresh
const FX_SOURCE_URL = "https://open.er-api.com/v6/latest/USD";

interface FxDoc {
  base: "USD";
  rates: Record<string, number>;
  fetchedAt: number;
}

async function fetchFreshRates(): Promise<FxDoc> {
  const res = await fetch(FX_SOURCE_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`FX source responded ${res.status}`);
  const json = await res.json();
  if (!json?.rates) throw new Error("FX source response missing rates");

  const rates: Record<string, number> = { USD: 1 };
  for (const code of SUPPORTED_CURRENCIES) {
    if (typeof json.rates[code] === "number") rates[code] = json.rates[code];
  }
  return { base: "USD", rates, fetchedAt: Date.now() };
}

async function getCachedRates(): Promise<FxDoc> {
  const db = getAdminDb();
  const ref = db.collection(FX_DOC_PATH[0]).doc(FX_DOC_PATH[1]);

  const snap = await ref.get();
  if (snap.exists) {
    const data = snap.data() as FxDoc;
    if (data.fetchedAt && Date.now() - data.fetchedAt < FX_TTL_MS) {
      return data;
    }
  }

  return db.runTransaction(async (tx) => {
    const txSnap = await tx.get(ref);
    if (txSnap.exists) {
      const data = txSnap.data() as FxDoc;
      if (data.fetchedAt && Date.now() - data.fetchedAt < FX_TTL_MS) {
        return data;
      }
    }
    let fresh: FxDoc;
    try {
      fresh = await fetchFreshRates();
    } catch (err) {
      // Upstream failed — serve stale cached rates rather than nothing if
      // we have any, since a slightly-stale conversion is still more
      // useful than none. Only throw if there's truly nothing cached yet.
      if (txSnap.exists) return txSnap.data() as FxDoc;
      throw err;
    }
    tx.set(ref, fresh);
    return fresh;
  });
}

export async function GET() {
  try {
    const data = await getCachedRates();
    return Response.json(data, {
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  } catch (err) {
    console.error("[fx] failed to resolve rates:", err);
    // Degrade to USD-only rather than a hard error — the currency picker
    // can still function (just with only USD selectable) if the upstream
    // API and the cache both fail.
    return Response.json(
      { base: "USD", rates: { USD: 1 }, fetchedAt: Date.now(), degraded: true },
      { status: 200 }
    );
  }
}
