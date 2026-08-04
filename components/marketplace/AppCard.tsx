"use client";

import { useEffect, useRef } from "react";
import type { Listing } from "@/lib/listings";
import { isBoosted, isPremiumSeller, trackListing } from "@/lib/listings";
import { useCurrency } from "@/lib/CurrencyContext";
import SellerStrip from "./SellerStrip";
import SaveButton from "./SaveButton";
import VerifiedBadge from "./VerifiedBadge";
import AuctionBadge from "./AuctionBadge";

export default function AppCard({
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

  const iconSrc =
    listing.appIcon ||
    listing.images?.[0] ||
    listing.imageCover ||
    `https://placehold.co/128x128/1a1026/a78bfa?text=${encodeURIComponent(title.slice(0, 2))}`;
  const category = listing.category || listing.tech?.frontend || listing.tech?.backend || "App";
  const revenue = typeof fin.revenue === "number" ? formatFinCompact(fin.revenue) : "—";
  const expenses = typeof fin.expenses === "number" ? formatFinCompact(fin.expenses) : "—";
  const profit = typeof fin.profit === "number" ? fin.profit : null;
  const profitStr = profit !== null ? formatFinCompact(Math.abs(profit)) : "—";
  const profitCls = profit !== null ? (profit >= 0 ? "sr-pos" : "sr-neg") : "";
  const desc = (listing.description || listing.tagline || "").trim();
  const shots = (listing.images || []).filter(Boolean).slice(0, 3);

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

  const className = "sr-app" + (isBoosted(listing) ? " sr-boosted" : "") + (isPremiumSeller(listing) ? " sr-premium-shimmer" : "");

  return (
    <div
      ref={cardRef}
      className={className}
      data-type="app"
      onClick={() => onOpen(listing)}
    >
      {isAuction && <AuctionBadge auction={listing.auction!} />}
      <div className="sr-app-head">
        <div className="sr-app-icon">
          <img
            src={iconSrc}
            alt={title}
            loading="lazy"
            onError={(e) => {
              e.currentTarget.src = `https://placehold.co/128x128/1a1026/a78bfa?text=${encodeURIComponent(title.slice(0, 2))}`;
            }}
          />
          <div className="sr-app-platform-row">
            <span className="sr-app-platform-badge sr-badge-ios" title="App Store" aria-label="App Store">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="#fff">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
              </svg>
            </span>
            <span className="sr-app-platform-badge sr-badge-android" title="Google Play" aria-label="Google Play">
              <svg width="13" height="13" viewBox="0 0 512 512">
                <path fill="#00d2ff" d="M47.7 21.4C40 29.6 36 41.2 36 55.9v400.2c0 14.7 4 26.3 11.7 34.5l1.9 1.9L273 268.1v-4.7L49.6 19.5l-1.9 1.9z" />
                <path fill="#00f076" d="M347.5 342.5l-74.9-74.9v-4.7l74.9-74.9 1.7 1L438 234.6c25.6 14.5 25.6 38.3 0 52.9l-89.8 44.9-.7.1z" />
                <path fill="#ff3a44" d="M349.2 341.5L273 265.3 47.7 490.6c8.3 8.7 22 9.8 37.4 1.1l264.1-150.2" />
                <path fill="#ffcf00" d="M349.2 189.1L85.1 38.9c-15.4-8.7-29.1-7.6-37.4 1.1L273 265.3l76.2-76.2z" />
              </svg>
            </span>
            <span className="sr-app-platform-badge sr-badge-web" title="Web App" aria-label="Web App">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 2a14.5 14.5 0 010 20M2 12h20" strokeLinecap="round" />
              </svg>
            </span>
          </div>
        </div>
        <div className="sr-app-head-txt">
          <div className="sr-app-name-row">
            <h3 className="sr-app-name">{title}</h3>
            <VerifiedBadge listing={listing} />
            <span className="sr-app-cat">{category}</span>
          </div>
          {desc ? (
            <p className="sr-app-desc">
              {desc.slice(0, 90)}
              {desc.length > 90 ? "…" : ""}
            </p>
          ) : null}
        </div>
        <div className="sr-app-price" title={isAuction ? undefined : priceTooltip}>
          {isAuction ? auctionPriceStr : price}
        </div>
      </div>
      <div className="sr-app-stats">
        <div className="sr-stat">
          <span className="sr-stat-k">Revenue</span>
          <span className="sr-stat-v">{revenue}</span>
        </div>
        <div className="sr-stat">
          <span className="sr-stat-k">Expenses</span>
          <span className="sr-stat-v sr-neg">{expenses}</span>
        </div>
        <div className="sr-stat">
          <span className="sr-stat-k">Profit</span>
          <span className={`sr-stat-v ${profitCls}`}>{profitStr}</span>
        </div>
      </div>
      {shots.length ? (
        <div className="sr-app-shots">
          {shots.map((src, i) => (
            <img
              key={i}
              src={src}
              alt={`${title} screenshot`}
              loading="lazy"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          ))}
        </div>
      ) : null}
      <div className="sr-app-foot">
        <SellerStrip
          ownerId={listing.ownerId}
          fallbackHandle={sellerHandle}
          onViewSeller={() => onOpenSeller(listing.ownerId, listing)}
        />
        <div className="sr-app-actions">
          <SaveButton listing={listing} />
          <button
            className="sr-pill-btn sr-pill-app"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(listing);
            }}
          >
            {isAuction ? (listing.auction!.status === "ended" ? "View result" : "Place bid") : "View app"}
          </button>
        </div>
      </div>
    </div>
  );
}
