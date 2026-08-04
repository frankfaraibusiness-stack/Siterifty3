import { TransferDealModalSkeleton } from "@/components/messages/TransferDealModal";

// Next's route-level loading UI for this segment — the same fix as
// app/messages/deal/[id]/checkout/loading.tsx. Before this file existed,
// /messages/deal/[id]/transfer fell through to app/messages/loading.tsx
// (the generic inbox skeleton) or, worse, briefly showed nothing at all
// while TransferDealRoute's own JS/data resolved. Tapping "Transfer Deal"
// or "Mark Delivered" in the deal chat would look like the tap did
// nothing for a beat before the modal appeared. This renders the exact
// same skeleton TransferDealRoute itself shows while auth/room data is
// still loading, so there's no visible seam between this and real content.
export default function Loading() {
  return <TransferDealModalSkeleton />;
}
