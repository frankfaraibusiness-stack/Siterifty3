"use client";

import type { Listing } from "@/lib/listings";
import DescriptionBlock from "./DescriptionBlock";
import FinancialsBlock from "./FinancialsBlock";
import SellerBlock from "./SellerBlock";
import DealCtaBar from "@/components/deal/DealCtaBar";
import { useCurrency } from "@/lib/CurrencyContext";
import ShareButton from "@/components/listing/ShareButton";
import VerifiedBadge from "@/components/marketplace/VerifiedBadge";
import AssetIframe from "@/components/listing/AssetIframe";
import { listingShareUrl } from "@/lib/share";

// The detail-page body for type === '3d' listings — same section layout
// convention as Website/App/Game (hero → title/description → type-specific
// details → financials → seller), but built from scratch since 3D assets
// never had one (see app/listing/[id]/page.tsx, which fell through to the
// generic "unrecognized type" fallback for '3d' until now).
//
// Two structural differences from the other three types, both intentional
// (mirrors AssetListingForm.tsx's own header comment):
//   1. No image gallery — the hero *is* the live embed (AssetIframe,
//      interactive=true here, unlike the decorative one on the grid card).
//   2. No TransferMethodsBlock/AttachedRepoBlock — a 3D asset changes hands
//      as a file/link handoff after purchase, not a domain/account/repo
//      transfer, so neither block has anything meaningful to show.
const ACCENT = "#2dd4bf"; // matches --sr-3d / AssetListingForm's ACCENT

export default function AssetListingBody({ listing }: { listing: Listing }) {
  const title = listing.title || "Untitled";
  const { formatPriceShort } = useCurrency();
  const priceStr = typeof listing.financials?.price === "number" ? formatPriceShort(listing.financials.price) : "—";
  const priceTooltip = typeof listing.financials?.price === "number" ? `$${listing.financials.price.toLocaleString()} USD` : undefined;

  const category = listing.category || listing.settings?.category || "";
  const format = listing.settings?.format || "";
  const license = listing.settings?.license || "";
  const embedUrl = listing.embedUrl || "";

  return (
    <>
      <div className="modal-hero">
        {embedUrl ? (
          <AssetIframe src={embedUrl} title={title} interactive className="modal-cover" />
        ) : (
          <div
            className="modal-cover"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "#111318", color: "rgba(45,212,191,0.35)", fontSize: 13, fontWeight: 700 }}
          >
            No preview available
          </div>
        )}
        <div className="modal-hero-overlay" style={{ pointerEvents: "none" }}>
          <div className="modal-hero-top-row" style={{ pointerEvents: "auto" }}>
            <span
              className="modal-type-badge"
              style={{
                background: "rgba(10,10,12,0.86)",
                color: ACCENT,
                border: `1px solid ${ACCENT}`,
                boxShadow: "0 2px 10px rgba(0,0,0,0.4)",
              }}
            >
              3D Asset
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="modal-price-badge" title={priceTooltip}>{priceStr}</span>
              <ShareButton url={listingShareUrl(listing.id, title)} title={title} accentColor={ACCENT} />
            </div>
          </div>
          <div className="modal-hero-bottom-row" style={{ pointerEvents: "auto" }}>
            <div className="modal-hero-title-block">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h2 className="modal-hero-title">{title}</h2>
                <VerifiedBadge listing={listing} />
              </div>
              <div className="modal-hero-pills">
                {category ? <span className="modal-hero-pill">{category}</span> : null}
                {format ? <span className="modal-hero-pill">{format}</span> : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="modal-content">
        <div className="modal-section modal-game-title-section">
          <DescriptionBlock description={listing.description} />
        </div>

        <div className="modal-section">
          <div className="modal-section-title with-icon modal-game-section-title">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2l8 4.5v11L12 22l-8-4.5v-11L12 2z" />
              <path d="M12 22V12M20 6.5L12 12 4 6.5" />
            </svg>
            Asset Details
          </div>
          <div className="modal-settings-grid">
            {category ? (
              <div className="setting-item">
                <span>Category</span>
                <span>{category}</span>
              </div>
            ) : null}
            {format ? (
              <div className="setting-item">
                <span>Format</span>
                <span>{format}</span>
              </div>
            ) : null}
            {license ? (
              <div className="setting-item">
                <span>License</span>
                <span>{license}</span>
              </div>
            ) : null}
          </div>
        </div>

        <FinancialsBlock listing={listing} accentColor={ACCENT} />
        <SellerBlock listing={listing} accentColor={ACCENT} />
      </div>
      <DealCtaBar listing={listing} />
    </>
  );
}
