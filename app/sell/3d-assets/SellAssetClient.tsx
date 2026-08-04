"use client";

// Client-side form for /sell/3d-assets. Split out of page.tsx so page.tsx
// can be a server component exporting its own generateMetadata — see
// /sell/website/SellWebsiteClient.tsx for the full reasoning.

import { useRouter } from "next/navigation";
import AssetListingForm from "@/components/listing/AssetListingForm";

export default function SellAssetClient() {
  const router = useRouter();
  return <AssetListingForm onBack={() => router.push("/sell")} />;
}
