// Next's route-level loading UI for /settings. The page already has its
// own <Suspense fallback={<SiteriftyLoader/>}> for the useSearchParams
// gate, but that only covers rendering once this route's JS has already
// mounted — not the server-navigation gap beforehand. Mirrors the real
// sidebar + detail-panel two-column shape instead of the mismatched
// marketplace-grid SiteriftyLoader.
export default function Loading() {
  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", background: "var(--mp-bg, #050508)" }}>
      <div
        style={{
          height: 52,
          borderBottom: "1px solid #1a1a1a",
          display: "flex",
          alignItems: "center",
          padding: "0 1.5rem",
          gap: 12,
          flexShrink: 0,
        }}
      >
        <div className="skel-block" style={{ width: 100, height: 16, borderRadius: 6 }} />
      </div>
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <div style={{ width: 220, borderRight: "1px solid #1a1a1a", padding: "1.2rem 0.8rem", flexShrink: 0 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skel-block" style={{ height: 38, borderRadius: 9, marginBottom: 8 }} />
          ))}
        </div>
        <div style={{ flex: 1, padding: "1.8rem 2rem" }}>
          <div className="skel-block" style={{ width: 160, height: 22, borderRadius: 7, marginBottom: 20 }} />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skel-block" style={{ height: 44, borderRadius: 10, marginBottom: 10 }} />
          ))}
        </div>
      </div>
    </div>
  );
}
