"use client";

import { useEffect, useState } from "react";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/lib/AuthContext";
import { useWalletModal } from "@/components/wallet/WalletModalProvider";
import { useLimits } from "@/lib/useLimits";
import { useCurrency } from "@/lib/CurrencyContext";

// Ports the Boost purchase modal from Js/sellers-transfer.js (index.html
// lines 25383-25548 + #boostOverlay markup) — window.__openBoostModal.
//
// Prices are display-only copy; the price actually charged is enforced
// server-side in /api/paypal's handleBoostListing (reading
// LIMITS.boost.plans). BOOST_PLANS_META below now only carries label/
// badge — display-only content with no LIMITS equivalent (days/price
// come live from useLimits() inside the component and are merged with
// this by `days`), so there's nothing left here to fall out of sync.
const BOOST_PLANS_META: Record<number, { label: string; badge?: "popular" | "best" }> = {
  1: { label: "1 day" },
  3: { label: "3 days" },
  7: { label: "7 days", badge: "popular" },
  14: { label: "14 days" },
  21: { label: "21 days" },
  30: { label: "30 days", badge: "best" },
};
// Fallback plan list — used only until useLimits() resolves live values
// from GET /api/limits (LIMITS.boost.plans). Same numbers as that source.
const FALLBACK_BOOST_PLANS = [
  { days: 1, price: 2.99 },
  { days: 3, price: 6.99 },
  { days: 7, price: 12.99 },
  { days: 14, price: 19.99 },
  { days: 21, price: 27.99 },
  { days: 30, price: 34.99 },
];

// Submit flow mirrors the original exactly: check wallet balance
// client-side first (nicer error with an "Add Funds" shortcut into the
// wallet modal), then POST /api/paypal { action: 'boost-listing',
// listingId, days }, then refresh the live wallet balance (via
// AuthContext's onSnapshot — no manual refresh call needed here, unlike
// the original's window.__refreshWallet, since profile.walletBalance
// already streams live).

export interface BoostListingData {
  title?: string;
  type?: string;
  images?: string[];
  imageCover?: string;
}

