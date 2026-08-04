import SiteriftyLoader from "@/components/layout/SiteriftyLoader";

// Same fix as app/marketplace/loading.tsx, for the /marketplace/[type]
// segment (e.g. /marketplace/apps, /marketplace/websites).
export default function Loading() {
  return <SiteriftyLoader />;
}
