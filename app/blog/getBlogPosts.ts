// Server-only Admin SDK reads for the blog feature.
//
// Mirrors app/listing/[id]/getListing.ts's pattern exactly: direct
// Firestore Admin reads for Server Components, so post content is
// present in the initial HTML response — never fetched client-side —
// which is the whole point for SEO (a crawler that doesn't execute JS,
// or budget-limits JS execution, still sees full text on first load).
import { getAdminDb, serializeTimestamps } from "@/lib/server/adminDb";
import type { BlogPost } from "@/lib/blog";
import { idFromBlogSlug } from "@/lib/blog";

export async function getAllBlogPosts(): Promise<BlogPost[]> {
  const db = getAdminDb();
  const snap = await db.collection("blogPosts").orderBy("createdAt", "desc").get();
  return snap.docs.map((doc) => {
    const data = serializeTimestamps(doc.data()) as Omit<BlogPost, "id">;
    return { id: doc.id, ...data };
  });
}

export async function getBlogPostBySegment(segment: string): Promise<BlogPost | null> {
  if (!segment) return null;
  const id = idFromBlogSlug(segment);
  if (!id) return null;
  const db = getAdminDb();
  const snap = await db.collection("blogPosts").doc(id).get();
  if (!snap.exists) return null;
  const data = serializeTimestamps(snap.data()) as Omit<BlogPost, "id">;
  return { id: snap.id, ...data };
}