export default function BoostModal({
  open,
  onClose,
  listingId,
  listing,
}: {
  open: boolean;
  onClose: () => void;
  listingId: string | null;
  listing?: BoostListingData | null;
}) {
  const { profile } = useAuth();
  const { openWallet } = useWalletModal();
  const { limits } = useLimits();
  const { currency, formatBalance } = useCurrency();

  const livePlans = limits.boost.plans?.length ? limits.boost.plans : FALLBACK_BOOST_PLANS;
  const BOOST_PLANS = livePlans.map((p) => ({
    days: p.days,
    price: p.price,
    label: BOOST_PLANS_META[p.days]?.label ?? `${p.days} days`,
    badge: BOOST_PLANS_META[p.days]?.badge,
  }));

  const [selected, setSelected] = useState<{ days: number; price: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Reset selection each time the modal opens for a (possibly different) listing.
  useEffect(() => {
    if (open) {
      setSelected(null);
      setErrMsg("");
      setSuccessMsg("");
      setSubmitting(false);
    }
  }, [open, listingId]);

  if (!open) return null;

  const walletBalance = Number(profile?.walletBalance || 0);
  const thumb = listing?.images?.[2] || listing?.images?.[0] || listing?.imageCover || "";
  const typeLabel = listing?.type ? listing.type[0].toUpperCase() + listing.type.slice(1) : "Listing";

  async function handleSubmit() {
    if (!selected || !listingId) return;
    const user = auth.currentUser;
    if (!user) {
      setErrMsg("Please sign in to boost a listing.");
      return;
    }
    if (walletBalance < selected.price) {
      setErrMsg(
        `This boost costs $${selected.price.toFixed(2)} USD but your wallet has $${walletBalance.toFixed(2)} USD. Add funds to continue.`
      );
      return;
    }

    setSubmitting(true);
    setErrMsg("");
    try {
      const idToken = await user.getIdToken();
      const resp = await fetch("/api/paypal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "boost-listing", idToken, listingId, days: selected.days }),
      });
      const out = await resp.json();
      if (!resp.ok) throw new Error(out.error || "Boost failed");

      setSuccessMsg(
        `Your listing is now boosted for ${selected.days} day${selected.days !== 1 ? "s" : ""} and will get priority placement in the marketplace feed.`
      );
      setTimeout(() => {
        onClose();
      }, 1800);
    } catch (err: any) {
      setErrMsg(err?.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        background: "rgba(0,0,0,0.82)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        fontFamily: "inherit",
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 480,
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          background:
            "radial-gradient(120% 100% at 50% 0%, rgba(124,58,237,0.16) 0%, rgba(0,0,0,0) 55%), #060606",
          border: "1px solid #2a2a2a",
          borderRadius: 26,
          boxShadow: "0 30px 80px -20px rgba(124,58,237,0.35), 0 10px 40px -10px rgba(0,0,0,0.6)",
        }}
      >
        {/* Sticky header */}
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 5,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            background: "rgba(6,6,6,0.92)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            borderBottom: "1px solid #1e1e1e",
            padding: "17.6px 17.6px 17.6px 20px",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <div
              style={{
                width: 40,
                height: 40,
                flexShrink: 0,
                borderRadius: "50%",
                background: "linear-gradient(135deg, #7c3aed, #a855f7)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 6px 20px -5px rgba(168,85,247,0.6)",
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" style={{ width: 19, height: 19 }}>
                <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
              </svg>
            </div>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ fontSize: 16, fontWeight: 800, color: "#fff", margin: "0 0 2px", letterSpacing: "-0.01em", whiteSpace: "nowrap" }}>
                Boost This Listing
              </h2>
              <p style={{ fontSize: 11.5, color: "#8a8a8a", margin: 0, lineHeight: 1.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                Priority placement in the marketplace feed
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              flexShrink: 0,
              background: "#141416",
              border: "1px solid #27272a",
              color: "#a1a1aa",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" style={{ width: 15, height: 15 }}>
              <line x1={18} y1={6} x2={6} y2={18} />
              <line x1={6} y1={6} x2={18} y2={18} />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div data-scroll-lock-exempt style={{ overflowY: "auto", padding: "20px 24px 24px" }}>
          {/* Listing chip */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9.6,
              background: "#0d0d0d",
              border: "1px solid #262626",
              borderRadius: 16,
              padding: "9.6px 12px",
              marginBottom: 20.8,
            }}
          >
            {thumb ? (
              <img src={thumb} alt="" style={{ width: 38, height: 38, borderRadius: 9.6, objectFit: "cover", background: "#1a1a1a", flexShrink: 0 }} />
            ) : (
              <div style={{ width: 38, height: 38, borderRadius: 9.6, background: "#1a1a1a", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="#444" strokeWidth={1.5} style={{ width: 16, height: 16 }}>
                  <rect x={3} y={3} width={18} height={18} rx={2} />
                  <path d="M3 9h18M9 21V9" />
                </svg>
              </div>
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12.8, fontWeight: 700, color: "#eee", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {listing?.title || "Listing"}
              </div>
              <div style={{ fontSize: 10.9, color: "#666" }}>{listing ? typeLabel : "Choose a boost duration below"}</div>
            </div>
          </div>

          {/* Plans */}
          <div style={{ display: "flex", flexDirection: "column", gap: 9.6, marginBottom: 20.8 }}>
            {BOOST_PLANS.map((p) => {
              const isSelected = selected?.days === p.days;
              return (
                <div
                  key={p.days}
                  onClick={() => setSelected({ days: p.days, price: p.price })}
                  style={{
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    background: isSelected ? undefined : "#0a0a0a",
                    backgroundImage: isSelected
                      ? "linear-gradient(135deg, rgba(124,58,237,0.14), rgba(168,85,247,0.06))"
                      : undefined,
                    border: `1.5px solid ${isSelected ? "#a855f7" : "#262626"}`,
                    borderRadius: 17.6,
                    padding: "13.6px 16px",
                    cursor: "pointer",
                    boxShadow: isSelected ? "0 0 0 1px rgba(168,85,247,0.35)" : undefined,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                    <div
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: "50%",
                        flexShrink: 0,
                        border: `2px solid ${isSelected ? "#a855f7" : "#3a3a3a"}`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {isSelected && <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#a855f7" }} />}
                    </div>
                    <div>
                      <div style={{ fontSize: 14.7, fontWeight: 800, color: "#fff", lineHeight: 1.1 }}>{p.label}</div>
                      <div style={{ fontSize: 10.9, color: "#777", marginTop: 2 }}>{formatBalance(p.price / p.days)}/day</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    {p.badge === "best" && (
                      <span style={{ fontSize: 9.6, fontWeight: 800, letterSpacing: "0.03em", padding: "3px 8px", borderRadius: 100, whiteSpace: "nowrap", background: "rgba(163,230,53,0.14)", color: "#a3e635", border: "1px solid rgba(163,230,53,0.3)" }}>
                        BEST VALUE
                      </span>
                    )}
                    {p.badge === "popular" && (
                      <span style={{ fontSize: 9.6, fontWeight: 800, letterSpacing: "0.03em", padding: "3px 8px", borderRadius: 100, whiteSpace: "nowrap", background: "rgba(168,85,247,0.14)", color: "#c084fc", border: "1px solid rgba(168,85,247,0.3)" }}>
                        POPULAR
                      </span>
                    )}
                    <div style={{ fontSize: 16, fontWeight: 800, color: "#fff" }} title={`$${p.price.toFixed(2)} USD`}>{formatBalance(p.price)}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {errMsg && (
            <div
              style={{
                marginBottom: 14,
                padding: "10px 14px",
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.25)",
                borderRadius: 10,
                color: "#fca5a5",
                fontSize: 12.8,
                fontWeight: 600,
              }}
            >
              {errMsg}
              {walletBalance < (selected?.price || 0) && (
                <div style={{ marginTop: 8 }}>
                  <button
                    onClick={() => {
                      onClose();
                      openWallet();
                    }}
                    style={{
                      background: "rgba(163,230,53,0.14)",
                      border: "1px solid rgba(163,230,53,0.3)",
                      color: "#a3e635",
                      padding: "6px 12px",
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Add Funds
                  </button>
                </div>
              )}
            </div>
          )}

          {successMsg && (
            <div
              style={{
                marginBottom: 14,
                padding: 14,
                background: "rgba(163,230,53,0.1)",
                border: "1px solid rgba(163,230,53,0.3)",
                borderRadius: 10,
                color: "#a3e635",
                fontSize: 13,
                fontWeight: 700,
                textAlign: "center",
              }}
            >
              ✓ Listing Boosted — {successMsg}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={!selected || submitting || !!successMsg}
            style={{
              position: "relative",
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              background: "linear-gradient(135deg, #5b21b6 0%, #7c3aed 55%, #6d28d9 100%)",
              border: "1px solid #8b5cf6",
              color: "#fff",
              fontFamily: "inherit",
              fontSize: 13.6,
              fontWeight: 800,
              letterSpacing: "0.02em",
              padding: "14.4px 16px",
              borderRadius: 100,
              cursor: !selected || submitting || successMsg ? "not-allowed" : "pointer",
              overflow: "hidden",
              boxShadow: "0 8px 26px -6px rgba(124,58,237,0.6), inset 0 1px 0 rgba(255,255,255,0.12)",
              opacity: !selected || submitting || successMsg ? 0.55 : 1,
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" style={{ width: 15, height: 15, flexShrink: 0 }}>
              <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
            </svg>
            <span>
              {submitting ? "Processing…" : selected ? `Boost for $${selected.price.toFixed(2)} USD` : "Select a plan"}
            </span>
          </button>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5.6, fontSize: 11.5, color: "#777", marginTop: 11.2 }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth={2} style={{ width: 13, height: 13 }}>
              <rect x={1} y={4} width={22} height={16} rx={2} />
              <line x1={1} y1={10} x2={23} y2={10} />
            </svg>
            Charged from your wallet balance: <b style={{ color: "#a3e635", fontWeight: 700 }}>{formatBalance(walletBalance)}</b>
            {currency !== "USD" && <span style={{ color: "#555" }}>&nbsp;(${walletBalance.toFixed(2)} USD)</span>}
          </div>
          <div style={{ textAlign: "center", fontSize: 10.9, color: "#555", marginTop: 12.8, lineHeight: 1.4 }}>
            Boosted listings are prioritized in feed ordering while active. No refunds once a boost starts.
          </div>
        </div>
      </div>
    </div>
  );
}
