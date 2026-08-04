"use client";

import { useMemo, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import type { SellerListing } from "@/lib/useSeller";
import { buildListingSlug } from "@/lib/slug";
import { useCurrency } from "@/lib/CurrencyContext";

type FilterType = "all" | "website" | "game" | "app";

// Mirrors SP_LISTING_TYPE_META from marketplace.js.
const TYPE_META: Record<FilterType, { empty: string; emptyText: string }> = {
  all: { empty: "No active listings", emptyText: "This seller has not listed anything for sale yet." },
  website: { empty: "No websites listed", emptyText: "This seller has not added any websites for sale." },
  game: { empty: "No games listed", emptyText: "This seller has not added any games for sale." },
  app: { empty: "No apps listed", emptyText: "This seller has not added any apps for sale." },
};

const TABS: { type: FilterType; label: string; icon: ReactElement }[] = [
  {
    type: "all",
    label: "All",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    type: "website",
    label: "Websites",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    ),
  },
  {
    type: "game",
    label: "Games",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="6" width="20" height="12" rx="2" />
        <path d="M12 12h.01" />
        <path d="M17 12h.01" />
        <path d="M7 12h.01" />
      </svg>
    ),
  },
  {
    type: "app",
    label: "Apps",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="7" height="7" rx="1" />
        <rect x="15" y="3" width="7" height="7" rx="1" />
        <rect x="2" y="14" width="7" height="7" rx="1" />
        <rect x="15" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
];

export default function SellerListingsGrid({ listings }: { listings: SellerListing[] }) {
  const [active, setActive] = useState<FilterType>("all");
  const router = useRouter();
  const { formatPriceShort } = useCurrency();

  const filtered = useMemo(
    () => (active === "all" ? listings : listings.filter((l) => (l.type || "website") === active)),
    [listings, active]
  );
  const meta = TYPE_META[active];

  return (
    <div id="spModalListingsSection">
      <div id="spModalListingsHeader">
        <h2>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <path d="M16 10a4 4 0 0 1-8 0" />
          </svg>
          Listings for sale
        </h2>
        <div className="sp-toggle-tabs" role="tablist" aria-label="Filter listings by type">
          {TABS.map((tab) => (
            <button
              key={tab.type}
              className={`sp-toggle-tab${active === tab.type ? " active" : ""}`}
              data-type={tab.type}
              role="tab"
              aria-selected={active === tab.type}
              onClick={() => setActive(tab.type)}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
        <span className="sp-badge-count" id="spListingsBadgeCount">
          {filtered.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div id="spModalEmpty">
          <div className="sp-empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
              <line x1="12" y1="22.08" x2="12" y2="12" />
            </svg>
          </div>
          <h3 id="spModalEmptyTitle">{meta.empty}</h3>
          <p id="spModalEmptyText">{meta.emptyText}</p>
        </div>
      ) : (
        <div id="spModalListingsGrid">
          {filtered.map((l) => {
            const type = l.type || "website";
            const tc = type === "app" ? "#a78bfa" : type === "game" ? "#f59e0b" : "#60a5fa";
            const thumb = l.images?.[2] || l.imageCover || l.images?.[0] || "https://placehold.co/400x225/111/444?text=Listing";
            const priceTxt = formatPriceShort(l.financials?.price);
            return (
              <div className="sp-listing-card" key={l.id} onClick={() => router.push(`/listing/${buildListingSlug(l.title, l.id)}`)}>
                <div className="sp-listing-thumb">
                  <img
                    src={thumb}
                    loading="lazy"
                    alt={l.title || ""}
                    onError={(e) => {
                      e.currentTarget.src = "https://placehold.co/400x225/111/444?text=Listing";
                    }}
                  />
                </div>
                <div className="sp-listing-info">
                  <div className="sp-listing-type" style={{ color: tc }}>
                    {type.toUpperCase()}
                  </div>
                  <div className="sp-listing-title">{l.title || "Untitled"}</div>
                  <div className="sp-listing-price">{priceTxt}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
