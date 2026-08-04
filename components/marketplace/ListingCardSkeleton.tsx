// Card-shaped shimmer placeholder — same footprint as SiteCard/AppCard/
// GameCard (.sr-site) so it doesn't cause layout shift when the real
// cards swap in. Complements SiteriftyLoader (the full-screen first-paint
// skeleton for a route with zero cached data) rather than replacing it:
// this is for the *in-grid* loading feel — e.g. filling out the preview
// grid, or a brief refetch where a full-screen takeover would feel like
// overkill for content that's already mostly on screen.
//
// Shimmer animation reuses the `.skel` sweep defined in globals.css for
// SiteriftyLoader's own skeleton blocks, so the two loading treatments
// look identical rather than introducing a second shimmer style.
export default function ListingCardSkeleton() {
  return (
    <div className="sr-site sr-site-skeleton" aria-hidden="true">
      <div className="sr-site-media">
        <div className="sr-site-media-main">
          <div className="sr-skel" style={{ width: "100%", height: "100%" }} />
        </div>
        <div className="sr-site-media-sub">
          <div className="sr-site-media-thumb">
            <div className="sr-skel" style={{ width: "100%", height: "100%" }} />
          </div>
          <div className="sr-site-media-thumb">
            <div className="sr-skel" style={{ width: "100%", height: "100%" }} />
          </div>
        </div>
      </div>
      <div className="sr-site-main">
        <div className="sr-site-headline">
          <div className="sr-skel" style={{ height: 18, width: "62%", borderRadius: 6 }} />
          <div className="sr-skel" style={{ height: 18, width: 56, borderRadius: 6 }} />
        </div>
        <div className="sr-skel" style={{ height: 13, width: "94%", borderRadius: 4, marginTop: 10 }} />
        <div className="sr-skel" style={{ height: 13, width: "72%", borderRadius: 4, marginTop: 6 }} />
        <div className="sr-site-stats" style={{ marginTop: 14 }}>
          <div className="sr-stat">
            <div className="sr-skel" style={{ height: 10, width: 44, borderRadius: 4, marginBottom: 6 }} />
            <div className="sr-skel" style={{ height: 14, width: 52, borderRadius: 4 }} />
          </div>
          <div className="sr-stat">
            <div className="sr-skel" style={{ height: 10, width: 44, borderRadius: 4, marginBottom: 6 }} />
            <div className="sr-skel" style={{ height: 14, width: 52, borderRadius: 4 }} />
          </div>
          <div className="sr-stat">
            <div className="sr-skel" style={{ height: 10, width: 44, borderRadius: 4, marginBottom: 6 }} />
            <div className="sr-skel" style={{ height: 14, width: 52, borderRadius: 4 }} />
          </div>
        </div>
        <div className="sr-site-foot" style={{ marginTop: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div className="sr-skel" style={{ height: 30, width: 30, borderRadius: "50%" }} />
            <div className="sr-skel" style={{ height: 12, width: 76, borderRadius: 4 }} />
          </div>
          <div className="sr-skel" style={{ height: 32, width: 88, borderRadius: 999 }} />
        </div>
      </div>
    </div>
  );
}
