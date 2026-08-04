// Shared slug helpers for pretty, collision-free listing URLs.
//
// Format: /listing/{slugified-title}-{realFirestoreId}
// e.g.    /listing/vintage-desk-chair-XaNrxIipmZt8dRQwuVuo
//
// The real Firestore document ID is always kept intact as the LAST
// segment (after the final hyphen run produced by slugify — see
// idFromListingSlug below), so:
//   - No new uniqueness scheme is needed. Two listings titled "Vintage
//     Desk Chair" simply get two different URLs because their IDs
//     differ; there's no lookup table to keep in sync and no write-time
//     collision check required.
//   - Old bare-ID links (/listing/XaNrxIipmZt8dRQwuVuo) issued before
//     this change keep working with zero migration, since a bare ID is
//     just the degenerate case of this same format (no slug prefix).
//   - The title portion is purely decorative for humans/SEO; the app
//     never trusts it and always re-derives the canonical URL from the
//     listing's actual title + id (see buildListingSlug), so a stale or
//     tampered slug prefix in a shared link never causes a wrong listing
//     to load.
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

// Builds the canonical slug URL segment for a listing. Falls back to the
// bare id if the title slugifies to nothing (e.g. a title that's only
// emoji/symbols) so the segment is never just a dangling hyphen.
export function buildListingSlug(title: string | undefined, id: string): string {
  const titleSlug = slugify(title || "");
  return titleSlug ? `${titleSlug}-${id}` : id;
}

// Extracts the real Firestore ID from a URL segment that may be either
// the new "slug-id" format or a legacy bare id. Firestore auto-IDs and
// the app's own generated ids never contain a hyphen, so the id is
// always exactly the substring after the LAST hyphen — or the whole
// segment if there's no hyphen at all (legacy links, or a slug that
// happened to fully strip away).
export function idFromListingSlug(segment: string): string {
  const decoded = decodeURIComponent(segment);
  const lastHyphen = decoded.lastIndexOf("-");
  if (lastHyphen === -1) return decoded;
  return decoded.slice(lastHyphen + 1);
}
