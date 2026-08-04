// Adapter that lets the original api/listings.js Vercel function
// (Node-style `handler(req, res)`) run unmodified inside a Next.js App
// Router route handler (which expects `(request: Request) => Response`).
//
// _handler.js is copied byte-for-byte from the old /api/listings.js — only
// its two relative imports (./limits.js, ./storage.js) were repointed to
// ../_lib/ since the file moved. Internal logic is untouched.
//
// The actual req/res shape translation now lives in ../_lib/legacyAdapter
// (shared across all ported API routes) rather than a copy here — this
// used to have its own inline copy of that shim before more routes needed
// the same logic.
//
// listings.js is POST-only (even reads go through action-based dispatch),
// so only POST is wired up here — a GET/HEAD request will 405 inside the
// legacy handler itself, same as it did on Vercel.

import legacyHandler from "./_handler";
import { runLegacyHandler } from "../_lib/legacyAdapter";

export async function POST(request: Request) {
  return runLegacyHandler(request, legacyHandler);
}
