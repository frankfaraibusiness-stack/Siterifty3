"use client";

// Client-side form for /sell/website. Split out of page.tsx so page.tsx can
// be a server component exporting its own generateMetadata — a "use client"
// page can't export metadata, which is why this route (like its siblings)
// had no SEO of its own until now.

import { useRouter } from "next/navigation";
import WebsiteListingForm from "@/components/listing/WebsiteListingForm";

export default function SellWebsiteClient() {
  const router = useRouter();
  return <WebsiteListingForm onBack={() => router.push("/sell")} />;
}
