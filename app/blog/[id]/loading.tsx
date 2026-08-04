// Next's route-level loading UI for /blog/[id]. Mirrors .sr-blog-post's
// own real dimensions (max-width 760px, 92px top margin, 16:9 media,
// title + date + body paragraphs).
export default function Loading() {
  return (
    <div style={{ maxWidth: 760, margin: "92px auto 0", padding: "0 24px 80px" }}>
      <div className="skel-block" style={{ width: 90, height: 13, borderRadius: 6, marginBottom: 20 }} />
      <div className="skel-block" style={{ aspectRatio: "16/9", width: "100%", borderRadius: 16, marginBottom: 24 }} />
      <div className="skel-block" style={{ width: "70%", height: 28, borderRadius: 8, marginBottom: 10 }} />
      <div className="skel-block" style={{ width: 120, height: 12, borderRadius: 6, marginBottom: 28 }} />
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="skel-block"
          style={{ width: i % 3 === 2 ? "70%" : "96%", height: 13, borderRadius: 6, marginBottom: 10 }}
        />
      ))}
    </div>
  );
}
