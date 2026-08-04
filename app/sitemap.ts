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

export default async function sitemap({ id }: { id: number }): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getPublicBaseUrl();

  // Vercel's build container doesn't have production Firebase env vars
  // populated during `next build`'s static-route pre-rendering pass, so
  // getAdminDb() would throw ("Must initialize with certificate.") before
  // this route is ever actually served. Fall back to just the static URLs
  // in that case instead of crashing the whole build.
  if (!process.env.FIREBASE_PROJECT_ID) {
    if (id === 0) {
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
    return [];
  }

  const db = getAdminDb();

  if (id === 0) {
    const staticEntries: MetadataRoute.Sitemap = [
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

    // Public sellers only — mirrors the same privacy gate used in
    // app/seller/[id]/page.tsx's generateMetadata. A private/members
    // profile must never appear in the sitemap; that would make it more
    // discoverable than the profile owner intended, defeating the point
    // of the visibility setting.
    const sellersSnap = await db
      .collection("users")
      .where("profileVisibility", "==", "public")
      .limit(45000)
      .get();

    const sellerEntries: MetadataRoute.Sitemap = sellersSnap.docs
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

    return [...staticEntries, ...sellerEntries];
  }

  // id === 1 — active listings only, same status gate as the listing
  // page's isPubliclyVisible() and every other active-only query in the
  // app (feed, seller listing grid, etc.).
  if (id === 1) {
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
  }

  // id === 2 — every blog post. No status/visibility gate needed: a
  // post only exists once POST /api/blog has already written it (see
  // that route's admin check), so every doc in this collection is
  // meant to be public the moment it's created.
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
}
