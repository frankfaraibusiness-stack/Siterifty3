// Adapter that lets the original api/account.js Vercel function
// (Node-style `handler(req, res)`) run unmodified inside a Next.js App
// Router route handler (which expects `(request: Request) => Response`).
//
// _handler.js is copied byte-for-byte from the old /api/account.js — its
// internal logic (ensureAccount, amIAdmin, setPrivacy, etc.) is untouched.
//
// The actual req/res shape translation now lives in ../_lib/legacyAdapter
// (shared across all ported API routes) rather than a copy here — this
// used to have its own inline copy of that shim before more routes needed
// the same logic (in particular, header forwarding, which account.js
// itself never needed but several later routes do).

import legacyHandler from "./_handler";
import { runLegacyHandler } from "../_lib/legacyAdapter";

export async function GET(request: Request) {
  return runLegacyHandler(request, legacyHandler);
}

export async function POST(request: Request) {
  return runLegacyHandler(request, legacyHandler);
}
