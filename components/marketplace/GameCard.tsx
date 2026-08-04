"use client";

import { useEffect, useRef } from "react";
import type { Listing } from "@/lib/listings";
import { isBoosted, isPremiumSeller, trackListing } from "@/lib/listings";
import { useCurrency } from "@/lib/CurrencyContext";
import SellerStrip from "./SellerStrip";
import SaveButton from "./SaveButton";
import VerifiedBadge from "./VerifiedBadge";
import AuctionBadge from "./AuctionBadge";

export default function GameCard({
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
  const { formatPriceShort, formatFinCompact } = useCurrency();
  const price = formatPriceShort(fin.price);
  const priceTooltip = typeof fin.price === "number" ? `$${fin.price.toLocaleString()} USD` : undefined;
  const isAuction = listing.saleType === "auction" && !!listing.auction;
  const auctionHigh = isAuction
    ? (typeof listing.auction!.currentBid === "number" ? listing.auction!.currentBid : listing.auction!.startPrice)
    : null;
  const auctionPriceStr = auctionHigh !== null ? formatPriceShort(auctionHigh) : price;
  const sellerHandle = listing.ownerEmail?.split("@")[0] || "Anonymous";

  const banner =
    listing.images?.[2] ||
    listing.imageCover ||
    listing.images?.[0] ||
    `https://placehold.co/800x450/0a0a0f/f59e0b?text=${encodeURIComponent(title.slice(0, 2))}`;
  const genre = listing.category || listing.tech?.frontend || listing.tech?.backend || "Game";
  const revenue = typeof fin.revenue === "number" ? formatFinCompact(fin.revenue) : "—";
  const expenses = typeof fin.expenses === "number" ? formatFinCompact(fin.expenses) : "—";
  const profit = typeof fin.profit === "number" ? fin.profit : null;
  const profitStr = profit !== null ? formatFinCompact(Math.abs(profit)) : "—";
  const profitCls = profit !== null ? (profit >= 0 ? "sr-pos" : "sr-neg") : "";

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

  const className = "sr-game" + (isBoosted(listing) ? " sr-boosted" : "") + (isPremiumSeller(listing) ? " sr-premium-shimmer" : "");

  return (
    <div
      ref={cardRef}
      className={className}
      data-type="game"
      onClick={() => onOpen(listing)}
    >
      {isAuction && <AuctionBadge auction={listing.auction!} />}
      <div className="sr-game-media">
        <img
          src={banner}
          alt={title}
          loading="lazy"
          onError={(e) => {
            e.currentTarget.src = "https://placehold.co/800x450/0a0a0f/f59e0b?text=Game";
          }}
        />
        <div className="sr-game-badge" aria-label="Game" title="Game">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 12h4M8 10v4" />
            <circle cx="15.5" cy="10.5" r="0.9" fill="currentColor" stroke="none" />
            <circle cx="17.5" cy="13.5" r="0.9" fill="currentColor" stroke="none" />
            <path d="M17 6H7a5 5 0 00-4.9 6.02l.7 3.5A2.5 2.5 0 005.25 17.5c.7 0 1.36-.31 1.8-.86L8.5 15h7l1.45 1.64c.44.55 1.1.86 1.8.86a2.5 2.5 0 002.45-1.98l.7-3.5A5 5 0 0017 6z" />
          </svg>
        </div>
        <button
          type="button"
          className="sr-game-play"
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
        <span className="sr-game-genre">{genre}</span>
      </div>
      <div className="sr-game-bar">
        <div className="sr-game-title-group">
          <h3 className="sr-game-title">{title}</h3>
          <VerifiedBadge listing={listing} />
        </div>
        <span className="sr-game-price" title={isAuction ? undefined : priceTooltip}>
          {isAuction ? auctionPriceStr : price}
        </span>
      </div>
      <div className="sr-game-stats">
        <div className="sr-stat">
          <span className="sr-stat-k">Revenue</span>
          <span className="sr-stat-v">{revenue}</span>
        </div>
        <div className="sr-stat">
          <span className="sr-stat-k">Expenses</span>
          <span className="sr-stat-v">{expenses}</span>
        </div>
        <div className="sr-stat">
          <span className="sr-stat-k">Profit</span>
          <span className={`sr-stat-v ${profitCls}`}>{profitStr}</span>
        </div>
      </div>
      <div className="sr-game-foot">
        <SellerStrip
          ownerId={listing.ownerId}
          fallbackHandle={sellerHandle}
          onViewSeller={() => onOpenSeller(listing.ownerId, listing)}
        />
        <div className="sr-game-actions">
          <SaveButton listing={listing} />
          <button
            className="sr-btn sr-btn-game"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(listing);
            }}
          >
            {isAuction ? (listing.auction!.status === "ended" ? "View result" : "Place bid") : "Play & buy"}
          </button>
        </div>
      </div>
    </div>
  );
}
