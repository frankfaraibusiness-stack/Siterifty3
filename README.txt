Blog build-error fix — 2 files only
=====================================
Fixes: "Error occurred prerendering page /blog" / UNAUTHENTICATED at build time.

Extract into your project root, overwriting:
  app/blog/page.tsx
  app/blog/[id]/page.tsx

WHAT CHANGED
------------
Both files now export:
  export const dynamic = "force-dynamic";

WHY
---
Both pages do a real Firestore Admin SDK read (getAllBlogPosts /
getBlogPostBySegment) with no fallback if credentials aren't available.
By default Next.js tries to prerender them at BUILD time (`next build`),
but your build container doesn't reliably have production Firebase env
vars loaded during that step, even though they're set correctly for your
actual deployment — this is the exact same issue your own app/sitemap.ts
already has a comment and guard for ("Vercel's build container doesn't
have production Firebase env vars populated during next build's
static-route pre-rendering pass").

force-dynamic defers the fetch to request time, where credentials are
reliably present, so the build no longer fails. Trade-off: these two pages
are no longer statically prerendered — they render on each request
instead. Not a performance concern for a blog listing/post page.

Verified both files for balanced braces/parens. Run npm run build
yourself to confirm — no node_modules in my environment to do a real
compile check.
