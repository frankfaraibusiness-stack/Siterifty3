// Next's route-level loading UI for /dashboard. Mirrors SellerDashboard's
// own real shape (sd-header, date-trigger pill, sd-kpi-grid) instead of
// the mismatched marketplace-grid SiteriftyLoader.
export default function Loading() {
  return (
    <div style={{ marginTop: 92, minHeight: "calc(100vh - 92px)", padding: "0 20px 40px", maxWidth: 1160, margin: "92px auto 0" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 0" }}>
        <div className="skel-block" style={{ width: 160, height: 20, borderRadius: 6 }} />
        <div style={{ display: "flex", gap: 8 }}>
          <div className="skel-block" style={{ width: 36, height: 36, borderRadius: "50%" }} />
          <div className="skel-block" style={{ width: 36, height: 36, borderRadius: "50%" }} />
        </div>
      </div>
      <div className="skel-block" style={{ width: 220, height: 44, borderRadius: 12, marginBottom: 20 }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14, marginBottom: 24 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skel-block" style={{ height: 96, borderRadius: 14 }} />
        ))}
      </div>
      <div className="skel-block" style={{ height: 260, borderRadius: 16 }} />
    </div>
  );
}
