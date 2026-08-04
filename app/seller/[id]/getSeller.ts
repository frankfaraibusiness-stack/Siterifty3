// Server-only Admin SDK fetch of a seller's SEO-relevant profile fields.
//
// Deliberately NOT a server port of lib/useSeller.ts's fetchFullSeller —
// that pulls the seller's full listings array, follower count, and a
// second network call for deal stats, all client-side data the page body
// still fetches itself on mount (see page.tsx below). This helper only
// reads what generateMetadata needs: username/bio/rating/plan/visibility
// and a cheap listing count. Keeping it separate avoids duplicating a
// heavier Admin-SDK version of fetchFullSeller that would drift from the
// client one over time.
//
// PRIVACY: profileVisibility gates what generateMetadata is allowed to
// expose to crawlers/link-preview bots, mirroring the same gate the
// client page already enforces for human visitors (see page.tsx's
// "private"/"members" branches). A private profile must never leak its
// real bio, stats, or listing count into a <meta> tag just because a
// crawler doesn't go through the client visibility check.

import { getAdminDb } from "@/lib/server/adminDb";
import type { FullSeller, SellerListing } from "@/lib/useSeller";

// Admin SDK document fields that are Firestore Timestamps come back as
// Timestamp *class instances* (methods like .toDate()/.toMillis(), not a
// plain object) — Next.js refuses to serialize those across the
// server->client boundary ("Only plain objects... Classes or null
// prototypes are not supported"). Every consumer downstream (isBoosted,
// useSeller's sort, SellerListing cards) already accepts a plain
// millisecond number for these fields, so this walks a raw listing doc
// and converts any Timestamp-shaped value to `.toMillis()` before it's
// ever returned from this server-only module.
function serializeTimestamps<T extends Record<string, any>>(obj: T): T {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value && typeof value === "object" && typeof value.toMillis === "function") {
      out[key] = value.toMillis();
    } else if (Array.isArray(value)) {
      out[key] = value.map((v) => (v && typeof v === "object" && typeof v.toMillis === "function" ? v.toMillis() : v));
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

export interface SellerSeoProfile {
  uid: string;
  username: string;
  bio: string;
  profilePic: string;
  rating: number;
  ratingCount: number;
  plan: string;
  profileVisibility: string;
  showBio: boolean;
  activeListingCount: number;
  followerCount: number;
  joinedAt: Date | null;
}

// `segment` is the raw /seller/[id] route param. It's resolved as:
//   1. A direct doc-id (uid) lookup first — cheap, and keeps every old
//      /seller/{uid} link issued before usernames became the canonical
//      route shape working forever with no redirect table to maintain.
//   2. If that misses, treated as a username and resolved via the same
//      usernameLower uniqueness index the signup flow already
//      maintains (see app/api/account/_handler.js's resolveUniqueUsername),
//      so the common case — someone visiting the canonical
//      /seller/{username} URL — costs one indexed query.
// Firestore auto-ids and usernames can never collide in practice (ids are
// long random base62 strings; usernames are capped short human text), so
// there's no ambiguity between the two lookup paths.
export async function getSellerSeoProfile(segment: string): Promise<SellerSeoProfile | null> {
  if (!segment) return null;
  const db = getAdminDb();

  let snap = await db.collection("users").doc(segment).get();
  if (!snap.exists) {
    const lower = segment.toLowerCase();
    const q = await db.collection("users").where("usernameLower", "==", lower).limit(1).get();
    if (q.empty) return null;
    snap = q.docs[0];
  }
  const uid = snap.id;
  // At this point snap is guaranteed to exist (either the direct doc-id
  // lookup above hit, or the usernameLower query returned a real doc) —
  // `d` is never the fallback `{}` a deleted/non-existent seller would
  // produce, so username/etc. below never need an "Anonymous" fallback
  // for a missing account. Kept as `|| {}` only as a defensive guard
  // against a doc existing with no data at all, not a stand-in for a
  // missing seller.
  const d = snap.data() || {};

  // Cheap count-only query — mirrors the `active` status filter used
  // everywhere else (listings/_handler.js's feed query, useSeller.ts's
  // fetchFullSeller) — never fetches the actual listing docs, since
  // metadata only needs a number, not the listings themselves.
  let activeListingCount = 0;
  try {
    const countSnap = await db
      .collection("listings")
      .where("ownerId", "==", uid)
      .where("status", "==", "active")
      .count()
      .get();
    activeListingCount = countSnap.data().count;
  } catch (err) {
    console.error("[getSellerSeoProfile] listing count failed for", uid, err);
  }

  // Same `users/{uid}/followers` subcollection the client-side hook reads
  // (lib/useSeller.ts's fetchFullSeller), but via the Admin SDK's count()
  // aggregation rather than fetching every follower doc — metadata only
  // needs a number.
  let followerCount = 0;
  try {
    const followerSnap = await db.collection("users").doc(uid).collection("followers").count().get();
    followerCount = followerSnap.data().count;
  } catch (err) {
    console.error("[getSellerSeoProfile] follower count failed for", uid, err);
  }

  // Same defensive Timestamp-or-plain-value handling fetchFullSeller uses
  // for createdAt (Admin SDK Timestamps carry .toDate(); older/migrated
  // docs may have a plain value instead).
  const joinedAt: Date | null = d.createdAt
    ? d.createdAt.toDate
      ? d.createdAt.toDate()
      : new Date(d.createdAt)
    : null;

  return {
    uid,
    username: d.username || d.displayName || d.email?.split("@")[0] || "Anonymous",
    bio: d.bio || "",
    profilePic: d.profilePic || "",
    rating: typeof d.rating === "number" ? d.rating : 0,
    ratingCount: typeof d.ratingCount === "number" ? d.ratingCount : 0,
    plan: d.plan || "free",
    profileVisibility: d.profileVisibility || "public",
    showBio: d.showBio !== false,
    activeListingCount,
    followerCount,
    joinedAt,
  };
}

// ═══════════════════════════════════════════════════════════════════
// FULL SELLER PROFILE (server-side) — Admin SDK mirror of
// lib/useSeller.ts's fetchFullSeller, used so the actual page body
// (bio, listings grid, rating, avatar) is present in the server-rendered
// HTML for SEO/crawlers, not only fetched client-side after mount.
//
// Deliberately kept as its own function rather than replacing
// getSellerSeoProfile above: that one is cheap (two count() aggregations,
// no listing docs) and is all generateMetadata needs. This one fetches
// the actual listing docs (capped 20, mirroring fetchFullSeller) because
// the page body needs to render seller listing cards, not just a count.
// Both stay in sync manually since they read the same user doc shape —
// same tradeoff already accepted for getSellerSeoProfile vs
// fetchFullSeller per the file-level comment above.
//
// PRIVACY: same profileVisibility/showBio/showEmail/showSocial gates as
// generateMetadata and the client page's own visibility checks. A
// private or followers-only ("members") profile must never have its real bio/listings/
// contact fields land in server-rendered HTML for a signed-out crawler —
// this returns a minimal, already-gated shape, not the raw doc, so
// SellerProfileClient can render it directly without re-deriving the
// privacy rules a second time.
// ═══════════════════════════════════════════════════════════════════

export async function getSellerFullProfile(segment: string): Promise<FullSeller | null> {
  if (!segment) return null;
  const db = getAdminDb();

  let snap = await db.collection("users").doc(segment).get();
  if (!snap.exists) {
    const lower = segment.toLowerCase();
    const q = await db.collection("users").where("usernameLower", "==", lower).limit(1).get();
    if (q.empty) return null;
    snap = q.docs[0];
  }
  const uid = snap.id;
  const d = snap.data() || {};

  let sellerListings: SellerListing[] = [];
  try {
    const lq = await db
      .collection("listings")
      .where("ownerId", "==", uid)
      .where("status", "==", "active")
      .limit(40)
      .get();
    lq.forEach((ld) => sellerListings.push(serializeTimestamps({ id: ld.id, ...(ld.data() as any) })));
    sellerListings.sort((a: any, b: any) => {
      const toMillis = (v: any) => (v?.toDate ? v.toDate().getTime() : v ? new Date(v).getTime() : 0);
      return toMillis(b.createdAt) - toMillis(a.createdAt);
    });
    sellerListings = sellerListings.slice(0, 20);
  } catch (err) {
    console.error("[getSellerFullProfile] failed to load seller listings for", uid, err);
  }

  let followerCount = 0;
  try {
    const followerSnap = await db.collection("users").doc(uid).collection("followers").count().get();
    followerCount = followerSnap.data().count;
  } catch (err) {
    console.error("[getSellerFullProfile] follower count failed for", uid, err);
  }

  // Same field the client's fetchFullSeller reads first, same fallback
  // to a get-seller-stats-style aggregation for sellers who predate it —
  // done here via a direct Admin-SDK query against the same
  // users/{uid}/deals subcollection app/api/deal/_handler.js's
  // handleGetSellerStats reads (status === 'complete'), instead of a
  // server component calling its own app's API route over HTTP.
  let dealsCompleted = typeof d.dealsCompleted === "number" ? d.dealsCompleted : null;
  if (dealsCompleted === null) {
    try {
      const dealsSnap = await db.collection("users").doc(uid).collection("deals").where("status", "==", "complete").count().get();
      dealsCompleted = dealsSnap.data().count;
    } catch (err) {
      console.error("[getSellerFullProfile] deals-completed count failed for", uid, err);
      dealsCompleted = 0;
    }
  }

  const joinedAt: Date | null = d.createdAt
    ? d.createdAt.toDate
      ? d.createdAt.toDate()
      : new Date(d.createdAt)
    : null;

  const profileVisibility = d.profileVisibility || "public";
  const showBio = d.showBio !== false;
  const showEmail = d.showEmail === true;
  const showSocial = d.showSocial !== false;

  // Gate at the source: a private/members profile's bio and contact
  // fields never enter the returned object at all for a signed-out
  // render, rather than relying on every consumer to re-check
  // profileVisibility before displaying them. isOwnProfile/signed-in
  // "members" access still works normally — that re-fetches fresh via
  // fetchFullSeller client-side once auth state is known (see
  // SellerProfileClient), same as it always has; this server-rendered
  // version is only ever the signed-out-safe baseline.
  const isPubliclyVisible = profileVisibility === "public";

  return {
    uid,
    username: d.username || d.displayName || d.email?.split("@")[0] || "Anonymous",
    profilePic: d.profilePic || "",
    plan: d.plan || "free",
    rating: typeof d.rating === "number" ? d.rating : 0,
    ratingCount: typeof d.ratingCount === "number" ? d.ratingCount : 0,
    bio: isPubliclyVisible && showBio ? d.bio || "" : "",
    contactEmail: isPubliclyVisible && showEmail ? d.contactEmail || "" : "",
    website: isPubliclyVisible && showSocial ? d.website || d.websiteUrl || "" : "",
    twitter: isPubliclyVisible && showSocial ? d.twitter || d.twitterUrl || "" : "",
    github: isPubliclyVisible && showSocial ? d.github || d.githubUrl || "" : "",
    linkedin: isPubliclyVisible && showSocial ? d.linkedin || d.linkedinUrl || "" : "",
    joinedAt,
    listings: isPubliclyVisible ? sellerListings : [],
    followerCount,
    dealsCompleted: dealsCompleted || 0,
    profileVisibility,
    showEmail,
    showBio,
    showSocial,
  };
}
