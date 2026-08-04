// Adapter for the original api/webhooks.js. Canonical handler + dispatchWebhook
// helper live in ../_lib/webhooks.js (see _handler.js's comment) since
// deal.js also imports dispatchWebhook from that same file.
import legacyHandler from "./_handler";
import { runLegacyHandler } from "../_lib/legacyAdapter";

export async function POST(request: Request) {
  return runLegacyHandler(request, legacyHandler);
}
