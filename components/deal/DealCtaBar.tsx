"use client";

import { useEffect, useState } from "react";
import { useDealPopup } from "@/components/deal/DealPopupProvider";
import type { Listing } from "@/lib/listings";
import { useAuctionTimer } from "@/lib/useAuctionTimer";
import { useCurrency } from "@/lib/CurrencyContext";
import BidModal from "@/components/listing/BidModal";

// Ports the listing modal's bottom CTA bar (#mpModalCtaBar /
// #mpModalDealBtn, index.html lines 1566-1574) onto the standalone
// listing detail page. In the original this bar is part of the shared
// mpOpenModal popup used for all three listing types; since this app
// renders each type as its own routed page instead of a shared modal,
// this is a small standalone component each *ListingBody renders once,
// at the bottom, rather than duplicating the bar's JSX three times.
//
// The original never hides this bar (or otherwise client-side-guards
// against it) for a listing's own owner — mpModalCtaBar's display is
// only ever toggled by mpOpenModal itself, not by an ownerId check —
// so this doesn't add one either. A seller who clicks \"Send Deal\" on
// their own listing gets the server's actual guard (deal.js's
// `sellerUid === buyerUid` check) surfaced as the popup's inline error,
// same as the original.
//
// cta-visible fade-in class is applied one frame after mount, matching
// mpOpenModal's double-rAF timing so the animation fires fresh on
// every listing page load.
//
// Auction listings (listing.saleType === "auction") replace the Send
// Deal button with a live countdown + Place bid button that opens
// BidModal — a deal (fixed-price purchase flow) never applies to an
// auctioned listing, since ownership there transfers to whoever wins
// the auction, not to whoever clicks first.
export default function DealCtaBar({ listing }: { listing: Listing }) {
  const { openDeal } = useDealPopup();
  const [visible, setVisible] = useState(false);
  const [bidOpen, setBidOpen] = useState(false);
  const isAuction = listing.saleType === "auction" && !!listing.auction;
  const { phase, label } = useAuctionTimer(isAuction ? listing.auction : null);
  const { formatBalance } = useCurrency();

  useEffect(() => {
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf2);
    });
    return () => cancelAnimationFrame(raf1);
  }, []);

  if (isAuction) {
    const auction = listing.auction!;
    const highBid = typeof auction.currentBid === "number" ? auction.currentBid : auction.startPrice;
    const ended = phase === "ended";
    return (
      <>
        <div className={`mp-modal-cta-bar${visible ? " cta-visible" : ""}`} style={{ display: "flex" }}>
          <button
            className="mp-modal-cta-deal"
            disabled={phase === "upcoming"}
            onClick={() => setBidOpen(true)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M12 2v20M2 12h20" strokeLinecap="round" />
            </svg>
            {ended
              ? "View result"
              : phase === "upcoming"
              ? `Starts in ${label}`
              : `Bid now — ${formatBalance(highBid)}, ends in ${label}`}
          </button>
        </div>
        {bidOpen && <BidModal listing={listing} onClose={() => setBidOpen(false)} />}
      </>
    );
  }

  return (
    <div className={`mp-modal-cta-bar${visible ? " cta-visible" : ""}`} style={{ display: "flex" }}>
      <button className="mp-modal-cta-deal" onClick={() => openDeal(listing)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Send Deal
      </button>
    </div>
  );
}

