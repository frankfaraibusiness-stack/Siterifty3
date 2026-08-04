"use client";

import type { Listing } from "@/lib/listings";
import { useCurrency } from "@/lib/CurrencyContext";

// Ports the shared `finHtml` block from mpOpenModal exactly — same fields,
// same fallback dash, same profit/loss color class logic. All figures
// convert to the visitor's selected display currency (see
// CurrencyContext's top comment — these are display estimates only;
// deals always settle in USD via app/api/paypal/_handler.js regardless
// of what's shown here).
export default function FinancialsBlock({ listing, accentColor }: { listing: Listing; accentColor: string }) {
  const fin = listing.financials || {};
  const { currency, formatPrice, formatFinFull } = useCurrency();
  const priceStr = typeof fin.price === "number" ? formatPrice(fin.price) : "—";
  const revenue = fin.revenue !== undefined ? formatFinFull(Number(fin.revenue)) : "—";
  const expenses = fin.expenses !== undefined ? formatFinFull(Number(fin.expenses)) : "—";
  const profit = fin.profit !== undefined ? formatFinFull(Number(fin.profit)) : "—";
  const profitNum = fin.profit !== undefined ? Number(fin.profit) : null;
  const profitCls = profitNum !== null && profitNum >= 0 ? " profit" : profitNum !== null ? " loss" : "";

  return (
    <div className="modal-section">
      <div className="modal-section-title with-icon">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={accentColor} strokeWidth="2.2">
          <line x1="12" y1="1" x2="12" y2="23" />
          <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
        </svg>
        Financials
        {currency !== "USD" && (
          <span style={{ fontSize: "0.65rem", color: "#777", fontWeight: 400, marginLeft: 6 }}>
            (shown in {currency} — deals settle in USD)
          </span>
        )}
      </div>
      <div className="modal-financials">
        <div className="fin-card">
          <span className="fin-label">Asking Price</span>
          <span className="fin-value">{priceStr}</span>
        </div>
        <div className="fin-card">
          <span className="fin-label">Monthly Revenue</span>
          <span className="fin-value">{revenue}</span>
        </div>
        <div className="fin-card">
          <span className="fin-label">Monthly Expenses</span>
          <span className="fin-value">{expenses}</span>
        </div>
        <div className="fin-card">
          <span className="fin-label">Monthly Profit</span>
          <span className={`fin-value${profitCls}`}>{profit}</span>
        </div>
        {fin.model ? (
          <div className="fin-card full">
            <span className="fin-label">Revenue Model</span>
            <span className="fin-value">{fin.model}</span>
          </div>
        ) : null}
        {fin.subMonthly ? (
          <div className="fin-card">
            <span className="fin-label">Sub / Month</span>
            <span className="fin-value">{formatFinFull(Number(fin.subMonthly))}</span>
          </div>
        ) : null}
        {fin.subAnnual ? (
          <div className="fin-card">
            <span className="fin-label">Sub / Year</span>
            <span className="fin-value">{formatFinFull(Number(fin.subAnnual))}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
