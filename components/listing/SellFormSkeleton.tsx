// Shared route-level loading skeleton for /sell/app, /sell/game,
// /sell/website, /sell/template, /sell/3d-assets. All five wrap one of
// the *ListingForm components, which share the same marginTop:92,
// black-background, stacked-field layout (see e.g.
// AppListingForm.tsx's own top-level style). One shared shape here
// avoids re-tracing each ~40-60KB form component individually while
// still matching closely enough to avoid a jarring shape change.
export default function SellFormSkeleton() {
  return (
    <div style={{ marginTop: 92, background: "#000", padding: "24px 20px 100px", maxWidth: 640, margin: "92px auto 0" }}>
      <div className="skel-block" style={{ width: 160, height: 24, borderRadius: 8, marginBottom: 24 }} />
      <div className="skel-block" style={{ height: 220, borderRadius: 14, marginBottom: 20 }} />
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} style={{ marginBottom: 18 }}>
          <div className="skel-block" style={{ width: 100, height: 12, borderRadius: 6, marginBottom: 8 }} />
          <div className="skel-block" style={{ height: 44, borderRadius: 10 }} />
        </div>
      ))}
      <div className="skel-block" style={{ height: 48, borderRadius: 12, marginTop: 12 }} />
    </div>
  );
}
