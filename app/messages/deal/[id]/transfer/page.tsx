import TransferDealRoute from "@/components/messages/TransferDealRoute";

// Own route for the Transfer Deals flow (checklist, cover screen, item
// panels) — previously only a useState flag inside DealChatPanel, which
// meant no real navigation entry existed for it, so the Android back
// button closed the entire deal chat instead of stepping back into it.
// Private, auth-gated content same as the parent /messages/deal/[id]
// route, so it skips SEO/metadata for the same reason.
export default async function TransferDealPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TransferDealRoute chatRoomId={id} />;
}
