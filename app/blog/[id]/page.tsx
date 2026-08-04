import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getBlogPostBySegment } from "../getBlogPosts";
import { getPublicBaseUrl } from "@/lib/server/adminDb";
import { buildBlogSlug, formatBlogDate } from "@/lib/blog";

function buildDescription(description: string): string {
  const trimmed = description.trim();
  return trimmed.length > 160 ? trimmed.slice(0, 157) + "…" : trimmed;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const post = await getBlogPostBySegment(id);

  if (!post) {
    return {
      title: "Post not found — Siterifty Blog",
      description: "This post may have been removed or the link is incorrect.",
    };
  }

  const title = `${post.title} — Siterifty Blog`;
  const description = buildDescription(post.description);
  const baseUrl = getPublicBaseUrl();
  const url = `${baseUrl}/blog/${buildBlogSlug(post.title, post.id)}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      type: "article",
      publishedTime: post.createdAt,
      images: [{ url: post.coverImage, width: 1200, height: 630, alt: post.title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [post.coverImage],
    },
  };
}

export default async function BlogPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = await getBlogPostBySegment(id);

  if (!post) {
    notFound();
  }

  const canonicalSlug = buildBlogSlug(post.title, post.id);
  if (decodeURIComponent(id) !== canonicalSlug) {
    redirect(`/blog/${canonicalSlug}`);
  }

  return (
    <article className="sr-blog-post">
      <Link href="/blog" className="sr-blog-back">
        ← Blog
      </Link>
      <div className="sr-blog-post-media">
        <img src={post.coverImage} alt={post.title} />
      </div>
      <h1 className="sr-blog-post-title">{post.title}</h1>
      <time className="sr-blog-post-date" dateTime={post.createdAt}>
        {formatBlogDate(post.createdAt)}
      </time>
      <div className="sr-blog-post-body">
        {post.description.split("\n").map((para, i) =>
          para.trim() ? <p key={i}>{para}</p> : null
        )}
      </div>
    </article>
  );
}
