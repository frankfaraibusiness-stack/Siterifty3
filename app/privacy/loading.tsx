import StaticPageSkeleton from "@/components/layout/StaticPageSkeleton";

// Next's route-level loading UI — shown while this page (and its server
// metadata/content) loads during navigation. Without this, Next fell
// back to the generic marketplace-shaped app/loading.tsx (SiteriftyLoader),
// which looks nothing like a support/content page. See StaticPageSkeleton
// for the shared shape used by every page built on components/layout/StaticPage.
export default function Loading() {
  return <StaticPageSkeleton />;
}
