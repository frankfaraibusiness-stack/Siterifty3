import SellFormSkeleton from "@/components/listing/SellFormSkeleton";

// Next's route-level loading UI for this listing-type form route. See
// SellFormSkeleton for the shared shape used by all five /sell/* forms.
export default function Loading() {
  return <SellFormSkeleton />;
}
