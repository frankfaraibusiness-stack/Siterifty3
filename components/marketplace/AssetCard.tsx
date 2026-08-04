"use client";

import { useEffect, useRef } from "react";
import type { Listing } from "@/lib/listings";
import { isBoosted, isPremiumSeller, trackListing } from "@/lib/listings";
import { useCurrency } from "@/lib/CurrencyContext";
import SellerStrip from "./SellerStrip";
import SaveButton from "./SaveButton";
import VerifiedBadge from "./VerifiedBadge";
import AuctionBadge from "./AuctionBadge";
import AssetIframe from "../listing/AssetIframe";

export default function AssetCard({
  listing,
  onOpen,
  onOpenSeller,
}: {
  listing: Listing;
  onOpen: (listing: Listing) => void;
  onOpenSeller: (ownerId: string | undefined, listing: Listing) => void;
}) {
  const fin = listing.financials || {};
  const title = listing.title || "Untitled";
  const { formatPriceShort } = useCurrency();
  const price = formatPriceShort(fin.price);
  const priceTooltip = typeof fin.price === "number" ? `$${fin.price.toLocaleString()} USD` : undefined;
  const isAuction = listing.saleType === "auction" && !!listing.auction;
  const auctionHigh = isAuction
    ? (typeof listing.auction!.currentBid === "number" ? listing.auction!.currentBid : listing.auction!.startPrice)
    : null;
  const auctionPriceStr = auctionHigh !== null ? formatPriceShort(auctionHigh) : price;
  const sellerHandle = listing.ownerEmail?.split("@")[0] || "Anonymous";

  const category = listing.category || listing.settings?.category || "3D Asset";
  const format = listing.settings?.format || null;
  const license = listing.settings?.license || null;

  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = cardRef.current;
    if (!el || !listing.id || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          io.disconnect();
          trackListing("listing.impression", listing.id);
        }
      },
      { threshold: 0.5 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [listing.id]);

  const className = "sr-3d" + (isBoosted(listing) ? " sr-boosted" : "") + (isPremiumSeller(listing) ? " sr-premium-shimmer" : "");

  return (
    <div ref={cardRef} className={className} data-type="3d" onClick={() => onOpen(listing)}>
      {isAuction && <AuctionBadge auction={listing.auction!} />}
      <div className="sr-3d-media">
        {listing.embedUrl ? (
          // Decorative in the grid — pointer-events: none via
          // interactive={false} so drag-to-orbit doesn't hijack scroll on
          // a card that's meant to preview-and-open, not be the actual
          // viewer. The real interactive viewer is on the detail page.
          <AssetIframe src={listing.embedUrl} title={title} interactive={false} />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(45,212,191,0.35)", fontSize: 12, fontWeight: 700 }}>
            No preview available
          </div>
        )}
        <div className="sr-3d-badge" aria-label="3D Asset" title="3D Asset">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2l8 4.5v11L12 22l-8-4.5v-11L12 2z" />
            <path d="M12 22V12M20 6.5L12 12 4 6.5" />
          </svg>
          <span>3D Asset</span>
        </div>
        <button
          type="button"
          className="sr-3d-play"
          aria-label="Preview"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(listing);
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        </button>
        <span className="sr-3d-category">{category}</span>
      </div>
      <div className="sr-3d-bar">
        <div className="sr-3d-title-group">
          <h3 className="sr-3d-title">{title}</h3>
          <VerifiedBadge listing={listing} />
        </div>
        <span className="sr-3d-price" title={isAuction ? undefined : priceTooltip}>
          {isAuction ? auctionPriceStr : price}
        </span>
      </div>
      <div className="sr-3d-stats">
        <div className="sr-stat">
          <span className="sr-stat-k">Format</span>
          <span className="sr-stat-v">{format || "—"}</span>
        </div>
        <div className="sr-stat">
          <span className="sr-stat-k">License</span>
          <span className="sr-stat-v">{license || "—"}</span>
        </div>
      </div>
      <div className="sr-3d-foot">
        <SellerStrip
          ownerId={listing.ownerId}
          fallbackHandle={sellerHandle}
          onViewSeller={() => onOpenSeller(listing.ownerId, listing)}
        />
        <div className="sr-3d-actions">
          <SaveButton listing={listing} />
          <button
            className="sr-btn sr-btn-3d"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(listing);
            }}
          >
            {isAuction ? (listing.auction!.status === "ended" ? "View result" : "Place bid") : "Preview & buy"}
          </button>
        </div>
      </div>
    </div>
  );
}
