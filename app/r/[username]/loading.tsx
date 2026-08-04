// /r/[username]'s page.tsx now does a real Admin SDK lookup (getReferrer)
// before rendering, instead of an instant redirect() — this skeleton
// shows while that lookup resolves. Mirrors the real card's shape
// (ring + title + button) at low opacity so there's no layout jump when
// the actual content swaps in.
export default function Loading() {
  return (
    <div className="rfp-page">
      <div className="rfp-glow" aria-hidden="true" />
      <div className="rfp-card" style={{ opacity: 0.5 }}>
        <div className="rfp-ring">
          <div className="rfp-avatar" />
        </div>
        <div
          style={{
            width: 160,
            height: 14,
            borderRadius: 7,
            background: "rgba(255,255,255,0.08)",
            marginBottom: 10,
          }}
        />
        <div
          style={{
            width: 220,
            height: 12,
            borderRadius: 6,
            background: "rgba(255,255,255,0.06)",
            marginBottom: 22,
          }}
        />
        <div
          style={{
            width: "100%",
            height: 46,
            borderRadius: 999,
            background: "rgba(163,230,53,0.15)",
          }}
        />
      </div>
    </div>
  );
}
