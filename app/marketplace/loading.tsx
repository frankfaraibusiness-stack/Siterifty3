import SiteriftyLoader from "@/components/layout/SiteriftyLoader";

// Next's route-level loading UI for the base /marketplace route. The
// existing <Suspense fallback={<SiteriftyLoader />}> inside page.tsx only
// covers the server-side listings fetch once this route's own JS/shell
// has already mounted — it doesn't cover the gap during navigation to
// this route in the first place, which is what left clicks on
// /marketplace showing nothing until the whole page was ready. Reuses
// the same (already correctly marketplace-shaped) loader for both gaps.
export default function Loading() {
  return <SiteriftyLoader />;
}
