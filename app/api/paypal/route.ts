// Adapter for /api/paypal — plans, boosts, wallet top-ups, withdrawals,
// and the PayPal webhook (subscription renewals/cancellations). Copied
// byte-for-byte from the original api/paypal.js; only its one relative
// import (./limits.js) was repointed to ../_lib/limits.js since the file
// moved. Internal logic is untouched — see that file's own comments for
// the full action list and the ADMIN_COOKIE_NAME-gated payout actions.
//
// Needs the real request headers forwarded (handled by the shared
// runLegacyHandler): PayPal's webhook detection reads
// req.headers['paypal-transmission-id'], and admin-only payout actions
// read req.headers.cookie for the admin_session cookie.
import legacyHandler from "./_handler";
import { runLegacyHandler } from "../_lib/legacyAdapter";

export async function POST(request: Request) {
  return runLegacyHandler(request, legacyHandler);
}
