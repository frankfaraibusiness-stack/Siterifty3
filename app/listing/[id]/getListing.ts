// Server-only Admin SDK fetch by listing id.
//
// lib/listings.ts's fetchListingById uses the CLIENT Firebase SDK
// (getDoc against lib/firebase.ts's `db`), which needs browser context and
// can't run in a Server Component. No server-side single-doc read action
// exists in api/listings/_handler.js either — the original SPA never
// needed one, since a listing was always already in memory from the feed
// before mpOpenModal ran. This is genuinely new: a direct-by-id server
// read for the /listing/[id] route's generateMetadata + initial render.
//
// Deliberately colocated with the page rather than added to
// api/listings/_handler.js's action surface — that file is a byte-for-byte
// port of the original api/listings.js and this isn't part of that port.

// Note: the `server-only` npm package would normally guard this file at
// build time, but it isn't in package.json and this sandbox has no network
// access to verify `npm install` succeeds — see adminDb.ts's header comment.
// Relying instead on the fact that this is only ever imported from
// Server Components (page.tsx below, sitemap.ts).
import { getAdminDb, serializeTimestamps } from "@/lib/server/adminDb";
import type { Listing } from "@/lib/listings";
import { idFromListingSlug } from "@/lib/slug";
// @ts-ignore — _handler.js is plain JS, no types; _maybeCloseAuction lazily
// flips an auction listing's status to "ended" (+ fires winner/seller
// notifications) when its endTime has passed but no bid landed after the
// deadline to trigger the same self-heal inline inside listing.bid. The
// detail page is the highest-traffic single-listing read in the app, so
// it's the natural place to catch anything listing.bid's own inline check
// didn't — see that function's header comment in _handler.js.
import { _maybeCloseAuction } from "@/app/api/listings/_handler.js";

// `segment` is the raw /listing/[id] route param — either the new
// "title-slug-{id}" format or a legacy bare id. idFromListingSlug pulls
// the real Firestore id out of either shape; the slug prefix itself is
// never trusted for the lookup (see lib/slug.ts's header comment), only
// used to make the URL readable.
export async function getListingById(segment: string): Promise<Listing | null> {
  if (!segment) return null;
  const id = idFromListingSlug(segment);
  if (!id) return null;
  const db = getAdminDb();
  const snap = await db.collection("listings").doc(id).get();
  if (!snap.exists) return null;
  const data = serializeTimestamps(snap.data()) as Omit<Listing, "id">;
  const closed = await _maybeCloseAuction(db, snap.id, data);
  return { id: snap.id, ...closed };
}
