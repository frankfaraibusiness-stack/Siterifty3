// GET /api/geo — returns { country, currency } for the visitor, used for
// (a) the one-time currency auto-default in lib/CurrencyContext.tsx and
// (b) the country flag next to the username in AnnouncementBar.tsx.
//
// Country: read from Vercel's auto-populated x-vercel-ip-country request
// header (2-letter ISO code, set at the edge — no external call needed).
// Falls back to null if absent (local dev, non-Vercel hosting).
//
// Currency: looked up from a full country→currency table fetched from
// restcountries.com and cached in Firestore, same fast-path-read /
// transactional-refresh-on-stale pattern app/api/fx/route.ts already uses
// for exchange rates, so concurrent cold-cache requests don't each hit
// the upstream API independently. Table only covers the codes this app
// actually supports (SUPPORTED_CURRENCIES) — an unsupported currency
// resolves to the USD fallback, same as everywhere else in the app.

import { getAdminDb } from "@/lib/server/adminDb";
import { SUPPORTED_CURRENCIES, type CurrencyCode } from "@/lib/currencies";

const GEO_DOC_PATH = ["_cache", "countryCurrencyMap"] as const;
const GEO_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30d — country/currency pairings barely ever change
const GEO_SOURCE_URL = "https://restcountries.com/v3.1/all?fields=cca2,currencies";

interface GeoDoc {
  // ISO 3166-1 alpha-2 country code -> supported currency code
  map: Record<string, CurrencyCode>;
  fetchedAt: number;
}

const SUPPORTED_SET = new Set<string>(SUPPORTED_CURRENCIES);

async function fetchFreshMap(): Promise<GeoDoc> {
  const res = await fetch(GEO_SOURCE_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`restcountries responded ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json)) throw new Error("restcountries response not an array");

  const map: Record<string, CurrencyCode> = {};
  for (const entry of json) {
    const cca2: string | undefined = entry?.cca2;
    const currencies = entry?.currencies;
    if (!cca2 || !currencies || typeof currencies !== "object") continue;
    const currencyCode = Object.keys(currencies)[0];
    if (currencyCode && SUPPORTED_SET.has(currencyCode)) {
      map[cca2] = currencyCode as CurrencyCode;
    }
    // Countries whose currency isn't in SUPPORTED_CURRENCIES are simply
    // omitted — lookup falls back to USD at read time, same as an
    // unrecognized country code would.
  }
  return { map, fetchedAt: Date.now() };
}

async function getCachedMap(): Promise<GeoDoc> {
  const db = getAdminDb();
  const ref = db.collection(GEO_DOC_PATH[0]).doc(GEO_DOC_PATH[1]);

  const snap = await ref.get();
  if (snap.exists) {
    const data = snap.data() as GeoDoc;
    if (data.fetchedAt && Date.now() - data.fetchedAt < GEO_TTL_MS) {
      return data;
    }
  }

  return db.runTransaction(async (tx) => {
    const txSnap = await tx.get(ref);
    if (txSnap.exists) {
      const data = txSnap.data() as GeoDoc;
      if (data.fetchedAt && Date.now() - data.fetchedAt < GEO_TTL_MS) {
        return data;
      }
    }
    let fresh: GeoDoc;
    try {
      fresh = await fetchFreshMap();
    } catch (err) {
      // Upstream failed — serve stale cached map rather than nothing if
      // we have one, same tolerance app/api/fx/route.ts applies.
      if (txSnap.exists) return txSnap.data() as GeoDoc;
      throw err;
    }
    tx.set(ref, fresh);
    return fresh;
  });
}

export async function GET(req: Request) {
  const country = req.headers.get("x-vercel-ip-country") || null;

  try {
    const { map } = await getCachedMap();
    const currency: CurrencyCode = (country && map[country]) || "USD";
    return Response.json(
      { country, currency },
      { headers: { "Cache-Control": "private, max-age=3600" } }
    );
  } catch (err) {
    console.error("[geo] failed to resolve country currency map:", err);
    // Degrade to "country known, currency defaults to USD" rather than a
    // hard error — the flag can still render even if the currency
    // lookup table is unavailable.
    return Response.json(
      { country, currency: "USD" as CurrencyCode, degraded: true },
      { status: 200 }
    );
  }
}
