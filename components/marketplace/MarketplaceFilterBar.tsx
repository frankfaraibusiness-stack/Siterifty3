"use client";

// Ports the "── Search ──", "── Discover ──", "── Type filter chips ──",
// "── Template filter ──", "── Price popover ──", and "── Active filter
// tags ──" sections of marketplace.js, wrapped in #mpFilterBar >
// #mpSearchRow / #discoverOverlay / #mpChipsRow exactly as in the
// original, with #mpActiveTags as a sibling outside #mpFilterBar. Type
// selection is forwarded to the parent (which passes it into useFeed's
// server-side `type` param, same as the original passing mpTypeFilter
// into /api/listings); template + price + search stay entirely
// client-side, matching the original (handleFeed has no
// template/price/search params). Discover hits /api/listings
// (action: 'listing.discover') directly from DiscoverPanel — plain
// random-slice browsing, no AI involved despite the old "AI Search" name
// this replaced.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { Listing, ListingType } from "@/lib/listings";
import { FALLBACK_PRICE_CAP, type ActiveTag, type TemplateFilter } from "@/lib/useMarketplaceFilters";
import { useLimits } from "@/lib/useLimits";
import MarketplaceSearchBar from "@/components/marketplace/MarketplaceSearchBar";
import { DiscoverButton } from "@/components/marketplace/DiscoverPanel";
import { useScrollLock } from "@/lib/useScrollLock";

const TYPE_OPTIONS: { value: ListingType | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "website", label: "Websites" },
  { value: "app", label: "Apps" },
  { value: "game", label: "Games" },
];

