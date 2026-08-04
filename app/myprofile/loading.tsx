// Next's route-level loading UI for /myprofile — covers the navigation
// gap before MyProfileHub's own JS mounts (that component already shows
// pm-skel shimmer blocks once mounted, but only for fields still loading
// from Firestore, not for the initial route transition itself). Reuses
// the same .pm-skel visual language so there's no shape change once the
// real component takes over.
export default function Loading() {
  return (
    <div style={{ minHeight: "100dvh", background: "#050506", display: "flex", flexDirection: "column" }}>
      <div style={{ height: 52, borderBottom: "1px solid rgba(255,255,255,0.08)", flexShrink: 0 }} />
      <div style={{ height: 50, background: "rgba(255,255,255,0.03)", flexShrink: 0 }} />
      <div style={{ padding: "1.75rem 1.5rem 2.5rem", display: "flex", flexDirection: "column", alignItems: "center", gap: "1.5rem" }}>
        <span className="pm-skel pm-skel-avatar" />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          <span className="pm-skel pm-skel-name" />
          <span className="pm-skel pm-skel-handle" />
        </div>
        <div style={{ display: "flex", gap: 8, width: "100%", maxWidth: 440 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="pm-skel" style={{ flex: 1, height: 60, borderRadius: 12 }} />
          ))}
        </div>
      </div>
    </div>
  );
}
