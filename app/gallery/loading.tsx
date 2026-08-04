// Next's route-level loading UI for /gallery. Same header shape as
// StaticPageSkeleton (this page doesn't use the StaticPage component
// itself, but hand-rolls the identical back-link/eyebrow/title layout),
// followed by a grid of image placeholders matching the real gallery grid.
export default function Loading() {
  return (
    <div style={{ marginTop: 92, padding: "48px 24px 100px", display: "flex", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 1100 }}>
        <div className="skel-block" style={{ width: 120, height: 14, borderRadius: 6, marginBottom: 28 }} />
        <div className="skel-block" style={{ width: 140, height: 12, borderRadius: 6, marginBottom: 10 }} />
        <div className="skel-block" style={{ width: "60%", height: 34, borderRadius: 8, marginBottom: 36 }} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 20 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skel-block" style={{ aspectRatio: "4/3", borderRadius: 14 }} />
          ))}
        </div>
      </div>
    </div>
  );
}
