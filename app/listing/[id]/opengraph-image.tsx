import { ImageResponse } from "next/og";
import { getListingById } from "./getListing";
import { fmtPrice, type Listing } from "@/lib/listings";
import { OgCard, OG_SIZE, isRealPhoto } from "@/lib/og/ogCard";

export const size = OG_SIZE;
export const contentType = "image/png";

// Same accent-per-type constants as the listing body components
// (WebsiteListingBody/AppListingBody/GameListingBody's own ACCENT), reused
// here so the OG card's accent matches the listing page itself.
const TYPE_ACCENT: Record<string, string> = {
  website: "#60a5fa",
  app: "#a78bfa",
  game: "#f59e0b",
};

const TYPE_LABEL: Record<string, string> = {
  website: "Website",
  app: "App",
  game: "Game",
};

// Same gate page.tsx already uses — a sold/removed/pending listing was
// never publicly linked from the marketplace grid, so it renders a plain
// unavailable card rather than leaking stale data.
function isPubliclyVisible(listing: Listing): boolean {
  return listing.status === "active";
}

function coverPhoto(listing: Listing): string | undefined {
  const candidate = listing.imageCover || listing.images?.[0] || listing.appIcon;
  return isRealPhoto(candidate) ? candidate : undefined;
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const listing = await getListingById(id);

  if (!listing || !isPubliclyVisible(listing)) {
    return new ImageResponse(<OgCard title="Listing unavailable" subtitle="Siterifty" />, {
      ...OG_SIZE,
    });
  }

  const accent = TYPE_ACCENT[listing.type] || "#a3e635";
  const typeLabel = TYPE_LABEL[listing.type] || "Listing";

  const stats = [{ label: "price", value: fmtPrice(listing.financials?.price) }];
  if (typeof listing.financials?.revenue === "number") {
    stats.push({ label: "revenue", value: fmtPrice(listing.financials.revenue) });
  }

  return new ImageResponse(
    (
      <OgCard
        eyebrow={typeLabel}
        title={listing.title || "Listing"}
        subtitle={listing.tagline}
        stats={stats}
        accent={accent}
        photoUrl={coverPhoto(listing)}
      />
    ),
    { ...OG_SIZE }
  );
}
