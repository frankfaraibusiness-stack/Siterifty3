"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import {
  useSellerDashboard,
  rangeToDays,
  type DashboardRange,
  type DashboardDealsData,
} from "@/lib/useSellerDashboard";
import DashboardChart from "@/components/dashboard/DashboardChart";
import DashboardWebhooksModal from "@/components/dashboard/DashboardWebhooksModal";
import { useBoostModal } from "@/components/boost/BoostModalProvider";
import { unboostListing } from "@/lib/listings";
import { useConfirm } from "@/lib/useConfirm";
import { useSrToast } from "@/components/system/SrToastProvider";
import SignInRequired from "@/components/auth/SignInRequired";
import { useCurrency } from "@/lib/CurrencyContext";
import type { ChartConfiguration } from "chart.js";

// Ports Js/dashboard.js — the Seller Dashboard. Every number here comes
// from a real Firestore-backed endpoint (listing.mine, listing.daily-stats,
// list-my-deals); nothing is mocked or randomly generated. Rendered as a
// real page at /dashboard rather than a floating global modal — same
// "route-backed section" convention /settings and /myprofile already use
// in this app, and it lets closeDashboard's original
// `location.pathname === '/dashboard'` check carry over directly.
// Mirrors isBoosted() in lib/listings.ts but returns whole days remaining
// (ceil) instead of a plain boolean, or null if not currently boosted —
// what the "Your Listings" table needs to show status + a Stop Boost
// action instead of always offering "Boost" even on an already-boosted row.
function boostDaysLeft(listing: { boostedUntil?: number | { toMillis?: () => number; seconds?: number } }): number | null {
  const until = listing.boostedUntil;
  if (!until) return null;
  const ms =
    typeof until === "number"
      ? until
      : until.toMillis
        ? until.toMillis()
        : until.seconds
          ? until.seconds * 1000
          : 0;
  const remainingMs = ms - Date.now();
  if (remainingMs <= 0) return null;
  return Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
}

const RANGE_LABELS: Record<DashboardRange, { label: string; sub: string }> = {
  today: { label: "Today", sub: "" },
  yesterday: { label: "Yesterday", sub: "" },
  "this-week": { label: "This Week", sub: "7 days" },
  "this-month": { label: "This Month", sub: "31 days" },
  "last-90": { label: "90 Days", sub: "" },
  lifetime: { label: "Lifetime", sub: "All time" },
};

const RANGE_ORDER: DashboardRange[] = ["today", "yesterday", "this-week", "this-month", "last-90", "lifetime"];

// Both take a `fmt` param (SellerDashboard passes CurrencyContext's
// formatFinFull) instead of hardcoding "$" — every number here comes from
// a real Firestore-backed endpoint (see header comment), so it converts
// to the seller's selected display currency exactly like the KPI cards
// and listing prices elsewhere in the app. fmt is optional so any other
// caller that doesn't have currency context handy still gets a sane USD
// fallback.
function formatCurrency(v: number, fmt?: (n: number) => string) {
  if (fmt) return fmt(v);
  return "$" + (Number(v) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function formatNumber(v: number) {
  const n = Number(v) || 0;
  return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
}
function formatDate(ms: number | null) {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function titleCase(s: string) {
  return s.replace(/^\w/, (c) => c.toUpperCase());
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  accepted: "Accepted",
  rejected: "Rejected",
  cancelled: "Cancelled",
  complete: "Completed",
};

function chartOptions(isCurrency?: boolean, fmt?: (n: number) => string): ChartConfiguration["options"] {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: "rgba(255,255,255,0.5)", font: { size: 10, weight: 600 }, boxWidth: 12, padding: 12 } },
      tooltip: {
        backgroundColor: "rgba(10,10,12,0.9)",
        borderColor: "rgba(255,255,255,0.08)",
        borderWidth: 1,
        titleColor: "#f0f0f5",
        bodyColor: "rgba(255,255,255,0.7)",
        cornerRadius: 8,
        padding: 10,
        callbacks: isCurrency
          ? { label: (ctx: any) => `${ctx.dataset.label}: ${formatCurrency(Number(ctx.parsed.y), fmt)}` }
          : undefined,
      },
    },
    scales: {
      x: { ticks: { color: "rgba(255,255,255,0.3)", font: { size: 9 } }, grid: { color: "rgba(255,255,255,0.04)" } },
      y: {
        ticks: { color: "rgba(255,255,255,0.3)", font: { size: 9 } },
        grid: { color: "rgba(255,255,255,0.04)" },
        beginAtZero: true,
      },
    },
    interaction: { mode: "index", intersect: false },
  };
}

