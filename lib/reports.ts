// Client wrapper for the `listing.report` action in
// app/api/listings/_handler.js — that handler already exists and is
// fully functional server-side (rate-limited 5/day per reporter, fixed
// reason list, self-report blocked). This file is just the missing
// client-side piece: a typed fetch wrapper, matching the
// callListingsApi pattern lib/listings.ts already uses for
// listing.feed etc., rather than a second ad-hoc fetch() call site.

export const REPORT_REASONS = [
  { value: "scam", label: "Scam or fraud" },
  { value: "fake-metrics", label: "Fake revenue / traffic metrics" },
  { value: "stolen-content", label: "Stolen or copied content" },
  { value: "prohibited-item", label: "Prohibited item" },
  { value: "misleading", label: "Misleading description" },
  { value: "duplicate", label: "Duplicate listing" },
  { value: "other", label: "Something else" },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]["value"];

interface ApiEnvelopeOk<T> {
  ok: true;
  data: T;
}
interface ApiEnvelopeFail {
  ok: false;
  error: { message: string; code: string };
}
type ApiEnvelope<T> = ApiEnvelopeOk<T> | ApiEnvelopeFail;

export class ReportApiError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

// Reports a listing. idToken is passed in (not read from auth here) to
// match lib/listings.ts's convention — the caller already has the
// signed-in user via useAuth() and calls user.getIdToken() itself,
// same as every other write action in this app (DonateOverlay,
// SellerProfileHeader, WalletModal, etc.).
export async function reportListing(params: {
  idToken: string;
  listingId: string;
  reason: ReportReason;
  details?: string;
}): Promise<{ reportId: string }> {
  const res = await fetch("/api/listings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "listing.report", ...params }),
  });
  const out: ApiEnvelope<{ reportId: string }> = await res.json();
  if (out.ok === false) throw new ReportApiError(out.error.message, out.error.code);
  return out.data;
}
