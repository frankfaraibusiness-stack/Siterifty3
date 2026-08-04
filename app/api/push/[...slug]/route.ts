// Adapter for /api/push/subscribe and /api/push/unsubscribe.
//
// The original api/push.js is a single Vercel function that routes by
// inspecting req.url's suffix (`path.endsWith('/subscribe')` /
// `'/unsubscribe'`) rather than being two separate files — see that
// file's own top-of-handler comment. A Next.js App Router catch-all
// segment ([...slug]) is the equivalent here: it matches both
// /api/push/subscribe and /api/push/unsubscribe under one route, and
// runLegacyHandler forwards the real request pathname through as req.url,
// so the legacy handler's own suffix check keeps working unmodified.
//
// Canonical handler logic + the sendPushToUser export live in
// ../../_lib/push.js (not duplicated here) since deal.js also imports
// sendPushToUser from that same file.
import legacyHandler from "../../_lib/push.js";
import { runLegacyHandler } from "../../_lib/legacyAdapter";

export async function POST(request: Request) {
  return runLegacyHandler(request, legacyHandler);
}
