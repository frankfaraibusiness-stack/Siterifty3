"use client";

// Client-side form for /sell/game. Split out of page.tsx so page.tsx can be
// a server component exporting its own generateMetadata — see
// /sell/website/SellWebsiteClient.tsx for the full reasoning.

import { useRouter } from "next/navigation";
import GameListingForm from "@/components/listing/GameListingForm";

export default function SellGameClient() {
  const router = useRouter();
  return <GameListingForm onBack={() => router.push("/sell")} />;
}
