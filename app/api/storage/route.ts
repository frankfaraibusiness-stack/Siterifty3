// Adapter that lets the original api/storage.js Vercel function
// (Node-style `handler(req, res)`) run unmodified inside a Next.js App
// Router route handler — same pattern as listings/route.ts and
// deal/route.ts. The actual upload logic (Supabase multi-account
// routing, quota checks, transfer-file vs public-URL branching) lives
// untouched in ../_lib/storage.js; this file only exists so
// fetch('/api/storage', ...) from the client has something to hit.
//
// storage.js is POST-only (uploads), so only POST is wired up here —
// a GET/HEAD request will 405 inside the legacy handler itself, same
// as it did on Vercel.

import legacyHandler from "../_lib/storage.js";
import { runLegacyHandler } from "../_lib/legacyAdapter";

export async function POST(request: Request) {
  return runLegacyHandler(request, legacyHandler);
}
