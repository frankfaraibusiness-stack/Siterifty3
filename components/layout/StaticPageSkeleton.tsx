// Shared route-level loading skeleton for every page built on StaticPage
// (About, Buyer Protection, Escrow & Payments, How It Works, Privacy,
// Terms, plus the split server/client pages Contact and Help). Mirrors
// StaticPage's own markup shape (back-link, eyebrow, title, intro, then
// a stack of sections) using the shared .skel-block shimmer class, so
// there's no visual "pop" from this shape into the real one once content
// arrives — same reasoning as ListingDetailSkeleton / CheckoutRouteSkeleton.
export default function StaticPageSkeleton() {
  return (
    <div
      style={{
        marginTop: 92,
        padding: "48px 24px 100px",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div style={{ width: "100%", maxWidth: 760 }}>
        <div className="skel-block" style={{ width: 120, height: 14, borderRadius: 6, marginBottom: 28 }} />
        <div className="skel-block" style={{ width: 140, height: 12, borderRadius: 6, marginBottom: 10 }} />
        <div className="skel-block" style={{ width: "70%", height: 34, borderRadius: 8, marginBottom: 16 }} />
        <div className="skel-block" style={{ width: "90%", height: 16, borderRadius: 6, marginBottom: 6 }} />
        <div className="skel-block" style={{ width: "60%", height: 16, borderRadius: 6, marginBottom: 36 }} />

        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          {[0, 1, 2].map((i) => (
            <div key={i}>
              <div className="skel-block" style={{ width: 160, height: 19, borderRadius: 6, marginBottom: 10 }} />
              <div className="skel-block" style={{ width: "100%", height: 12, borderRadius: 6, marginBottom: 6 }} />
              <div className="skel-block" style={{ width: "94%", height: 12, borderRadius: 6, marginBottom: 6 }} />
              <div className="skel-block" style={{ width: "80%", height: 12, borderRadius: 6 }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
