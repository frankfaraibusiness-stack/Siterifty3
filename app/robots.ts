import type { MetadataRoute } from "next";
import { getPublicBaseUrl } from "@/lib/server/adminDb";

// Converted from the static public/robots.txt so the Sitemap: line always
// matches the deployed origin (PUBLIC_BASE_URL / VERCEL_URL) instead of
// being hardcoded to siterifty.com — same rule set, unchanged, just
// generated. A static public/robots.txt and this file can't coexist
// (Next.js build-time conflict), so the static file has been removed.
export default function robots(): MetadataRoute.Robots {
  const baseUrl = getPublicBaseUrl();

  return {
    rules: {
      userAgent: "*",
      allow: [
        "/",
        "/listing/",
        "/seller/",
        "/leaderboard",
        "/marketplace",
        "/blog",
        "/blog/",
        "/about",
        "/contact",
        "/help",
        "/terms",
        "/gallery",
        // Each listing type's form is publicly viewable (only submitting
        // requires auth), so these get their own indexable URLs now that
        // they're real routes instead of a client-state swap on /sell.
        // More specific than the "/sell" disallow below, so this wins.
        "/sell/website",
        "/sell/app",
        "/sell/game",
        "/sell/template",
        "/sell/3d-assets",
      ],
      // Auth-gated app sections — a crawler can't sign in, so these just
      // hit a login wall. No SEO value in indexing them, and disallowing
      // keeps crawl budget on the public pages above. Note /sellers
      // (plural, the browse/directory page) is disallowed while
      // /seller/ (singular, individual profiles) is allowed above —
      // that distinction is intentional, carried over as-is. The bare
      // /sell type-picker stays disallowed (it's just a nav step, not
      // content worth indexing); the typed routes under it are allowed
      // above.
      disallow: ["/settings", "/myprofile", "/profile", "/messages", "/aiagent", "/sell", "/sellers", "/onboarding", "/notifications"],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