function fmt(n: number) {
  return Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function MarketplaceFilterBar({
  typeFilter,
  onTypeChange,
  templateFilter,
  onTemplateChange,
  priceMin,
  priceMax,
  onPriceChange,
  activeTags,
  searchListings,
  searchQuery,
  onSearchChange,
  onOpenListing,
  onOpenSeller,
  autoOpenSearch,
  onExitTakeover,
}: {
  typeFilter: ListingType | "all";
  onTypeChange: (t: ListingType | "all") => void;
  templateFilter: TemplateFilter;
  onTemplateChange: (t: TemplateFilter) => void;
  priceMin: number;
  priceMax: number | null;
  onPriceChange: (min: number, max: number | null) => void;
  activeTags: ActiveTag[];
  searchListings: Listing[];
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onOpenListing: (listing: Listing) => void;
  onOpenSeller: (ownerId: string | undefined, listing: Listing) => void;
  autoOpenSearch?: boolean;
  onExitTakeover?: () => void;
}) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const router = useRouter();
  const { limits } = useLimits();
  const PRICE_CAP = limits.marketplace.priceCap ?? FALLBACK_PRICE_CAP;
  const [sliderMin, setSliderMin] = useState(priceMin);
  const [sliderMax, setSliderMax] = useState(priceMax ?? PRICE_CAP);
  const [exactMin, setExactMin] = useState(priceMin > 0 ? String(priceMin) : "");
  const [exactMax, setExactMax] = useState(priceMax !== null ? String(priceMax) : "");
  const priceBtnRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  // Portal target isn't available during SSR, and even on the client we
  // only want to read it after mount — same guard SearchOverlay and
  // MarketplaceModal use for their own document.body portals.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!popoverOpen) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (priceBtnRef.current?.contains(target)) return;
      setPopoverOpen(false);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [popoverOpen]);

  // Escape-to-close + background scroll lock, matching the other
  // full-screen/portaled overlays (SearchOverlay, MarketplaceModal). Scroll
  // lock uses the shared reference-counted hook (see lib/useScrollLock.ts)
  // — a hand-rolled body.style.overflow toggle here could capture a stale
  // "previous" value if another modal is locked at the same time, and
  // restore that stale value on close instead of the real original,
  // leaving scroll stuck.
  useScrollLock(popoverOpen);

  useEffect(() => {
    if (!popoverOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setPopoverOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [popoverOpen]);

  const lo = Math.min(sliderMin, sliderMax);
  const hi = Math.max(sliderMin, sliderMax);
  const rangeLeft = (lo / PRICE_CAP) * 100 + "%";
  const rangeRight = 100 - (hi / PRICE_CAP) * 100 + "%";

  const priceLabel = (() => {
    const hMin = priceMin > 0;
    const hMax = priceMax !== null;
    if (hMin && hMax) return `$${fmt(priceMin)} – $${fmt(priceMax as number)} USD`;
    if (hMin) return `$${fmt(priceMin)}+ USD`;
    if (hMax) return `Up to $${fmt(priceMax as number)} USD`;
    return "Any price";
  })();
  const priceActive = priceMin > 0 || priceMax !== null;

  function cycleTemplate() {
    const next: TemplateFilter = templateFilter === "all" ? "template" : templateFilter === "template" ? "not-template" : "all";
    onTemplateChange(next);
  }

  function applyPrice() {
    const eMin = parseFloat(exactMin);
    const eMax = parseFloat(exactMax);
    let min = !isNaN(eMin) ? eMin : sliderMin;
    let max = !isNaN(eMax) ? eMax : sliderMax >= PRICE_CAP ? null : sliderMax;
    if (max !== null && min > max) {
      const t = min;
      min = max;
      max = t;
    }
    onPriceChange(min, max);
    setPopoverOpen(false);
  }

  function resetPrice() {
    setSliderMin(0);
    setSliderMax(PRICE_CAP);
    setExactMin("");
    setExactMax("");
    onPriceChange(0, null);
    setPopoverOpen(false);
  }

  return (
    <>
      <div id="mpFilterBar">
        <div id="mpSearchRow">
          <MarketplaceSearchBar
            listings={searchListings}
            searchQuery={searchQuery}
            onSearchChange={onSearchChange}
            onOpen={onOpenListing}
            autoOpen={autoOpenSearch}
            onExitTakeover={onExitTakeover}
          />
          <DiscoverButton onClick={() => router.push("/discover")} />
        </div>
        <div id="mpChipsRow">
        {TYPE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            className={"mp-chip" + (typeFilter === opt.value ? " active" : "")}
            data-mptype={opt.value}
            onClick={() => onTypeChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
        <button
          className={
            "mp-chip" + (templateFilter === "template" ? " active" : templateFilter === "not-template" ? " active-alt" : "")
          }
          data-state={templateFilter}
          onClick={cycleTemplate}
        >
          {templateFilter === "template" ? (
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
              <rect x={3} y={3} width={18} height={18} rx={2} />
              <path d="M9 3v18" />
            </svg>
          ) : templateFilter === "not-template" ? (
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
              <rect x={3} y={3} width={18} height={18} rx={2} />
              <line x1={8} y1={12} x2={16} y2={12} />
            </svg>
          ) : (
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
              <rect x={3} y={3} width={18} height={18} rx={2} />
            </svg>
          )}{" "}
          {templateFilter === "template" ? "Templates only" : templateFilter === "not-template" ? "Full products" : "Any type"}
        </button>
        <div className="mp-price-wrap">
          <button
            ref={priceBtnRef}
            className={"mp-chip" + (priceActive ? " active" : "")}
            id="mpFilterPrice"
            onClick={(e) => {
              e.stopPropagation();
              setPopoverOpen((v) => !v);
            }}
          >
            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
              <circle cx={12} cy={12} r={10} />
              <text x={12} y={16} textAnchor="middle" fontSize={10} fill="currentColor" stroke="none" fontWeight={700}>
                $
              </text>
            </svg>
            <span id="mpPriceLabel">{priceLabel}</span>
            <svg className="mp-chip-caret" width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
        </div>
      </div>
      {/* Portaled straight to document.body — #mpFilterBar has its own
          backdrop-filter, which establishes a containing block for any
          position:fixed descendant, so a popover left nested inside it
          gets centered/clipped relative to the filter bar's box instead
          of the real viewport (this was the "price popup pushes the
          whole page wider / lands off to the side" bug). Same portal
          pattern already used by SearchOverlay and MarketplaceModal. */}
      {mounted && popoverOpen
        ? createPortal(
            <>
              <div className="mp-price-popover-backdrop active" onClick={() => setPopoverOpen(false)} />
              <div
                className="mp-price-popover active"
                id="mpPricePopover"
                ref={popoverRef}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mp-pp-header">
                  <span>Price range (USD)</span>
                  <button
                    className="mp-pp-close"
                    id="mpPopClose"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPopoverOpen(false);
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                      <line x1={18} y1={6} x2={6} y2={18} />
                      <line x1={6} y1={6} x2={18} y2={18} />
                    </svg>
                  </button>
                </div>
                <div className="mp-slider-track">
                  <div className="mp-slider-range" id="mpSliderRange" style={{ left: rangeLeft, right: rangeRight }} />
                  <input
                    type="range"
                    id="mpSliderMin"
                    className="mp-range-input"
                    min={0}
                    max={PRICE_CAP}
                    step={10}
                    value={sliderMin}
                    onChange={(e) => {
                      let v = Number(e.target.value);
                      if (v > sliderMax) v = sliderMax;
                      setSliderMin(v);
                      setExactMin(String(v));
                    }}
                  />
                  <input
                    type="range"
                    id="mpSliderMax"
                    className="mp-range-input"
                    min={0}
                    max={PRICE_CAP}
                    step={10}
                    value={sliderMax}
                    onChange={(e) => {
                      let v = Number(e.target.value);
                      if (v < sliderMin) v = sliderMin;
                      setSliderMax(v);
                      setExactMax(v >= PRICE_CAP ? "" : String(v));
                    }}
                  />
                </div>
                <div className="mp-slider-scale">
                  <span>$0</span>
                  <span>$2.5k</span>
                  <span>$5k</span>
                  <span>$7.5k</span>
                  <span>$10k+</span>
                </div>
                <div className="mp-exact-row">
                  <label className="mp-exact-field">
                    <span>Min</span>
                    <div className="mp-input-prefix">
                      <span>$</span>
                      <input
                        type="number"
                        id="mpExactMin"
                        min={0}
                        step={0.01}
                        placeholder="0.00"
                        value={exactMin}
                        onChange={(e) => {
                          setExactMin(e.target.value);
                          const v = parseFloat(e.target.value);
                          setSliderMin(isNaN(v) ? 0 : Math.min(v, PRICE_CAP));
                        }}
                      />
                    </div>
                  </label>
                  <span className="mp-exact-dash">–</span>
                  <label className="mp-exact-field">
                    <span>Max</span>
                    <div className="mp-input-prefix">
                      <span>$</span>
                      <input
                        type="number"
                        id="mpExactMax"
                        min={0}
                        step={0.01}
                        placeholder="Any"
                        value={exactMax}
                        onChange={(e) => {
                          setExactMax(e.target.value);
                          const v = parseFloat(e.target.value);
                          setSliderMax(isNaN(v) ? PRICE_CAP : Math.min(v, PRICE_CAP));
                        }}
                      />
                    </div>
                  </label>
                </div>
                <div className="mp-pp-actions">
                  <button className="mp-pp-btn ghost" id="mpPriceReset" onClick={resetPrice}>
                    Reset
                  </button>
                  <button className="mp-pp-btn primary" id="mpPriceApply" onClick={applyPrice}>
                    Apply
                  </button>
                </div>
              </div>
            </>,
            document.body
          )
        : null}
      <div id="mpActiveTags" style={{ display: activeTags.length ? "flex" : "none" }}>
        {activeTags.map((tag, i) => (
          <span className="active-filter-tag" key={i}>
            {tag.label}
            <button className="tag-remove-btn" aria-label="Remove filter" onClick={tag.clear}>
              <svg width={8} height={8} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </span>
        ))}
      </div>
    </>
  );
}
