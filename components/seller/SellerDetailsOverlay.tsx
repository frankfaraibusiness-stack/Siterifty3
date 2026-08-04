"use client";

import { useEffect, useState } from "react";
import SellerBadges from "./SellerBadges";
import { fetchSellerDealStats, type FullSeller, type SellerDealStats } from "@/lib/useSeller";
import { useAuth } from "@/lib/AuthContext";
import { useCurrency } from "@/lib/CurrencyContext";
import { useScrollLock } from "@/lib/useScrollLock";

const SOCIAL_DEFS = [
  {
    key: "website" as const,
    label: "Website",
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20" />
      </svg>
    ),
  },
  {
    key: "twitter" as const,
    label: "Twitter",
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
  },
  {
    key: "github" as const,
    label: "GitHub",
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
      </svg>
    ),
  },
  {
    key: "linkedin" as const,
    label: "LinkedIn",
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
      </svg>
    ),
  },
];

export default function SellerDetailsOverlay({
  seller,
  cachedStats,
  onClose,
}: {
  seller: FullSeller;
  cachedStats: SellerDealStats | null;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const isOwn = user?.uid === seller.uid;
  const [stats, setStats] = useState<SellerDealStats | null>(cachedStats);
  useScrollLock(true);

  useEffect(() => {
    if (cachedStats) {
      setStats(cachedStats);
      return;
    }
    let cancelled = false;
    fetchSellerDealStats(seller.uid).then((s) => {
      if (!cancelled) setStats(s);
    });
    return () => {
      cancelled = true;
    };
  }, [seller.uid, cachedStats]);

  const initial = seller.username.charAt(0).toUpperCase();
  const handle = "@" + seller.username.toLowerCase().replace(/\s+/g, "_");
  const bio = seller.bio && (seller.showBio || isOwn) ? seller.bio : "This seller hasn't added a bio yet.";
  const showSocials = seller.showSocial || isOwn;
  const canShowEmail = !!seller.contactEmail && (seller.showEmail || isOwn);

  const { formatFinFull } = useCurrency();
  const byCategory = stats?.byCategory || { website: 0, app: 0, game: 0 };
  const catTotal = byCategory.website + byCategory.app + byCategory.game;

  return (
    <div id="spDetailsOverlay" className="active" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div id="spDetailsBox" data-scroll-lock-exempt>
        <button id="spDetailsClose" aria-label="Close" onClick={onClose}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <div id="spDetailsHeader">
          <div id="spDetailsAv">
            {seller.profilePic ? (
              <img
                src={seller.profilePic}
                alt={seller.username}
                onError={(e) => {
                  (e.currentTarget.parentElement as HTMLElement).textContent = initial;
                }}
              />
            ) : (
              initial
            )}
          </div>
          <div>
            <div id="spDetailsName">
              {seller.username} <SellerBadges seller={seller} />
            </div>
            <div id="spDetailsHandle">{handle}</div>
          </div>
        </div>
        <div id="spDetailsBioLabel">About</div>
        <div id="spDetailsBio">{bio}</div>
        {showSocials && (
          <div id="spDetailsSocials">
            {SOCIAL_DEFS.map(({ key, label, icon }) => {
              let val = seller[key];
              if (!val) return null;
              if (!val.startsWith("http")) val = "https://" + val;
              return (
                <a key={key} className="sp-social-btn" href={val} target="_blank" rel="noopener">
                  {icon} {label}
                </a>
              );
            })}
          </div>
        )}

        <div id="spDetailsSafety">
          <div id="spDetailsSafetyHdr">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2 3 6v6c0 5 3.5 9 9 10 5.5-1 9-5 9-10V6z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
            Buying safely on Siterifty
          </div>
          <div className="sp-safety-row sp-safety-good">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <div>
              <b>Always use Siterifty Escrow.</b> Your payment is held safely until you confirm the asset was delivered
              as described — never wire money or pay outside the platform.
            </div>
          </div>
          <div className="sp-safety-row sp-safety-good">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <div>
              <b>Check history and reviews.</b> A seller with a longer track record, real completed deals, and genuine
              reviews is generally lower-risk.
            </div>
          </div>
          <div className="sp-safety-row sp-safety-good">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <div>
              <b>Verify before you buy.</b> Ask for analytics access, source ownership proof, or a live walkthrough
              before sending an offer.
            </div>
          </div>
          <div className="sp-safety-row sp-safety-bad">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <div>
              <b>Watch for pressure tactics.</b> Urgency (&quot;pay right now or I sell to someone else&quot;), prices that
              seem too good to be true, or requests to move the chat off-platform are common scam signs.
            </div>
          </div>
          <div className="sp-safety-row sp-safety-bad">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <div>
              <b>Never share passwords or send funds directly.</b> Legitimate sellers hand over access only after
              escrow confirms your payment — report anyone who asks otherwise.
            </div>
          </div>
        </div>

        <div id="spDetailsStats">
          <div id="spDetailsStatsHdr">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="20" x2="12" y2="10" />
              <line x1="18" y1="20" x2="18" y2="4" />
              <line x1="6" y1="20" x2="6" y2="16" />
            </svg>
            Deals &amp; revenue
          </div>
          <div id="spDetailsStatsGrid">
            <div className={`sp-dstat${!stats ? " sp-skel-stat2" : ""}`}>
              <div className="sp-dstat-val" id="spDetailsStatDeals">{stats ? String(stats.lifetimeDeals) : "—"}</div>
              <div className="sp-dstat-lbl">Lifetime deals</div>
            </div>
            <div className={`sp-dstat${!stats ? " sp-skel-stat2" : ""}`}>
              <div className="sp-dstat-val" id="spDetailsStatRevenue">{stats ? formatFinFull(stats.lifetimeRevenue) : "—"}</div>
              <div className="sp-dstat-lbl">Lifetime revenue</div>
            </div>
            <div className={`sp-dstat${!stats ? " sp-skel-stat2" : ""}`}>
              <div className="sp-dstat-val" id="spDetailsStat7d">{stats ? formatFinFull(stats.last7DaysRevenue) : "—"}</div>
              <div className="sp-dstat-lbl">Revenue · 7 days</div>
            </div>
          </div>
          {stats && catTotal > 0 ? (
            <div id="spDetailsCatBreakdown">
              {(["website", "app", "game"] as const).map((cat) => {
                const count = byCategory[cat] || 0;
                const pct = catTotal > 0 ? Math.round((count / catTotal) * 100) : 0;
                const color = cat === "website" ? "#60a5fa" : cat === "app" ? "#a78bfa" : "#f59e0b";
                const label = cat === "website" ? "Websites" : cat === "app" ? "Apps" : "Games";
                return (
                  <div className="sp-cat-row" data-cat={cat} key={cat}>
                    <span className="sp-cat-lbl">{label}</span>
                    <div className="sp-cat-bar-track">
                      <div className="sp-cat-bar-fill" style={{ width: `${pct}%`, background: color }} />
                    </div>
                    <span className="sp-cat-count">{count}</span>
                  </div>
                );
              })}
            </div>
          ) : stats ? (
            <div id="spDetailsStatsEmpty" style={{ display: "block" }}>No completed deals yet.</div>
          ) : null}
        </div>

        {canShowEmail ? (
          <>
            <div className="wallet-field-label">Contact email</div>
            <div id="spDetailsEmail">{seller.contactEmail}</div>
            <button id="spDetailsContactBtn" onClick={() => { window.location.href = `mailto:${seller.contactEmail}`; }}>
              Email seller
            </button>
          </>
        ) : (
          <>
            <div className="wallet-field-label">Contact email</div>
            <div id="spDetailsEmail">No contact email shared</div>
            <button id="spDetailsContactBtn" disabled>
              Email seller
            </button>
          </>
        )}
      </div>
    </div>
  );
}
