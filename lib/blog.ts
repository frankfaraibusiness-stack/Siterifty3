// Shared types + client fetch helpers for the blog feature.
//
// Storage: Firestore collection `blogPosts`, written only via
// POST /api/blog (server-verifies the caller is admin — see
// app/api/blog/_handler.js). Read directly via the Admin SDK from
// Server Components (app/blog/page.tsx, app/blog/[id]/page.tsx) so
// posts are always present in the initial server-rendered HTML —
// no client fetch/loading-spinner path for the public-facing pages,
// which is what lets Google index full post content on first crawl.
//
// Mirrors lib/listings.ts's pattern of "raw Firestore doc + id" as
// the client-facing shape.

export interface BlogPost {
  id: string;
  title: string;
  description: string;
  coverImage: string;
  createdAt: string; // ISO string — already converted from a Firestore
  // Timestamp by serializeTimestamps() before this ever reaches a
  // Client Component (Admin SDK Timestamps aren't a plain object Next
  // will let you pass across the server/client boundary).
  authorUid?: string;
}

export function slugifyBlogTitle(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

export function buildBlogSlug(title: string, id: string): string {
  const titleSlug = slugifyBlogTitle(title || "");
  return titleSlug ? `${titleSlug}-${id}` : id;
}

export function idFromBlogSlug(segment: string): string {
  const decoded = decodeURIComponent(segment);
  const lastHyphen = decoded.lastIndexOf("-");
  if (lastHyphen === -1) return decoded;
  return decoded.slice(lastHyphen + 1);
}

export function formatBlogDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

// Creates a new post. Caller must be signed in as the admin account —
// the server independently re-verifies this from idToken (see
// app/api/blog/_handler.js actionCreate); a non-admin idToken is
// rejected server-side regardless of what the client believes.
export async function createBlogPost(
  idToken: string,
  data: { title: string; description: string; coverImage: string }
): Promise<BlogPost> {
  const res = await fetch("/api/blog", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ action: "create", ...data }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Failed to publish post");
  return json.post as BlogPost;
}
