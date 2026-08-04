import Link from "next/link";
import { getAllSlugs, getPostData } from "@/lib/posts";

export async function generateStaticParams() {
  return getAllSlugs();
}

export default async function Post({ params }) {
  const post = await getPostData(params.slug);

  return (
    <article>
      <Link href="/" style={{ color: "#666", fontSize: "0.9rem" }}>
        ← Back
      </Link>
      <h1 style={{ marginBottom: "0.25rem" }}>{post.title}</h1>
      <div style={{ fontSize: "0.85rem", color: "#888", marginBottom: "1.5rem" }}>
        {post.date}
      </div>
      <div dangerouslySetInnerHTML={{ __html: post.contentHtml }} />
    </article>
  );
}
