// The canonical byte-for-byte copy of the original api/webhooks.js lives at
// ../_lib/webhooks.js — it's imported from there rather than duplicated
// here because deal.js also needs to import dispatchWebhook from the same
// file, and having two copies would risk them drifting apart. This file
// just re-exports the default HTTP handler so route.ts can import it the
// same way every other route's _handler.js works.
export { default } from "../_lib/webhooks.js";
