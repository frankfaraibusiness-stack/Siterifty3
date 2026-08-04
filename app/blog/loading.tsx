// Next's route-level loading UI for /blog. Mirrors .sr-blog-page's own
// real dimensions (max-width 1160px, 92px top padding for the fixed
// header) and .sr-blog-grid's card layout, so there's no shape change
// once real posts load in.
export default function Loading() {
  return (
    <div style={{ maxWidth: 1160, margin: "0 auto", padding: "92px 24px 80px" }}>
      <div style={{ marginBottom: 32 }}>
        <div className="skel-block" style={{ width: 140, height: 32, borderRadius: 8, marginBottom: 8 }} />
        <div className="skel-block" style={{ width: 320, height: 14, borderRadius: 6 }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 24 }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} style={{ borderRadius: 16, overflow: "hidden" }}>
            <div className="skel-block" style={{ height: 160, borderRadius: 0 }} />
            <div style={{ padding: 16 }}>
              <div className="skel-block" style={{ width: "80%", height: 16, borderRadius: 6, marginBottom: 8 }} />
              <div className="skel-block" style={{ width: 100, height: 12, borderRadius: 6 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
