import type { MetadataRoute } from "next";
import { getAdminDb, getPublicBaseUrl } from "@/lib/server/adminDb";
import { buildListingSlug } from "@/lib/slug";
import { buildBlogSlug } from "@/lib/blog";

// Three sitemap "shards" by convention here: id 0 = static top-level
// pages + all public sellers, id 1 = all active listings, id 2 = all
// blog posts. Kept as fixed entries rather than range-splitting each
// collection by count, since none of them are anywhere near the
// 50k-URL-per-file cap yet — but generateSitemaps is what lets this
// grow into real pagination later (e.g. splitting id 1 into
// listings-0/listings-1/...) without a breaking route shape change, so
// it's built this way from the start rather than as a single flat
// sitemap.ts that silently breaks past 50k.
export async function generateSitemaps() {
  return [{ id: 0 }, { id: 1 }, { id: 2 }];
}

function toDate(ts: unknown): Date | undefined {
  if (!ts) return undefined;
  if (typeof (ts as any).toDate === "function") return (ts as any).toDate();
  if (typeof (ts as any).toMillis === "function") return new Date((ts as any).toMillis());
  if (typeof ts === "number") return new Date(ts);
  return undefined;
}

function staticEntries(baseUrl: string): MetadataRoute.Sitemap {
  return [
    { url: `${baseUrl}/`, changeFrequency: "daily", priority: 1 },
    { url: `${baseUrl}/marketplace`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${baseUrl}/blog`, changeFrequency: "daily", priority: 0.6 },
    { url: `${baseUrl}/sellers`, changeFrequency: "daily", priority: 0.6 },
    // Each listing type's form is its own indexable route now (see
    // robots.ts, which allows these explicitly) — belongs in the
    // sitemap alongside the other static pages.
    { url: `${baseUrl}/sell/website`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${baseUrl}/sell/app`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${baseUrl}/sell/game`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${baseUrl}/sell/template`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${baseUrl}/sell/3d-assets`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${baseUrl}/leaderboard`, changeFrequency: "daily", priority: 0.4 },
    { url: `${baseUrl}/gallery`, changeFrequency: "monthly", priority: 0.4 },
  ];
}

export default async function sitemap({ id }: { id: number }): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getPublicBaseUrl();

  // Firestore reads here can fail two different ways at build time, and
  // this guards both:
  //   1. Env vars simply absent (local dev, preview envs without
  //      secrets configured) — the old check below still short-circuits
  //      this case cheaply, without even trying a network call.
  //   2. Env vars present but the credential itself is invalid/expired/
  //      malformed (UNAUTHENTICATED from Google's SDK) — the try/catch
  //      around each actual query below catches this. This is the case
  //      that broke production builds even after the id===0 check
  //      passed the (!process.env.FIREBASE_PROJECT_ID) gate: the var
  //      existed, but auth still failed at request time.
  // Either way, the sitemap degrades to static-only entries (id 0) or an
  // empty shard (id 1, 2) rather than failing the whole `next build`.
  // A sitemap missing some listings/sellers/posts is a minor SEO gap;
  // an unbuildable app is not an acceptable trade to avoid it.
  if (!process.env.FIREBASE_PROJECT_ID) {
    return id === 0 ? staticEntries(baseUrl) : [];
  }

  if (id === 0) {
    let sellerEntries: MetadataRoute.Sitemap = [];
    try {
      const db = getAdminDb();
      // Public sellers only — mirrors the same privacy gate used in
      // app/seller/[id]/page.tsx's generateMetadata. A private/members
      // profile must never appear in the sitemap; that would make it
      // more discoverable than the profile owner intended, defeating
      // the point of the visibility setting.
      const sellersSnap = await db
        .collection("users")
        .where("profileVisibility", "==", "public")
        .limit(45000)
        .get();

      sellerEntries = sellersSnap.docs
        .filter((d) => !!d.data().username)
        .map((d) => {
          const data = d.data();
          return {
            url: `${baseUrl}/seller/${encodeURIComponent(data.username)}`,
            lastModified: toDate(data.updatedAt) || toDate(data.createdAt),
            changeFrequency: "weekly",
            priority: 0.5,
          };
        });
    } catch (err) {
      console.warn("[sitemap] Skipping seller entries — Firestore read failed:", err);
    }

    return [...staticEntries(baseUrl), ...sellerEntries];
  }

  // id === 1 — active listings only, same status gate as the listing
  // page's isPubliclyVisible() and every other active-only query in the
  // app (feed, seller listing grid, etc.).
  if (id === 1) {
    try {
      const db = getAdminDb();
      const listingsSnap = await db.collection("listings").where("status", "==", "active").limit(45000).get();

      return listingsSnap.docs.map((d) => {
        const data = d.data();
        return {
          url: `${baseUrl}/listing/${buildListingSlug(data.title, d.id)}`,
          lastModified: toDate(data.updatedAt) || toDate(data.createdAt),
          changeFrequency: "daily",
          priority: 0.7,
        };
      });
    } catch (err) {
      console.warn("[sitemap] Skipping listing entries — Firestore read failed:", err);
      return [];
    }
  }

  // id === 2 — every blog post. No status/visibility gate needed: a
  // post only exists once POST /api/blog has already written it (see
  // that route's admin check), so every doc in this collection is
  // meant to be public the moment it's created.
  try {
    const db = getAdminDb();
    const blogSnap = await db.collection("blogPosts").limit(45000).get();

    return blogSnap.docs.map((d) => {
      const data = d.data();
      return {
        url: `${baseUrl}/blog/${buildBlogSlug(data.title, d.id)}`,
        lastModified: toDate(data.createdAt),
        changeFrequency: "monthly",
        priority: 0.6,
      };
    });
  } catch (err) {
    console.warn("[sitemap] Skipping blog entries — Firestore read failed:", err);
    return [];
  }
}
