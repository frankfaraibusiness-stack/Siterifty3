"use client";

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type { SettingsState } from "@/lib/useSettingsState";

const InfoIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);

// Ports the compact-number formatting from the original's inline
// `>= 1000 ? (v/1000).toFixed(1).replace(/\.0$/,'')+'k' : v` expressions.
function fmtCompact(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n);
}

interface Stats {
  views: number;
  offers: number;
  deals: number;
  conv: string;
}

// Ports renderAnalytics() + its `case 'analytics':` handler — reads
// aggregated seller stats straight off the user doc (totalListingViews,
// totalOffersReceived, totalDealsClosed). No dedicated analytics API
// route exists in the original for this rollup; per-listing analytics
// (mentioned in the panel's own info-card copy) live inside each
// listing card instead, which is out of scope here.
export default function AnalyticsPanel({
  state,
}: {
  state: SettingsState;
  setState: React.Dispatch<React.SetStateAction<SettingsState>>;
}) {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const user = auth.currentUser;
      if (!user) return;
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (cancelled) return;
        if (snap.exists()) {
          const d = snap.data() as any;
          const totalViews = d.totalListingViews || 0;
          const totalOffers = d.totalOffersReceived || 0;
          const totalDeals = d.totalDealsClosed || 0;
          const conv = totalOffers > 0 ? `${((totalDeals / totalOffers) * 100).toFixed(1)}%` : "—";
          setStats({ views: totalViews, offers: totalOffers, deals: totalDeals, conv });
        } else {
          setStats({ views: 0, offers: 0, deals: 0, conv: "—" });
        }
      } catch {
        // silent, same as original
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const cards = [
    { label: "Total Views", value: stats ? fmtCompact(stats.views) : "—", sub: "across all listings", color: "#a3e635" },
    { label: "Offers Received", value: stats ? fmtCompact(stats.offers) : "—", sub: "total since joining", color: "#60a5fa" },
    { label: "Closed Deals", value: stats ? String(stats.deals) : "—", sub: "completed sales", color: "#f59e0b" },
    { label: "Conversion Rate", value: stats ? stats.conv : "—", sub: "offers to closed deals", color: "#d8b4fe" },
  ];

  return (
    <>
      <div className="detail-panel-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="#a5b4fc" strokeWidth="2">
          <line x1="18" y1="20" x2="18" y2="10" />
          <line x1="12" y1="20" x2="12" y2="4" />
          <line x1="6" y1="20" x2="6" y2="14" />
        </svg>
        <h3>Listing Analytics</h3>
      </div>
      <p className="detail-panel-desc">
        Track how your listings are performing — views, offer rates, and deal velocity.
      </p>
      <hr className="detail-divider" />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "1rem" }}>
        {cards.map((c) => (
          <div key={c.label} style={{ background: "#0a0a0a", border: "1px solid #222", borderRadius: "0.9rem", padding: "1rem" }}>
            <div style={{ fontSize: "0.72rem", color: "#666", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
              {c.label}
            </div>
            <div style={{ fontSize: "1.4rem", fontWeight: 800, color: "#fff", letterSpacing: "-0.03em" }}>{c.value}</div>
            <div style={{ fontSize: "0.7rem", color: c.color, marginTop: 2 }}>{c.sub}</div>
          </div>
        ))}
      </div>

      <div className="info-card" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
        <InfoIcon />
        <span className="info-text" style={{ color: "#777" }}>
          Detailed per-listing analytics are available inside each listing card. This panel shows your overall seller
          performance at a glance.
        </span>
      </div>
    </>
  );
}
