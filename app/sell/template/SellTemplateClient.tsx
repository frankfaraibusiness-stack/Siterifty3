"use client";

// Client-side form for /sell/template. Split out of page.tsx so page.tsx
// can be a server component exporting its own generateMetadata — see
// /sell/website/SellWebsiteClient.tsx for the full reasoning.

import { useRouter } from "next/navigation";
import TemplateListingForm from "@/components/listing/TemplateListingForm";

export default function SellTemplateClient() {
  const router = useRouter();
  return <TemplateListingForm onBack={() => router.push("/sell")} />;
}
