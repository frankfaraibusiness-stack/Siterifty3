"use client";

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type { SettingsState } from "@/lib/useSettingsState";
import { useSrToast } from "@/components/system/SrToastProvider";
import { useCurrency } from "@/lib/CurrencyContext";

const CopyIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const InfoIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);

// Ports renderReferrals() + its `case 'referrals':` handler. Stats
// (referralCount/referralEarned) are read directly off the user doc,
// same as the original — no dedicated API route for this exists in
// the source, so nothing was skipped here.
export default function ReferralsPanel({
  state,
}: {
  state: SettingsState;
  setState: React.Dispatch<React.SetStateAction<SettingsState>>;
}) {
  const { show: toast } = useSrToast();
  const { formatBalance, currency } = useCurrency();
  const [refCount, setRefCount] = useState<number | null>(null);
  const [refEarned, setRefEarned] = useState<number | null>(null);

  // /r/{username} is a real route now (app/r/[username]/page.tsx) that
  // redirects to /?r={username} — the format authActions.ts's
  // getReferralCode() actually reads at signup time. Kept as the
  // shareable /r/... form here (rather than handing out the raw
  // /?r=... link directly) since it's the nicer-looking, more shareable
  // URL; the redirect page is what bridges it to the format signup
  // expects.
  const refLink =
    typeof window !== "undefined"
      ? `${window.location.origin}/r/${state.username || "you"}`
      : `/r/${state.username || "you"}`;

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
          setRefCount(d.referralCount || 0);
          setRefEarned(d.referralEarned || 0);
        } else {
          setRefCount(0);
          setRefEarned(0);
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

  function copyLink() {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(refLink)
        .then(() => toast("Referral link copied!", "success"))
        .catch(() => toast("Could not copy — please copy manually.", "error"));
    } else {
      toast("Could not copy — please copy manually.", "error");
    }
  }

  return (
    <>
      <div className="detail-panel-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="#a3e635" strokeWidth="2">
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
        </svg>
        <h3>Referrals</h3>
      </div>
      <p className="detail-panel-desc">
        Invite developers and buyers to Siterifty. Earn 30% of their first subscription payment — credited to your
        wallet automatically.
      </p>
      <hr className="detail-divider" />

      <div
        className="info-card"
        style={{
          borderColor: "rgba(163,230,53,0.2)",
          background: "rgba(163,230,53,0.04)",
          flexDirection: "column",
          alignItems: "stretch",
          gap: "0.4rem",
        }}
      >
        <span
          className="info-text"
          style={{
            fontSize: "0.75rem",
            fontWeight: 700,
            color: "rgba(163,230,53,0.7)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          Your Referral Link
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <code
            style={{
              flex: 1,
              fontSize: "0.82rem",
              color: "rgba(163,230,53,0.9)",
              background: "rgba(0,0,0,0.4)",
              padding: "0.5rem 0.8rem",
              borderRadius: "0.6rem",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {refLink}
          </code>
          <button
            className="save-btn"
            style={{ padding: "0.5rem 0.9rem", fontSize: "0.78rem", whiteSpace: "nowrap" }}
            onClick={copyLink}
          >
            <CopyIcon /> Copy
          </button>
        </div>
      </div>

      <hr className="detail-divider" style={{ marginTop: "0.75rem" }} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "0.75rem" }}>
        <div style={{ background: "#0a0a0a", border: "1px solid #222", borderRadius: "0.9rem", padding: "1rem", textAlign: "center" }}>
          <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#a3e635", letterSpacing: "-0.03em" }}>
            {refCount ?? 0}
          </div>
          <div style={{ fontSize: "0.72rem", color: "#666", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 3 }}>
            Referrals
          </div>
        </div>
        <div style={{ background: "#0a0a0a", border: "1px solid #222", borderRadius: "0.9rem", padding: "1rem", textAlign: "center" }}>
          <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#60a5fa", letterSpacing: "-0.03em" }}>
            {formatBalance(refEarned ?? 0)}
          </div>
          <div style={{ fontSize: "0.72rem", color: "#666", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 3 }}>
            Earned
          </div>
        </div>
      </div>

      <div style={{ background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: "0.9rem", padding: "1rem", marginBottom: "0.75rem" }}>
        <div style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#555", marginBottom: "0.65rem" }}>
          Your Commission Per Plan
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
          {[
            { name: "Starter", price: 10, commission: 3.0 },
            { name: "Growth", price: 20, commission: 6.0 },
            { name: "Pro", price: 30, commission: 9.0 },
          ].map((p) => (
            <div key={p.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "0.82rem", color: "#aaa" }}>
                {p.name} <span style={{ color: "#555", fontSize: "0.72rem" }}>· {formatBalance(p.price).replace(/\.00$/, "")}/mo</span>
              </span>
              <span style={{ fontSize: "0.85rem", color: "#a3e635", fontWeight: 700 }}>
                {formatBalance(p.commission).replace(/\.00$/, "")} <span style={{ color: "#555", fontWeight: 400, fontSize: "0.7rem" }}>(30%)</span>
              </span>
            </div>
          ))}
        </div>
      </div>
      {currency !== "USD" && (
        <div style={{ fontSize: "0.68rem", color: "#555", marginTop: "-0.5rem", marginBottom: "0.75rem" }}>
          Plan prices and commissions billed in USD — shown converted to {currency}
        </div>
      )}

      <div className="info-card" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
        <InfoIcon />
        <span className="info-text" style={{ color: "#777" }}>
          You earn <strong style={{ color: "#fff" }}>30% of the first subscription payment</strong> when someone
          subscribes to any paid plan via your link. Payouts land in your wallet instantly after PayPal confirms the
          charge.
        </span>
      </div>

    </>
  );
}
