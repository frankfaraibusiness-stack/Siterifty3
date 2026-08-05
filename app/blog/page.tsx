import type { Metadata } from "next";
import Link from "next/link";
import { getAllBlogPosts } from "./getBlogPosts";
import { getPublicBaseUrl } from "@/lib/server/adminDb";
import { buildBlogSlug, formatBlogDate } from "@/lib/blog";
import AddBlogButton from "@/components/blog/AddBlogButton";

// Forces this page to render on each request instead of being prerendered
// at build time. getAllBlogPosts() below does a real Firestore Admin SDK
// read — at build time (next build), that read runs before the app is
// actually deployed/running, in an environment where Admin credentials
// may not be loaded the same way they are at runtime (env var scoping
// differs between build and runtime on some hosts). Without this, a
// missing/misconfigured credential at build time fails the entire build
// with an UNAUTHENTICATED error on this page, even though the same
// credentials work fine once the app is actually serving requests.
// "force-dynamic" defers the fetch to request time, where credentials are
// reliably available, at the cost of this page no longer being static
// (it's re-fetched on every visit rather than served from a prerendered
// HTML file — acceptable here since blog content changes over time and
// isn't performance-critical enough to need static generation).
export const dynamic = "force-dynamic";

// Targets the exact niche this app serves — small developers buying and
// selling apps, games, websites, and 3D assets — so the page's own
// title/description carry keywords distinct from (and complementary to)
// /marketplace's, rather than competing with it for the same terms.
const PAGE_TITLE = "Blog — Buy & Sell Apps, Games, Websites and 3D Assets | Siterifty";
const PAGE_DESCRIPTION =
  "Guides, stories, and updates for indie developers buying and selling apps, games, websites, and 3D assets on Siterifty.";

export async function generateMetadata(): Promise<Metadata> {
  const baseUrl = getPublicBaseUrl();
  const url = `${baseUrl}/blog`;
  return {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    alternates: { canonical: url },
    openGraph: {
      title: PAGE_TITLE,
      description: PAGE_DESCRIPTION,
      url,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: PAGE_TITLE,
      description: PAGE_DESCRIPTION,
    },
  };
}

export default async function BlogPage() {
  const posts = await getAllBlogPosts();

  return (
    <div className="sr-blog-page">
      <div className="sr-blog-header">
        <div>
          <h1 className="sr-blog-h1">Blog</h1>
          <p className="sr-blog-sub">Guides and updates for developers buying and selling on Siterifty.</p>
        </div>
        <AddBlogButton />
      </div>

      {posts.length === 0 ? (
        <div className="sr-blog-empty">No posts yet.</div>
      ) : (
        <div className="sr-blog-grid">
          {posts.map((post) => (
            <Link key={post.id} href={`/blog/${buildBlogSlug(post.title, post.id)}`} className="sr-blog-card">
              <div className="sr-blog-card-media">
                <img src={post.coverImage} alt={post.title} loading="lazy" />
              </div>
              <div className="sr-blog-card-body">
                <h2 className="sr-blog-card-title">{post.title}</h2>
                <time className="sr-blog-card-date" dateTime={post.createdAt}>
                  {formatBlogDate(post.createdAt)}
                </time>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
