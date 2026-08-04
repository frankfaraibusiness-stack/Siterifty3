"use client";

import type { Listing } from "@/lib/listings";
import DescriptionBlock from "./DescriptionBlock";
import FinancialsBlock from "./FinancialsBlock";
import SellerBlock from "./SellerBlock";
import TransferMethodsBlock from "./TransferMethodsBlock";
import AttachedRepoBlock from "./AttachedRepoBlock";
import DealCtaBar from "@/components/deal/DealCtaBar";
import { useCurrency } from "@/lib/CurrencyContext";
import { useAdGatedPreview } from "@/lib/useAdGatedPreview";
import ShareButton from "@/components/listing/ShareButton";
import VerifiedBadge from "@/components/marketplace/VerifiedBadge";
import { listingShareUrl } from "@/lib/share";

// Ports the `type === 'game'` branch of mpOpenModal (marketplace.js,
// ~line 2026) — same accent color, same hero/gallery layout, same
// section order: title+external-link → Launch Game → game details →
// financials → attached repo → transfer methods → seller.
const ACCENT = "#f59e0b"; // matches `tc` for type==='game' in the original

export default function GameListingBody({ listing }: { listing: Listing }) {
  const title = listing.title || "Untitled";
  const isTemplate = listing.isTemplate || false;
  const { formatPriceShort } = useCurrency();
  const priceStr = typeof listing.financials?.price === "number" ? formatPriceShort(listing.financials.price) : "—";
  const priceTooltip = typeof listing.financials?.price === "number" ? `$${listing.financials.price.toLocaleString()} USD` : undefined;
  const cover = listing.images?.[2] || listing.imageCover || listing.images?.[0] || "https://placehold.co/800x450/1a1a1a/555555?text=No+Image";

  const url = listing.url || "";
  const gameType = listing.gameType || "link";
  // Game listings store platform under tech.frontend and genre under
  // tech.backend, same field reuse the original's game branch does.
  const tech = listing.tech || {};
  const platform = tech.frontend || "";
  const genre = tech.backend || "";
  const settings = listing.settings || {};

  // images[2] (landscape) is the hero, same as website/app; images[0]/[1]
  // (portraits) go in the gallery strip below.
  const portrait0 = listing.images?.[0] || "";
  const portrait1 = listing.images?.[1] || "";
  const landscape = listing.images?.[2] || "";
  const heroShot = landscape || portrait0 || portrait1 || cover;
  const galleryShots = [portrait0, portrait1].filter(Boolean);

  const canPlay = !!url;
  const { openPreview, AdOverlayHost, PreviewHost } = useAdGatedPreview();

  return (
    <>
      <div className="modal-hero srf-lightbox-trigger" data-src={heroShot}>
        <img
          src={heroShot}
          alt={title}
          className="modal-cover"
          onError={(e) => {
            e.currentTarget.src = "https://placehold.co/800x450/1a1a1a/555555?text=No+Image";
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
              Game{isTemplate ? " · Template" : ""}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="modal-price-badge" title={priceTooltip}>{priceStr}</span>
              <ShareButton url={listingShareUrl(listing.id, title)} title={title} accentColor={ACCENT} />
            </div>
          </div>
          <div className="modal-hero-bottom-row">
            <div className="modal-hero-title-block">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h2 className="modal-hero-title">{title}</h2>
                <VerifiedBadge listing={listing} />
              </div>
              <div className="modal-hero-pills">
                {platform ? <span className="modal-hero-pill">{platform}</span> : null}
                {genre ? <span className="modal-hero-pill">{genre}</span> : null}
                {gameType === "upload" ? <span className="modal-hero-pill">Playable in Browser</span> : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      {galleryShots.length ? (
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
        </div>
      ) : null}

      <div className="modal-content">
        <div className="modal-section modal-game-title-section">
          <DescriptionBlock description={listing.description} />
          {url && gameType !== "upload" ? (
            <button
              type="button"
              onClick={() => window.open(url, "_blank", "noopener")}
              className="modal-game-ext-link"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontFamily: "inherit",
                padding: 0,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                color: "#f59e0b",
                fontWeight: 600,
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              View Game
            </button>
          ) : null}
        </div>

        {canPlay ? (
          <div className="modal-section modal-game-play-section">
            {/* Ad-gated (free plan) fullscreen preview via useAdGatedPreview
                — mirrors mpShowAdThenAction -> mpOpenGameFullscreen, incl.
                the gameType==='upload' srcdoc branch. */}
            <button
              type="button"
              className="modal-game-play-btn"
              style={{ width: "100%" }}
              onClick={() => openPreview({ title: `Launching: ${title}`, url, gameType })}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              Launch Game
            </button>
          </div>
        ) : null}

        <div className="modal-section">
          <div className="modal-section-title with-icon modal-game-section-title">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2.2">
              <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
            </svg>
            Game Details
          </div>
          <div className="modal-settings-grid">
            {platform ? (
              <div className="setting-item">
                <span>Platform</span>
                <span>{platform}</span>
              </div>
            ) : null}
            {genre ? (
              <div className="setting-item">
                <span>Genre</span>
                <span>{genre}</span>
              </div>
            ) : null}
            {settings.age ? (
              <div className="setting-item">
                <span>Game Age</span>
                <span>{settings.age}</span>
              </div>
            ) : null}
            {settings.structure ? (
              <div className="setting-item">
                <span>Structure</span>
                <span>{settings.structure}</span>
              </div>
            ) : null}
            {gameType ? (
              <div className="setting-item">
                <span>Delivery</span>
                <span>{gameType === "upload" ? "Browser Build" : "External Link"}</span>
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

        <FinancialsBlock listing={listing} accentColor={ACCENT} />
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
