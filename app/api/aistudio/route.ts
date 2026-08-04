// Adapter that lets the original api/aistudio.js Vercel function
// (Node-style `handler(req, res)`) run unmodified inside a Next.js App
// Router route handler.
//
// _handler.js is copied byte-for-byte from the old /api/aistudio.js — it
// had no relative imports to repoint (only the firebase-admin package).
// Internal logic (AI Studio chat / support-chat / feedback-widget backing
// actions) is untouched — only this file's job is the request/response
// shape translation, via the shared runLegacyHandler helper.
import legacyHandler from "./_handler";
import { runLegacyHandler } from "../_lib/legacyAdapter";

// Prevents Next.js from trying to statically evaluate/prerender this route
// (and therefore import _handler.js and call admin.firestore()) during
// `next build`'s page-data collection phase. This route only ever makes
// sense as a live request handler.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return runLegacyHandler(request, legacyHandler);
}

export async function POST(request: Request) {
  return runLegacyHandler(request, legacyHandler);
}

export async function OPTIONS(request: Request) {
  return runLegacyHandler(request, legacyHandler);
}
