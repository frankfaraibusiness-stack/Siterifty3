// Next's route-level loading UI for /onboarding. This wizard is a
// deliberate full-screen, no-dismiss takeover (position:fixed, z-index
// 99999, overscroll-behavior:none) — unlike /myprofile or /settings, it's
// intentionally not meant to show the footer or any page chrome behind
// it, so this skeleton matches that same fixed full-bleed shape rather
// than flowing in the page.
export default function Loading() {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 99999, background: "#0a0a0c", display: "flex", alignItems: "stretch", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 500, display: "flex", flexDirection: "column", padding: "20px 24px" }}>
        <div className="skel-block" style={{ height: 4, borderRadius: 2, marginBottom: 8 }} />
        <div className="skel-block" style={{ width: 100, height: 12, borderRadius: 6, marginBottom: 40 }} />
        <div className="skel-block" style={{ width: 64, height: 64, borderRadius: 16, marginBottom: 24, alignSelf: "center" }} />
        <div className="skel-block" style={{ width: "70%", height: 26, borderRadius: 8, marginBottom: 12, alignSelf: "center" }} />
        <div className="skel-block" style={{ width: "90%", height: 14, borderRadius: 6, alignSelf: "center" }} />
      </div>
    </div>
  );
}
