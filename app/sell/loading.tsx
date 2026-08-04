// Next's route-level loading UI for /sell (the type-picker screen).
// Matches SellPickerClient's own real top-level shape (minHeight:100vh,
// black bg, paddingTop:92) with a simple card-grid placeholder for the
// 5 listing-type options, instead of the mismatched marketplace-grid
// SiteriftyLoader.
export default function Loading() {
  return (
    <div style={{ minHeight: "100vh", background: "#000", paddingTop: 92, paddingBottom: 80 }}>
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "0 20px" }}>
        <div className="skel-block" style={{ width: 200, height: 26, borderRadius: 8, marginBottom: 28 }} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skel-block" style={{ height: 120, borderRadius: 16 }} />
          ))}
        </div>
      </div>
    </div>
  );
}
