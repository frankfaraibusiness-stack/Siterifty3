// Adapter for /api/deal — escrow deal lifecycle (create/accept/release/
// dispute/refund), deal chat, and the two Vercel Cron sweep jobs
// (sweep-expired-deals, agent-sweep). Copied byte-for-byte from the
// original api/deal.js; its four relative imports were repointed to
// ../_lib/ since the file moved (storage.js, limits.js, push.js,
// webhooks.js — all already ported there). Internal logic is untouched;
// see that file's own comments for the full action list.
//
// Both GET and POST are wired: Vercel Cron sends GET for
// sweep-expired-deals and agent-sweep (both gated by a CRON_SECRET env
// var checked against the real Authorization header — needs the shared
// adapter's header forwarding to work), and agent-limits is a public GET
// lookup. Every other action is POST. The admin_session cookie gate on
// dispute-resolution actions also depends on the real Cookie header being
// forwarded.
import legacyHandler from "./_handler";
import { runLegacyHandler } from "../_lib/legacyAdapter";

export async function GET(request: Request) {
  return runLegacyHandler(request, legacyHandler);
}

export async function POST(request: Request) {
  return runLegacyHandler(request, legacyHandler);
}
