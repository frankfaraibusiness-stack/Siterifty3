"use client";

// Client-side form for /sell/app. Split out of page.tsx so page.tsx can be
// a server component exporting its own generateMetadata — see
// /sell/website/SellWebsiteClient.tsx for the full reasoning.

import { useRouter } from "next/navigation";
import AppListingForm from "@/components/listing/AppListingForm";

export default function SellAppClient() {
  const router = useRouter();
  return <AppListingForm onBack={() => router.push("/sell")} />;
}
