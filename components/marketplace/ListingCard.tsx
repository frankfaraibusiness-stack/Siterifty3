import type { Listing } from "@/lib/listings";
import SiteCard from "./SiteCard";
import AppCard from "./AppCard";
import GameCard from "./GameCard";
import AssetCard from "./AssetCard";

interface ListingCardProps {
  listing: Listing;
  onOpen: (listing: Listing) => void;
  onOpenSeller: (ownerId: string | undefined, listing: Listing) => void;
}

// Mirrors mpRenderCard's type dispatch: isApp / isGame / is3d / else-site.
export default function ListingCard({ listing, onOpen, onOpenSeller }: ListingCardProps) {
  const type = listing.type || "website";
  if (type === "app") return <AppCard listing={listing} onOpen={onOpen} onOpenSeller={onOpenSeller} />;
  if (type === "game") return <GameCard listing={listing} onOpen={onOpen} onOpenSeller={onOpenSeller} />;
  if (type === "3d") return <AssetCard listing={listing} onOpen={onOpen} onOpenSeller={onOpenSeller} />;
  return <SiteCard listing={listing} onOpen={onOpen} onOpenSeller={onOpenSeller} />;
}
