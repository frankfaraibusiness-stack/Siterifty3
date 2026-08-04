// Next's route-level loading UI for /sellers. Since this route is
// "use client" (entirely client-fetched), this covers the gap before its
// own JS bundle mounts and starts rendering its internal CardSkeleton
// state. Reuses the same svm-profile-card svm-skel classes the page's
// own loading branch already uses, so there's no shape change.
export default function Loading() {
  return (
    <div className="svm-feed-container" style={{ marginTop: 92 }}>
      <div className="svm-sticky-header">
        <div className="svm-header">
          <div className="skel-block" style={{ width: 140, height: 20, borderRadius: 6 }} />
        </div>
      </div>
      <div className="svm-profiles-grid">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="svm-profile-card svm-skel">
            <div className="svm-skel-block svm-skel-avatar" />
            <div className="svm-user-info" style={{ gap: 6 }}>
              <div className="svm-skel-block svm-skel-line" />
              <div className="svm-skel-block svm-skel-line sm" />
            </div>
            <div className="svm-skel-block svm-skel-pill" />
          </div>
        ))}
      </div>
    </div>
  );
}
