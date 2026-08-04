import DealChatPanel from "@/components/messages/DealChatPanel";

// Deal chat is private, logged-in-only content (a specific two-party
// escrow conversation) — same reasoning as /dashboard and /settings
// having no metadata export, so this route skips SEO too.
export default async function MessagesDealPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DealChatPanel chatRoomId={id} />;
}
