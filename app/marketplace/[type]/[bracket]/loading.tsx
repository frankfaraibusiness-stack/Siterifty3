import SiteriftyLoader from "@/components/layout/SiteriftyLoader";

// Same fix as app/marketplace/loading.tsx, for the deepest
// /marketplace/[type]/[bracket] price-bracket segment.
export default function Loading() {
  return <SiteriftyLoader />;
}
