"use client";

import type { Listing } from "@/lib/listings";
import DescriptionBlock from "./DescriptionBlock";
import FinancialsBlock from "./FinancialsBlock";
import { useCurrency } from "@/lib/CurrencyContext";
import SellerBlock from "./SellerBlock";
import TransferMethodsBlock from "./TransferMethodsBlock";
import AttachedRepoBlock from "./AttachedRepoBlock";
import DealCtaBar from "@/components/deal/DealCtaBar";
import { useAdGatedPreview } from "@/lib/useAdGatedPreview";
import ShareButton from "@/components/listing/ShareButton";
import VerifiedBadge from "@/components/marketplace/VerifiedBadge";
import { listingShareUrl } from "@/lib/share";

// Ports the `type === 'website'` branch of mpOpenModal (marketplace.js,
// ~line 1774) 1:1 — same accent color, same hero/gallery layout, same
// section order: description+url row → tech stack → financials →
// business details → attached repo → transfer methods → seller.
const ACCENT = "#60a5fa"; // matches `tc` for type==='website' in the original

export default function WebsiteListingBody({ listing }: { listing: Listing }) {
  const title = listing.title || "Untitled";
  const isTemplate = listing.isTemplate || false;
  const { formatPriceShort } = useCurrency();
  const priceStr = typeof listing.financials?.price === "number" ? formatPriceShort(listing.financials.price) : "—";
  const priceTooltip = typeof listing.financials?.price === "number" ? `$${listing.financials.price.toLocaleString()} USD` : undefined;
  const cover = listing.images?.[2] || listing.imageCover || listing.images?.[0] || "https://placehold.co/800x450/1a1a1a/555555?text=No+Image";

  const url = listing.url || "";
  const tech = listing.tech || {};
  const settings = listing.settings || {};

  const techItems = [
    tech.frontend && { label: "Frontend", value: tech.frontend },
    tech.backend && { label: "Backend", value: tech.backend },
    tech.database && { label: "Database", value: tech.database },
    tech.monetization && { label: "Monetization", value: tech.monetization },
  ].filter(Boolean) as { label: string; value: string }[];

  // Original: `[listing.images?.[0], listing.images?.[1]]` for the two
  // portrait gallery shots (index 2 is used as the hero/cover above, so
  // it's deliberately excluded here), plus images[3] as a wide shot.
  const galleryShots = [listing.images?.[0], listing.images?.[1]].filter(Boolean) as string[];
  const landscape2 = listing.images?.[3] || "";

  const { openPreview, AdOverlayHost, PreviewHost } = useAdGatedPreview();

  return (
    <>
      <div className="modal-hero srf-lightbox-trigger" data-src={cover}>
        <img
          src={cover}
          alt={title}
          className="modal-cover"
          onError={(e) => {
            e.currentTarget.src = "https://placehold.co/800x450/1a1a1a/555555?text=Error";
          }}
        />
        <div className="modal-hero-overlay">
          <div className="modal-hero-top-row">
            <span
              className="modal-type-badge"
              style={{
                background: "rgba(10,10,12,0.86)",
                color: ACCENT,
                border: `1px solid ${ACCENT}`,
                boxShadow: "0 2px 10px rgba(0,0,0,0.4)",
              }}
            >
              {isTemplate ? "Template" : "Website"}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="modal-price-badge" title={priceTooltip}>{priceStr}</span>
              <ShareButton url={listingShareUrl(listing.id, title)} title={title} accentColor={ACCENT} />
            </div>
          </div>
          <div className="modal-hero-bottom-row">
            <div className="modal-hero-title-block" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h2 className="modal-hero-title">{title}</h2>
              <VerifiedBadge listing={listing} />
            </div>
          </div>
        </div>
      </div>

      {galleryShots.length || landscape2 ? (
        <div className="modal-gallery">
          {galleryShots.map((s, i) => (
            <div key={i} className="modal-gallery-shot portrait srf-lightbox-trigger" data-src={s}>
              <img
                src={s}
                alt={`screenshot ${i + 1}`}
                loading="lazy"
                onError={(e) => {
                  (e.currentTarget.parentElement as HTMLElement).style.display = "none";
                }}
              />
            </div>
          ))}
          {landscape2 ? (
            <div className="modal-gallery-shot wide srf-lightbox-trigger" data-src={landscape2}>
              <img
                src={landscape2}
                alt="screenshot 4"
                loading="lazy"
                onError={(e) => {
                  (e.currentTarget.parentElement as HTMLElement).style.display = "none";
                }}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="modal-content">
        <div className="modal-section">
          <DescriptionBlock description={listing.description} />
          {url ? (
            <div className="modal-url-row">
              <a href={url} target="_blank" rel="noopener" className="modal-url">
                {url}
              </a>
              <button
                type="button"
                className="modal-view-btn"
                onClick={() => openPreview({ title: `Preview: ${title}`, url })}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 2a14.5 14.5 0 010 20M12 2a14.5 14.5 0 000 20M2 12h20" strokeLinecap="round" />
                </svg>
                Preview
              </button>
            </div>
          ) : null}
        </div>

        {techItems.length ? (
          <div className="modal-section">
            <div className="modal-section-title with-icon">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2.2">
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
              Tech Stack
            </div>
            <div className="modal-tech-grid">
              {techItems.map((t) => (
                <div key={t.label} className="tech-item">
                  <span className="tech-label">{t.label}</span>
                  <span className="tech-value">{t.value}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <FinancialsBlock listing={listing} accentColor={ACCENT} />

        <div className="modal-section">
          <div className="modal-section-title with-icon">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2.2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.07 4.93a10 10 0 010 14.14M4.93 4.93a10 10 0 000 14.14" />
            </svg>
            Business Details
          </div>
          <div className="modal-settings-grid">
            {settings.category ? (
              <div className="setting-item">
                <span>Category</span>
                <span>{settings.category}</span>
              </div>
            ) : null}
            {settings.age ? (
              <div className="setting-item">
                <span>Site Age</span>
                <span>{settings.age}</span>
              </div>
            ) : null}
            {settings.location ? (
              <div className="setting-item">
                <span>Location</span>
                <span>{settings.location}</span>
              </div>
            ) : null}
            {settings.structure ? (
              <div className="setting-item">
                <span>Structure</span>
                <span>{settings.structure}</span>
              </div>
            ) : null}
            {settings.reason ? (
              <div className="setting-item full-width">
                <span>Reason for selling</span>
                <span>{settings.reason}</span>
              </div>
            ) : null}
          </div>
        </div>

        <AttachedRepoBlock repo={listing.attachedRepo} accentColor={ACCENT} />
        <TransferMethodsBlock methods={listing.transferMethods} accentColor={ACCENT} />
        <SellerBlock listing={listing} accentColor={ACCENT} />
      </div>
      <DealCtaBar listing={listing} />
      <AdOverlayHost />
      <PreviewHost />
    </>
  );
}
