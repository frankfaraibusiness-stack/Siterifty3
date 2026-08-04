import CheckoutRoute from "@/components/messages/CheckoutRoute";

// Own route for the buyer checkout summary — reached via DealChatPanel's
// "Pay Now" CTA (see DealChatPanel.tsx's handlePay). Same shell pattern as
// ../transfer/page.tsx: a real navigation entry (not a useState flag) so
// the Android back button steps back into the deal chat instead of
// closing it, and so the page survives a refresh/shared link. Private,
// auth-gated content same as the parent /messages/deal/[id] route, so it
// skips SEO/metadata for the same reason.
export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CheckoutRoute chatRoomId={id} />;
}
