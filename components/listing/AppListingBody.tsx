"use client";

import { useState } from "react";
import type { Listing, ListingBuildFile } from "@/lib/listings";
import DescriptionBlock from "./DescriptionBlock";
import FinancialsBlock from "./FinancialsBlock";
import SellerBlock from "./SellerBlock";
import TransferMethodsBlock from "./TransferMethodsBlock";
import AttachedRepoBlock from "./AttachedRepoBlock";
import DealCtaBar from "@/components/deal/DealCtaBar";
import { useCurrency } from "@/lib/CurrencyContext";
import ShareButton from "@/components/listing/ShareButton";
import VerifiedBadge from "@/components/marketplace/VerifiedBadge";
import { listingShareUrl } from "@/lib/share";

const ACCENT = "#a78bfa"; // app accent color, matches tc for type==='app'

function collectBuildFiles(listing: Listing): ListingBuildFile[] {
  const files: ListingBuildFile[] = [];
  // Legacy binary uploads (older listings created before the link-only
  // change) — still rendered for listings that already have them, but no
  // current form writes these fields anymore.
  if (listing.apkUrl || listing.apkStorageUrl) {
    files.push({
      filename: listing.apkIpaFileName || listing.apkFileName || "app-build.apk",
      url: listing.apkStorageUrl ? null : listing.apkUrl || null,
      storagePath: listing.apkStorageUrl || null,
    });
  }
  if (Array.isArray(listing.additionalFiles)) {
    for (const f of listing.additionalFiles) {
      if (f && (f.url || f.storagePath)) files.push(f);
    }
  }
  if (listing.notLive === true && Array.isArray(listing.notLiveBuildFiles?.global)) {
    for (const f of listing.notLiveBuildFiles!.global!) {
      if (f && (f.url || f.storagePath)) files.push(f);
    }
  }
  // Current, link-first "not live" builds. iOS/Android are always an
  // externally-hosted link the seller provided (Drive/Dropbox/etc) — never
  // a file Siterifty stores — so these render as plain external links
  // rather than a signed-storage download.
  if (listing.globalBuildUrl) {
    files.push({ filename: "Build (external link)", url: listing.globalBuildUrl, storagePath: null });
  }
  if (listing.platforms?.iosBuildUrl) {
    files.push({ filename: "iOS build (external link)", url: listing.platforms.iosBuildUrl, storagePath: null });
  }
  if (listing.platforms?.androidBuildUrl) {
    files.push({ filename: "Android build (external link)", url: listing.platforms.androidBuildUrl, storagePath: null });
  }
  if (Array.isArray(listing.platforms?.webBuildFiles)) {
    for (const f of listing.platforms!.webBuildFiles!) {
      if (f && (f.url || f.storagePath)) files.push(f);
    }
  }
  const seen = new Set<string>();
  return files.filter((f) => {
    const key = (f.filename || "") + "|" + (f.url || f.storagePath || "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Resolves a build file's storagePath into a fresh signed URL on demand,
// same as window.__downloadListingBuildFile in the original — binary
// build files never get a permanent public URL, only a storagePath that
// must be signed at click time via the listing.file-url action (which
// is public, so this works signed-out too).
async function downloadBuildFile(listingId: string, storagePath: string) {
  const res = await fetch("/api/listings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "listing.file-url", idToken: null, listingId, storagePath }),
  });
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json?.error?.message || "Could not generate download link");
  window.open(json.data.url, "_blank", "noopener");
}

function BuildFileRow({ listing, file }: { listing: Listing; file: ListingBuildFile }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="modal-app-apk-block">
      <div className="modal-app-apk-icon">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      </div>
      <div className="modal-app-apk-info">
        <span className="modal-app-apk-label">
          {listing.notLive === true ? "Preview Build (Not Live Yet)" : "Test Build Available"}
        </span>
        <span className="modal-app-apk-name">{file.filename || "app-build.apk"}</span>
      </div>
      {file.url ? (
        <a href={file.url} target="_blank" rel="noopener" download={file.filename || "app.apk"} className="modal-app-apk-btn">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Download
        </a>
      ) : (
        <button
          type="button"
          className="modal-app-apk-btn"
          disabled={busy}
          onClick={async () => {
            if (!file.storagePath) return;
            setBusy(true);
            try {
              await downloadBuildFile(listing.id, file.storagePath);
            } catch (err) {
              console.error("[downloadBuildFile]", err);
            } finally {
              setBusy(false);
            }
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          {busy ? "Preparing…" : "Download"}
        </button>
      )}
    </div>
  );
}

export default function AppListingBody({ listing }: { listing: Listing }) {
  const title = listing.title || "Untitled";
  const isTemplate = listing.isTemplate || false;
  const { formatPriceShort } = useCurrency();
  const priceStr = typeof listing.financials?.price === "number" ? formatPriceShort(listing.financials.price) : "—";
  const priceTooltip = typeof listing.financials?.price === "number" ? `$${listing.financials.price.toLocaleString()} USD` : undefined;
  const cover = listing.images?.[2] || listing.imageCover || listing.images?.[0] || "https://placehold.co/800x450/1a1a1a/555555?text=No+Image";

  const appIcon = listing.appIcon || "";
  const videoUrl = listing.videoUrl || "";
  const platforms = listing.platforms || {};
  const selPlatforms = platforms.selected || [];
  const iosUrl = platforms.iosUrl || "";
  const androidUrl = platforms.androidUrl || "";
  const webUrl = platforms.webUrl || "";
  const previewUrl = platforms.previewUrl || listing.previewUrl || "";

  const buildFiles = collectBuildFiles(listing);

  const shots = (listing.images || []).filter(Boolean);
  const heroShot = listing.imageCover || appIcon || cover;

  const tech = listing.tech || {};
  const techItems = [
    tech.frontend && { label: "Frontend", value: tech.frontend },
    tech.backend && { label: "Backend", value: tech.backend },
    tech.database && { label: "Database", value: tech.database },
    tech.monetization && { label: "Monetization", value: tech.monetization },
  ].filter(Boolean) as { label: string; value: string }[];

  const settings = listing.settings || {};

  const [previewOpen, setPreviewOpen] = useState(false);

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
              App{isTemplate ? " · Template" : ""}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="modal-price-badge" title={priceTooltip}>{priceStr}</span>
              <ShareButton url={listingShareUrl(listing.id, title)} title={title} accentColor={ACCENT} />
            </div>
          </div>
          <div className="modal-hero-bottom-row">
            {appIcon ? (
              <img src={appIcon} alt={`${title} icon`} className="modal-hero-icon-badge" />
            ) : (
              <div className="modal-hero-icon-badge-placeholder">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="4" />
                </svg>
              </div>
            )}
            <div className="modal-hero-title-block">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h2 className="modal-hero-title">{title}</h2>
                <VerifiedBadge listing={listing} />
              </div>
              <div className="modal-hero-pills">
                {selPlatforms.map((p) => (
                  <span key={p} className="modal-hero-pill">
                    {p === "ios" ? "iOS" : p === "android" ? "Android" : p === "web" ? "Web" : p}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {shots.length ? (
        <div className="modal-gallery">
          {shots.map((s, i) => (
            <div key={i} className="modal-gallery-shot tall srf-lightbox-trigger" data-src={s}>
              <img
                src={s}
                alt="screenshot"
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
        <div className="modal-section modal-app-desc-section">
          <div className="modal-app-section-label">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2.2">
              <rect x="3" y="3" width="18" height="18" rx="4" />
              <line x1="9" y1="12" x2="15" y2="12" />
              <line x1="9" y1="8" x2="15" y2="8" />
              <line x1="9" y1="16" x2="12" y2="16" />
            </svg>
            About this App
          </div>
          <DescriptionBlock description={listing.description} />
          {selPlatforms.length ? (
            <div className="modal-app-stores">
              {iosUrl ? (
                <button onClick={() => window.open(iosUrl, "_blank")} className="modal-store-btn ios">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
                  </svg>{" "}
                  App Store
                </button>
              ) : null}
              {androidUrl ? (
                <button onClick={() => window.open(androidUrl, "_blank")} className="modal-store-btn android">
                  <svg width="15" height="15" viewBox="0 0 512 512">
                    <path fill="#00d2ff" d="M47.7 21.4C40 29.6 36 41.2 36 55.9v400.2c0 14.7 4 26.3 11.7 34.5l1.9 1.9L273 268.1v-4.7L49.6 19.5l-1.9 1.9z" />
                    <path fill="#00f076" d="M347.5 342.5l-74.9-74.9v-4.7l74.9-74.9 1.7 1L438 234.6c25.6 14.5 25.6 38.3 0 52.9l-89.8 44.9-.7.1z" />
                    <path fill="#ff3a44" d="M349.2 341.5L273 265.3 47.7 490.6c8.3 8.7 22 9.8 37.4 1.1l264.1-150.2" />
                    <path fill="#ffcf00" d="M349.2 189.1L85.1 38.9c-15.4-8.7-29.1-7.6-37.4 1.1L273 265.3l76.2-76.2z" />
                  </svg>{" "}
                  Play Store
                </button>
              ) : null}
              {webUrl ? (
                <button onClick={() => window.open(webUrl, "_blank")} className="modal-store-btn web">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 2a14.5 14.5 0 010 20M2 12h20" strokeLinecap="round" />
                  </svg>{" "}
                  Web App
                </button>
              ) : null}
            </div>
          ) : null}
          {videoUrl ? (
            <a href={videoUrl} target="_blank" rel="noopener" className="modal-video-link">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>{" "}
              Watch Demo Video
            </a>
          ) : null}
        </div>

        {buildFiles.length ? (
          <div className="modal-app-apk-list">
            {buildFiles.map((f, i) => (
              <BuildFileRow key={i} listing={listing} file={f} />
            ))}
          </div>
        ) : null}

        {previewUrl ? (
          <div className="modal-section modal-app-preview-section">
            <div className="modal-app-preview-header">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <path d="M8 21h8M12 17v4" />
              </svg>
              <span>Live Preview</span>
            </div>
            {previewOpen ? (
              <div className="modal-app-preview-wrap">
                <iframe
                  src={previewUrl}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                  style={{ width: "100%", height: 480, border: "none", borderRadius: "0 0 12px 12px", background: "#fff", display: "block" }}
                  loading="lazy"
                />
              </div>
            ) : null}
            <button className="modal-app-preview-btn" onClick={() => setPreviewOpen((o) => !o)}>
              {previewOpen ? (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>{" "}
                  Close Preview
                </>
              ) : (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <rect x="2" y="3" width="20" height="14" rx="2" />
                    <path d="M8 21h8M12 17v4" />
                  </svg>{" "}
                  Open Demo Preview
                </>
              )}
            </button>
          </div>
        ) : null}

        {techItems.length ? (
          <div className="modal-section">
            <div className="modal-section-title with-icon modal-app-section-label">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2.2">
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
          <div className="modal-section-title with-icon modal-app-section-label">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2.2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.07 4.93a10 10 0 010 14.14M4.93 4.93a10 10 0 000 14.14" />
            </svg>
            App Details
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
                <span>App Age</span>
                <span>{settings.age}</span>
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
    </>
  );
}
