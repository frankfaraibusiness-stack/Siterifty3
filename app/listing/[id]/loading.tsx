import ListingDetailSkeleton from "@/components/listing/ListingDetailSkeleton";

// Next's real streaming loading state, shown during the server fetch in
// page.tsx on client-side navigation (e.g. clicking a listing card from
// the marketplace grid). Same skeleton, same visual behavior as the old
// client-fetch page's `!listing` branch — now backed by Next's loading.tsx
// convention instead of a useState/useEffect flag.
export default function Loading() {
  return <ListingDetailSkeleton />;
}
