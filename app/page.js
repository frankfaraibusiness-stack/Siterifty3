import Link from "next/link";
import { getSortedPostsData } from "@/lib/posts";

export default function Home() {
  const posts = getSortedPostsData();

  return (
    <main>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {posts.map(({ slug, title, date, excerpt }) => (
          <li key={slug} style={{ marginBottom: "2rem" }}>
            <Link
              href={`/posts/${slug}`}
              style={{
                textDecoration: "none",
                color: "#111",
                fontSize: "1.3rem",
                fontWeight: "600",
              }}
            >
              {title}
            </Link>
            <div style={{ fontSize: "0.85rem", color: "#888", margin: "0.25rem 0" }}>
              {date}
            </div>
            {excerpt && <p style={{ margin: 0 }}>{excerpt}</p>}
          </li>
        ))}
      </ul>
    </main>
  );
}
