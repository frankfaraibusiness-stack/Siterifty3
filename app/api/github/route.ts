// Adapter that lets the rebuilt api/github.js-style handler (Node-style
// `handler(req, res)`) run inside a Next.js App Router route handler.
// Same shim as every other ported route — see ../_lib/legacyAdapter.
//
// This route didn't exist in either migration zip; see _handler.js's top
// comment for why it was rebuilt from the client-side contract instead of
// ported from an original source file.

import legacyHandler from "./_handler";
import { runLegacyHandler } from "../_lib/legacyAdapter";

export async function GET(request: Request) {
  return runLegacyHandler(request, legacyHandler);
}

export async function POST(request: Request) {
  return runLegacyHandler(request, legacyHandler);
}
