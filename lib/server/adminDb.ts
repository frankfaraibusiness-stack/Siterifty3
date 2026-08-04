// Server-only Firebase Admin Firestore singleton.
//
// The app/api/_lib/*.js request handlers each keep their own copy of this
// same getAdminDb() boilerplate on purpose (see listings/_handler.js's
// top-of-file comment — those files are a deliberately byte-for-byte port
// of the original serverless functions, kept independent of each other).
//
// This file is NOT part of that port. It's new plumbing for Server
// Components (generateMetadata, sitemap.ts) that need a direct Admin
// Firestore read outside the POST /api/* action-handler pattern. Rather
// than reach into listings/_handler.js (internal to that route) or
// duplicate the init block a third/fourth time, every new server-only
// caller shares this one copy.
//
// Must only ever be imported from Server Components, generateMetadata,
// route handlers, or other server-only files — never from a "use client"
// file (firebase-admin will not run in the browser).

import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

export function getAdminDb(): Firestore {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
    });
  }
  return getFirestore();
}

// Resolves the deployed origin for canonical URLs, OG tags, and the
// sitemap — same fallback chain already used server-side in
// listings/_handler.js's triggerAiCheck (PUBLIC_BASE_URL first, then
// Vercel's auto-populated VERCEL_URL), with a hardcoded production
// fallback so metadata never accidentally ships with a localhost URL.
export function getPublicBaseUrl(): string {
  return (
    process.env.PUBLIC_BASE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
    "https://siterifty.com"
  );
}

// Admin SDK Firestore Timestamps are class instances (Timestamp.prototype),
// not plain objects — Next.js refuses to pass those from a Server
// Component to a Client Component ("Only plain objects... can be passed").
// This walks a value and converts any Timestamp-shaped value (has both
// .toDate and .toMillis) to a plain ISO string, recursively, so no matter
// which field holds one it's always safe to serialize. Arrays and nested
// objects are walked too since a Timestamp could in principle live inside
// any of them.
//
// Extracted here from app/listing/[id]/getListing.ts, which originally
// kept this private to itself — now shared, since the SSR marketplace
// search page (app/marketplace/searchListings.ts) needs the exact same
// conversion for the listing docs handleSearch returns straight from the
// Admin SDK.
export function serializeTimestamps<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (
    typeof value === "object" &&
    typeof (value as any).toDate === "function" &&
    typeof (value as any).toMillis === "function"
  ) {
    return (value as any).toDate().toISOString() as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => serializeTimestamps(v)) as unknown as T;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = serializeTimestamps(v);
    }
    return out as T;
  }
  return value;
}
