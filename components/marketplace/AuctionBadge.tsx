"use client";

import type { AuctionInfo } from "@/lib/listings";
import { useAuctionTimer } from "@/lib/useAuctionTimer";
import { useCurrency } from "@/lib/CurrencyContext";

// Top-left countdown overlay for auctioned listing cards — stacks under
// the existing type tag (e.g. "Website") rather than replacing it, so
// both the listing type and the auction clock stay visible at once.
//
// Phase → label mapping:
//   upcoming  → counts down to startTime ("Starts in 2h 14m")
//   live      → counts down to endTime ("Ends in 4h 02m") + current bid
//   ended     → "Auction ended" (card should already be re-fetching by
//               this point via useAuctionTimer's phase change upstream)
export default function AuctionBadge({ auction }: { auction: AuctionInfo }) {
  const { phase, label } = useAuctionTimer(auction);
  const { formatFinFull } = useCurrency();

  const highBid = typeof auction.currentBid === "number" ? auction.currentBid : auction.startPrice;
  const bidLabel = auction.bidCount ? formatFinFull(highBid) : formatFinFull(auction.startPrice);

  return (
    <div className="sr-auction-badge" data-phase={phase}>
      <div className="sr-auction-clock">
        {phase === "upcoming" && <>Starts in {label}</>}
        {phase === "live" && <>Ends in {label}</>}
        {phase === "ended" && <>Auction ended</>}
      </div>
      {phase !== "upcoming" && (
        <div className="sr-auction-bid">
          {auction.bidCount ? "Current bid" : "Starting price"} <strong>{bidLabel}</strong>
        </div>
      )}
    </div>
  );
}
