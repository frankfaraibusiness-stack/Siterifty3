import { ImageResponse } from "next/og";
import { getSellerSeoProfile } from "./getSeller";
import { OgCard, OG_SIZE, isRealPhoto } from "@/lib/og/ogCard";

export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const seller = await getSellerSeoProfile(id);

  // Same privacy gate page.tsx's generateMetadata already applies — a
  // private/members profile or a missing seller gets a generic card,
  // never real stats or the real avatar.
  if (!seller || seller.profileVisibility !== "public") {
    return new ImageResponse(<OgCard title="Seller profile" subtitle="Siterifty" />, {
      ...OG_SIZE,
    });
  }

  const stats = [
    {
      label: seller.activeListingCount === 1 ? "listing" : "listings",
      value: String(seller.activeListingCount),
    },
    {
      label: seller.followerCount === 1 ? "follower" : "followers",
      value: String(seller.followerCount),
    },
  ];
  if (seller.ratingCount > 0) {
    stats.push({ label: "rating", value: `${seller.rating.toFixed(1)}/5` });
  }

  const bio = seller.showBio && seller.bio ? seller.bio.trim() : undefined;
  const subtitle = bio && bio.length > 120 ? bio.slice(0, 117) + "…" : bio;

  return new ImageResponse(
    (
      <OgCard
        eyebrow="Seller"
        title={seller.username}
        subtitle={subtitle}
        stats={stats}
        avatarUrl={isRealPhoto(seller.profilePic) ? seller.profilePic : undefined}
      />
    ),
    { ...OG_SIZE }
  );
}
