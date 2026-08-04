// Next's route-level loading UI for /leaderboard. LeaderboardClient's
// own "use client" data-fetch already shows lb-skel-row shimmer rows
// once mounted (rows === null branch) — this route-level loading.tsx
// covers the earlier gap during navigation, before that component's own
// JS has mounted at all. Reuses the exact same header + skel-row markup
// so there's no shape change between this and the component's own
// loading state.
export default function Loading() {
  return (
    <div id="lbModal" className="active" style={{ position: "static", display: "block", minHeight: "calc(100vh - 92px)", marginTop: 92 }}>
      <div id="lbModalInner" style={{ maxHeight: "none", height: "auto" }}>
        <div id="lbModalHeader">
          <div id="lbModalHeaderLeft">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a3e635" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 20V10" />
              <path d="M12 20V4" />
              <path d="M6 20v-6" />
            </svg>
            <div>
              <div id="lbModalTitle">Leaderboard</div>
              <div id="lbModalSub">Top sellers, ranked by listings</div>
            </div>
          </div>
        </div>
        <div id="lbModalBody">
          <div id="lbModalList">
            <div id="lbModalLoading">
              <div className="lb-skel-row" />
              <div className="lb-skel-row" />
              <div className="lb-skel-row" />
              <div className="lb-skel-row" />
              <div className="lb-skel-row" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
