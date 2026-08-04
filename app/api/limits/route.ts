// Adapter for /api/limits — GET serves the public limits/pricing payload
// (plans, fees, wallet bounds, boost pricing, etc.), POST handles the
// check-username-change / check-email-change / check-profilepic-change /
// check-listing-cap actions.
//
// Unlike other routes, there's no separate ./_handler.js here — the fully
// ported handler already lives at ../_lib/limits.js (it was pulled there
// early on since listings.js, paypal.js, and deal.js all import its LIMITS
// constant directly). This route file just mounts that same default export
// as a real endpoint via the shared adapter, rather than duplicating 394
// lines into a second copy.
//
// GET needs query forwarding (the original supports GET /api/limits?uid=...
// for a personalised rate-limit status alongside the public payload) — the
// shared runLegacyHandler already builds req.query from the URL's search
// params, so no extra work is needed here for that.
import legacyHandler from "../_lib/limits";
import { runLegacyHandler } from "../_lib/legacyAdapter";

export async function GET(request: Request) {
  return runLegacyHandler(request, legacyHandler);
}

export async function POST(request: Request) {
  return runLegacyHandler(request, legacyHandler);
}
