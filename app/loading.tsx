import SiteriftyLoader from "@/components/layout/SiteriftyLoader";

// Next's route-level loading UI — shown automatically while a page (and
// its server-side data) is being fetched during navigation, for any
// route that doesn't define its own more specific loading.tsx (e.g.
// listing/[id]/loading.tsx keeps its own ListingDetailSkeleton, which
// takes precedence there). Covers the "clicking a link/button and seeing
// nothing while the next page fetches" gap everywhere else — Settings,
// Profile, Seller, Sellers, Dashboard, etc.
export default function Loading() {
  return <SiteriftyLoader />;
}