function zeroedLabelsForRange(range: DashboardRange) {
  const days = Math.min(Math.max(rangeToDays(range) || 30, 1), 30);
  const labels: string[] = [];
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    labels.push(d.toLocaleDateString(undefined, { month: "short", day: "numeric" }));
  }
  return labels;
}

// Real day-by-day revenue built from actual deal timestamps (completedAt
// preferred, falls back to createdAt).
function buildDailySeries(deals: DashboardDealsData["deals"], days: number) {
  const len = Math.min(Math.max(days || 7, 1), 90);
  const labels: string[] = [];
  const revenueByDay = new Array(len).fill(0);
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  for (let i = len - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    labels.push(d.toLocaleDateString(undefined, { month: "short", day: "numeric" }));
  }

  deals.forEach((d) => {
    if (d.status !== "complete" || d.dealOutcome !== "successful") return;
    const ts = d.completedAt || d.createdAt;
    if (!ts) return;
    const day = new Date(ts);
    day.setHours(0, 0, 0, 0);
    const diffDays = Math.round((now.getTime() - day.getTime()) / 86400000);
    const idx = len - 1 - diffDays;
    if (idx >= 0 && idx < len) revenueByDay[idx] += d.amount || 0;
  });

  return { labels, revenueByDay };
}

export default function SellerDashboard() {
  const router = useRouter();
  const { listings, dealsData, loading, error, load, reset, getAggregateDailyStats } = useSellerDashboard();
  const { openBoost } = useBoostModal();
  const { formatFinFull } = useCurrency();
  const { confirm, ConfirmHost } = useConfirm();
  const { show: toast } = useSrToast();

  const [range, setRange] = useState<DashboardRange>("today");
  const [dateModalOpen, setDateModalOpen] = useState(false);
  const [pendingRange, setPendingRange] = useState<DashboardRange>("today");
  const [webhooksOpen, setWebhooksOpen] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState<boolean | null>(null);
  const [unboostingId, setUnboostingId] = useState<string | null>(null);

  async function handleUnboost(listingId: string) {
    const ok = await confirm({
      theme: "danger",
      title: "Stop Boost?",
      msg: "This listing will stop showing as boosted right away. Remaining boost time is not refunded.",
      confirmText: "Stop Boost",
    });
    if (!ok) return;
    setUnboostingId(listingId);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error("Not signed in");
      await unboostListing({ idToken, listingId });
      toast("Boost stopped.", "success");
      load(range, true);
    } catch (err) {
      console.error("[SellerDashboard] unboost failed:", err);
      const msg = err instanceof Error && err.message ? err.message : "Could not stop the boost. Please try again.";
      toast(msg, "error");
    } finally {
      setUnboostingId(null);
    }
  }

  const [trafficChart, setTrafficChart] = useState<{ config: ChartConfiguration; pill: string } | null>(null);
  const [revenueChartCfg, setRevenueChartCfg] = useState<{ config: ChartConfiguration; pill: string } | null>(null);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged((u) => setIsSignedIn(!!u));
    return unsub;
  }, []);

  useEffect(() => {
    if (isSignedIn === null) return;
    if (!isSignedIn) return;
    reset();
    load(range, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  // Build/rebuild both charts whenever the underlying data or range changes.
  useEffect(() => {
    let cancelled = false;
    if (!listings || !dealsData) {
      // Paint zeroed placeholder charts immediately so there's no blank-
      // canvas flash while the first fetch is in flight.
      const labels = zeroedLabelsForRange(range);
      const zeros = new Array(labels.length).fill(0);
      setTrafficChart({
        config: {
          type: "line",
          data: {
            labels,
            datasets: [
              { label: "Impressions", data: zeros, borderColor: "#60a5fa", backgroundColor: "rgba(96,165,250,0.08)", fill: true, tension: 0.3, pointRadius: 0, borderWidth: 2 },
              { label: "Views", data: zeros, borderColor: "#a3e635", backgroundColor: "rgba(163,230,53,0.08)", fill: true, tension: 0.3, pointRadius: 0, borderWidth: 2 },
            ],
          },
          options: chartOptions(),
        },
        pill: "Loading…",
      });
      setRevenueChartCfg({
        config: {
          type: "line",
          data: { labels, datasets: [{ label: "Revenue", data: zeros, borderColor: "#fbbf24", backgroundColor: "rgba(251,191,36,0.08)", fill: true, tension: 0.3, pointRadius: 0, borderWidth: 2 }] },
          options: chartOptions(true, formatFinFull),
        },
        pill: "Loading…",
      });
      return;
    }

    (async () => {
      const days = Math.min(rangeToDays(range) || 30, 30);
      const { labels: revLabels, revenueByDay } = buildDailySeries(dealsData.deals, days);

      let traffic: { labels: string[]; impressions: number[]; views: number[] } = { labels: [], impressions: [], views: [] };
      try {
        traffic = await getAggregateDailyStats(listings, days);
      } catch (err) {
        console.error("[dashboard] daily-stats fetch failed", err);
      }
      if (cancelled) return;

      if (traffic.labels.length) {
        setTrafficChart({
          config: {
            type: "line",
            data: {
              labels: traffic.labels,
              datasets: [
                { label: "Impressions", data: traffic.impressions, borderColor: "#60a5fa", backgroundColor: "rgba(96,165,250,0.08)", fill: true, tension: 0.3, pointRadius: 2, pointBackgroundColor: "#60a5fa", borderWidth: 2 },
                { label: "Views", data: traffic.views, borderColor: "#a3e635", backgroundColor: "rgba(163,230,53,0.08)", fill: true, tension: 0.3, pointRadius: 2, pointBackgroundColor: "#a3e635", borderWidth: 2 },
              ],
            },
            options: chartOptions(),
          },
          pill: `${days} days · top ${Math.min(listings.length, 12)} listings`,
        });
      } else {
        // No daily-bucket history yet — fall back to a lifetime snapshot,
        // labeled honestly as a snapshot rather than a trend.
        setTrafficChart({
          config: {
            type: "bar",
            data: {
              labels: listings.slice(0, 10).map((l) => (l.title || "Untitled").slice(0, 14)),
              datasets: [
                { label: "Impressions", data: listings.slice(0, 10).map((l) => l.impressionCount || 0), backgroundColor: "rgba(96,165,250,0.35)", borderColor: "#60a5fa", borderWidth: 1.5, borderRadius: 4 },
                { label: "Views", data: listings.slice(0, 10).map((l) => l.viewCount || 0), backgroundColor: "rgba(163,230,53,0.3)", borderColor: "#a3e635", borderWidth: 1.5, borderRadius: 4 },
              ],
            },
            options: chartOptions(),
          },
          pill: "Lifetime snapshot",
        });
      }

      setRevenueChartCfg({
        config: {
          type: "line",
          data: { labels: revLabels, datasets: [{ label: "Revenue", data: revenueByDay, borderColor: "#fbbf24", backgroundColor: "rgba(251,191,36,0.08)", fill: true, tension: 0.3, pointRadius: 2, pointBackgroundColor: "#fbbf24", borderWidth: 2 }] },
          options: chartOptions(true, formatFinFull),
        },
        pill: `${days} days`,
      });
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listings, dealsData, range]);

  const kpis = useMemo(() => {
    const ls = listings || [];
    const dd = dealsData || { deals: [], revenue: 0, dealsCompleted: 0 };
    const totalImpressions = ls.reduce((s, l) => s + (l.impressionCount || 0), 0);
    const totalViews = ls.reduce((s, l) => s + (l.viewCount || 0), 0);
    const totalClicks = ls.reduce((s, l) => s + (l.successfulClickCount || 0) + (l.failedClickCount || 0), 0);
    const conversionRate = totalClicks > 0 ? ((dd.dealsCompleted || 0) / totalClicks) * 100 : 0;
    return [
      { label: "Listings", value: formatNumber(ls.length), accent: "sd-kpi-accent-green", icon: iconGrid },
      { label: "Impressions", value: formatNumber(totalImpressions), accent: "sd-kpi-accent-blue", icon: iconEye },
      { label: "Views", value: formatNumber(totalViews), accent: "sd-kpi-accent-purple", icon: iconTarget },
      { label: "Deals (range)", value: formatNumber(dd.deals.length), accent: "sd-kpi-accent-amber", icon: iconUsers },
      { label: "Revenue", value: formatCurrency(dd.revenue || 0, formatFinFull), accent: "sd-kpi-accent-green", icon: iconDollar },
      { label: "Conversion Rate", value: conversionRate.toFixed(1) + "%", accent: "sd-kpi-accent-rose", icon: iconTrend },
    ];
  }, [listings, dealsData, formatFinFull]);

  const quickStats = useMemo(() => {
    const ls = listings || [];
    const dd = dealsData || { deals: [], revenue: 0, dealsCompleted: 0 };
    const completed = dd.deals.filter((d) => d.status === "complete" && d.dealOutcome === "successful");
    const avgOrderValue = completed.length ? dd.revenue / completed.length : 0;
    const topListing = ls.slice().sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0))[0];
    return {
      avgOrderValue: formatCurrency(avgOrderValue, formatFinFull),
      completedDeals: dd.dealsCompleted || 0,
      topListingTitle: topListing ? topListing.title || "Untitled" : "—",
      totalDeals: formatNumber(dd.deals.length),
    };
  }, [listings, dealsData, formatFinFull]);

  function openDateModal() {
    setPendingRange(range);
    setDateModalOpen(true);
  }
  function saveDateRange() {
    setRange(pendingRange);
    setDateModalOpen(false);
    load(pendingRange, false);
  }

  function closeDashboard() {
    router.push("/");
  }

  const rangeMeta = RANGE_LABELS[range];
  const now = new Date();
  let dateSub = rangeMeta.sub;
  if (range === "today") dateSub = now.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  else if (range === "yesterday") {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    dateSub = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } else if (range !== "lifetime") {
    const days = rangeToDays(range) || 0;
    const start = new Date(now);
    start.setDate(start.getDate() - days);
    dateSub = `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${now.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
  }

  return (
    <div id="dashboardModal" style={{ marginTop: 92, minHeight: "calc(100vh - 92px)" }}>
      <div className="sd-wrapper">
        <div className="sd-header">
          <div className="sd-brand">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <rect x={3} y={3} width={7} height={7} rx={1} />
              <rect x={14} y={3} width={7} height={7} rx={1} />
              <rect x={3} y={14} width={7} height={7} rx={1} />
              <rect x={14} y={14} width={7} height={7} rx={1} />
            </svg>
            <span className="sd-brand-name">
              Seller<span>Dashboard</span>
            </span>
          </div>
          <div className="sd-header-right">
            <button className="sd-icon-btn" id="sdSettingsToggle" aria-label="Webhook settings" onClick={() => setWebhooksOpen(true)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
              </svg>
            </button>
            <button className="sd-icon-btn" id="sdCloseBtn" aria-label="Close dashboard" onClick={closeDashboard}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}>
                <line x1={18} y1={6} x2={6} y2={18} />
                <line x1={6} y1={6} x2={18} y2={18} />
              </svg>
            </button>
          </div>
        </div>

        {isSignedIn !== false && (
          <button className="sd-date-trigger" id="sdDateTrigger" onClick={openDateModal}>
            <div className="sd-date-trigger-left">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <rect x={3} y={4} width={18} height={18} rx={2} />
                <path d="M16 2v4M8 2v4M3 10h18" />
              </svg>
              <span>
                <strong id="sdDateRangeStrong">{rangeMeta.label}</strong>
                <span className="sd-date-trigger-sub" id="sdDateRangeSub">
                  {dateSub}
                </span>
              </span>
            </div>
            <svg className="sd-date-trigger-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}

        {isSignedIn === false ? (
          <SignInRequired
            fullScreen={false}
            title="Sign in to see your dashboard"
            description="Your sales, listings, and performance stats are only visible once you're signed in."
          />
        ) : error && error !== "signed-out" ? (
          <div className="sd-empty-state" style={{ gridColumn: "1/-1" }}>
            <p>Couldn&apos;t load your dashboard.</p>
            <p style={{ marginTop: 4, color: "rgba(255,255,255,0.35)", fontSize: 12 }}>{error}</p>
          </div>
        ) : (
          <>
            <div className="sd-kpi-grid" id="sdKpiGrid">
              {kpis.map((kpi) => (
                <div className={`sd-kpi-card ${kpi.accent}`} key={kpi.label}>
                  <div className="kpi-icon">{kpi.icon}</div>
                  <div className="kpi-label">{kpi.label}</div>
                  <div className="kpi-value">{kpi.value}</div>
                </div>
              ))}
            </div>

            <div className="sd-charts-row">
              <div className="sd-chart-card">
                <div className="chart-head">
                  <h4>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx={12} cy={12} r={3} />
                    </svg>
                    Traffic
                  </h4>
                  <span className="chart-pill" id="sdChartPill1">
                    {trafficChart?.pill || "Loading…"}
                  </span>
                </div>
                <div className="sd-chart-wrap">
                  {trafficChart ? <DashboardChart config={trafficChart.config} /> : null}
                </div>
              </div>
              <div className="sd-chart-card">
                <div className="chart-head">
                  <h4>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <circle cx={12} cy={12} r={10} />
                      <path d="M8 12h8M12 8v8" />
                    </svg>
                    Revenue
                  </h4>
                  <span className="chart-pill" id="sdChartPill2">
                    {revenueChartCfg?.pill || "Loading…"}
                  </span>
                </div>
                <div className="sd-chart-wrap">
                  {revenueChartCfg ? <DashboardChart config={revenueChartCfg.config} /> : null}
                </div>
              </div>
            </div>

            <div className="sd-quick-stats" id="sdQuickStats">
              <div className="sd-quick-stat">
                <div className="qs-val">{quickStats.avgOrderValue}</div>
                <div className="qs-label">Avg Order Value</div>
              </div>
              <div className="sd-quick-stat">
                <div className="qs-val">{quickStats.completedDeals}</div>
                <div className="qs-label">Completed Deals</div>
              </div>
              <div className="sd-quick-stat">
                <div className="qs-val">{quickStats.topListingTitle}</div>
                <div className="qs-label">Top Listing</div>
              </div>
              <div className="sd-quick-stat">
                <div className="qs-val">{quickStats.totalDeals}</div>
                <div className="qs-label">Total Deals (range)</div>
              </div>
            </div>

            <div className="sd-table-section">
              <div className="sd-table-card">
                <div className="sd-table-header">
                  <h4>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                      <circle cx={9} cy={7} r={4} />
                      <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
                    </svg>
                    Recent Deals
                  </h4>
                  <span className="table-badge" id="sdDealCount">
                    {loading ? "…" : `${(dealsData?.deals || []).length} deal${(dealsData?.deals || []).length !== 1 ? "s" : ""}`}
                  </span>
                </div>
                <div className="sd-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Listing</th>
                        <th>Buyer</th>
                        <th>Amount</th>
                        <th>Status</th>
                        <th>Date</th>
                      </tr>
                    </thead>
                    <tbody id="sdDealTableBody">
                      {!dealsData || loading ? (
                        <tr>
                          <td colSpan={5} className="sd-table-empty">Loading…</td>
                        </tr>
                      ) : dealsData.deals.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="sd-table-empty">No deals in this period yet.</td>
                        </tr>
                      ) : (
                        dealsData.deals.map((d) => (
                          <tr key={d.dealId}>
                            <td>{d.listingTitle}</td>
                            <td>{d.buyerName ? `@${d.buyerName}` : "—"}</td>
                            <td>{formatCurrency(d.amount, formatFinFull)}</td>
                            <td>
                              <span className={`td-status ${d.status}`}>{STATUS_LABELS[d.status] || d.status}</span>
                            </td>
                            <td>{formatDate(d.createdAt)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="sd-table-section">
              <div className="sd-table-card">
                <div className="sd-table-header">
                  <h4>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <rect x={3} y={3} width={7} height={7} rx={1} />
                      <rect x={14} y={3} width={7} height={7} rx={1} />
                      <rect x={3} y={14} width={7} height={7} rx={1} />
                      <rect x={14} y={14} width={7} height={7} rx={1} />
                    </svg>
                    Your Listings
                  </h4>
                  <span className="table-badge" id="sdListingCount">
                    {loading ? "…" : `${(listings || []).length} listing${(listings || []).length !== 1 ? "s" : ""}`}
                  </span>
                </div>
                <div className="sd-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Title</th>
                        <th>Status</th>
                        <th>Impressions</th>
                        <th>Views</th>
                        <th>Clicks</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody id="sdListingTableBody">
                      {!listings || loading ? (
                        <tr>
                          <td colSpan={6} className="sd-table-empty">Loading…</td>
                        </tr>
                      ) : listings.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="sd-table-empty">You haven&apos;t listed anything yet.</td>
                        </tr>
                      ) : (
                        listings.map((l) => {
                          const daysLeft = boostDaysLeft(l);
                          const boosted = daysLeft !== null;
                          return (
                          <tr key={l.id}>
                            <td>{l.title || "Untitled"}</td>
                            <td>
                              <span className={`td-status ${l.status || "active"}`}>{titleCase(l.status || "active")}</span>
                              {boosted ? (
                                <span
                                  className="td-status"
                                  style={{
                                    marginLeft: 6, background: "rgba(163,230,53,0.14)", color: "#a3e635",
                                    border: "1px solid rgba(163,230,53,0.35)",
                                  }}
                                  title={`Boosted — ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}
                                >
                                  Boosted · {daysLeft}d left
                                </span>
                              ) : null}
                            </td>
                            <td>{formatNumber(l.impressionCount || 0)}</td>
                            <td>{formatNumber(l.viewCount || 0)}</td>
                            <td>{formatNumber((l.successfulClickCount || 0) + (l.failedClickCount || 0))}</td>
                            <td>
                              {boosted ? (
                                <button
                                  type="button"
                                  className="sd-listing-boost-btn sd-listing-unboost-btn"
                                  disabled={unboostingId === l.id}
                                  onClick={() => handleUnboost(l.id)}
                                >
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M18 6L6 18M6 6l12 12" />
                                  </svg>
                                  {unboostingId === l.id ? "Stopping…" : "Stop Boost"}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="sd-listing-boost-btn"
                                  onClick={() =>
                                    openBoost(l.id, { title: l.title, type: l.type, images: l.images, imageCover: l.imageCover })
                                  }
                                >
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
                                  </svg>
                                  Boost
                                </button>
                              )}
                            </td>
                          </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {dateModalOpen ? (
        <div
          className="sd-modal-overlay active"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDateModalOpen(false);
          }}
        >
          <div className="sd-modal-card sd-date-modal-card">
            <div className="sd-modal-header">
              <h2>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <rect x={3} y={4} width={18} height={18} rx={2} />
                  <path d="M16 2v4M8 2v4M3 10h18" />
                </svg>
                Date Range
              </h2>
              <button className="sd-modal-close" id="sdDateModalClose" aria-label="Close" onClick={() => setDateModalOpen(false)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <line x1={18} y1={6} x2={6} y2={18} />
                  <line x1={6} y1={6} x2={18} y2={18} />
                </svg>
              </button>
            </div>
            <div className="sd-range-grid" id="sdRangeGrid">
              {RANGE_ORDER.map((r) => (
                <button
                  key={r}
                  className={`sd-range-card${pendingRange === r ? " active" : ""}`}
                  data-range={r}
                  onClick={() => setPendingRange(r)}
                >
                  <span className="rc-label">{RANGE_LABELS[r].label}</span>
                  {RANGE_LABELS[r].sub ? <span className="rc-sub">{RANGE_LABELS[r].sub}</span> : null}
                </button>
              ))}
            </div>
            <button className="sd-btn sd-btn-primary sd-date-save-btn" id="sdDateSaveBtn" onClick={saveDateRange}>
              Save
            </button>
          </div>
        </div>
      ) : null}

      <DashboardWebhooksModal open={webhooksOpen} onClose={() => setWebhooksOpen(false)} />
      <ConfirmHost />
    </div>
  );
}

const iconGrid = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <rect x={3} y={3} width={7} height={7} rx={1} />
    <rect x={14} y={3} width={7} height={7} rx={1} />
    <rect x={3} y={14} width={7} height={7} rx={1} />
    <rect x={14} y={14} width={7} height={7} rx={1} />
  </svg>
);
const iconEye = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx={12} cy={12} r={3} />
  </svg>
);
const iconTarget = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M3 12l7-7 7 7-7 7-7-7z" />
    <path d="M12 19v-7" />
  </svg>
);
const iconUsers = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
    <circle cx={9} cy={7} r={4} />
    <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
  </svg>
);
const iconDollar = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <circle cx={12} cy={12} r={10} />
    <path d="M8 12h8M12 8v8" />
  </svg>
);
const iconTrend = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
    <polyline points="17 6 23 6 23 12" />
  </svg>
);
