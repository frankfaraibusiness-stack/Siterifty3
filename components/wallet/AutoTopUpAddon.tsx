"use client";

import { useEffect, useState } from "react";
import { auth } from "@/lib/firebase";
import { useLimits } from "@/lib/useLimits";

// Ports the AUTO TOP-UP section from wallet.js (autotopup-get/-save).
// Live bounds now come from useLimits() (GET /api/limits,
// LIMITS.autoTopUp). FALLBACK_* match app/api/_lib/limits.js's
// autoTopUp block exactly (minThreshold:1, maxThreshold:5000,
// minAmount:5, maxAmount:10000) and are used only until that fetch
// resolves. Markup mirrors index.html's #atuCard structure
// (.agent-toggle-card / .agent-sw / .wallet-amount-currency) so
// globals.css's rules apply instead of duplicating the look inline.
const FALLBACK_MIN_THRESHOLD = 1;
const FALLBACK_MAX_THRESHOLD = 5000;
const FALLBACK_MIN_AMOUNT = 5;
const FALLBACK_MAX_AMOUNT = 10000;

export default function AutoTopUpAddon() {
  const { limits } = useLimits();
  const MIN_THRESHOLD = limits.autoTopUp.minThreshold ?? FALLBACK_MIN_THRESHOLD;
  const MAX_THRESHOLD = limits.autoTopUp.maxThreshold ?? FALLBACK_MAX_THRESHOLD;
  const MIN_AMOUNT = limits.autoTopUp.minAmount ?? FALLBACK_MIN_AMOUNT;
  const MAX_AMOUNT = limits.autoTopUp.maxAmount ?? FALLBACK_MAX_AMOUNT;

  const [loaded, setLoaded] = useState(false);
  const [hasVault, setHasVault] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [threshold, setThreshold] = useState("");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: "ok" | "err" | "" }>({ text: "", kind: "" });

  useEffect(() => {
    loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadSettings() {
    const user = auth.currentUser;
    if (!user) return;
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/paypal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "autotopup-get", idToken }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not load auto top-up settings");
      setLoaded(true);
      setHasVault(Boolean(d.hasVault));
      setEnabled(Boolean(d.enabled));
      setThreshold(d.threshold ? d.threshold.toFixed(2) : "");
      setAmount(d.topUpAmount ? d.topUpAmount.toFixed(2) : "");
    } catch (err) {
      console.error("[autotopup get]", err);
    }
  }

  function handleToggle(checked: boolean) {
    setEnabled(checked);
    if (checked && !hasVault) {
      setMsg({ text: "Make one PayPal deposit first so we have a saved payment method to auto-charge.", kind: "err" });
    } else {
      setMsg({ text: "", kind: "" });
    }
  }

  async function handleSave() {
    setMsg({ text: "", kind: "" });
    const th = parseFloat(threshold);
    const amt = parseFloat(amount);

    if (enabled) {
      if (!hasVault) {
        setMsg({ text: "Make one PayPal deposit first so we have a saved payment method to auto-charge.", kind: "err" });
        return;
      }
      if (!th || th < MIN_THRESHOLD || th > MAX_THRESHOLD) {
        setMsg({ text: `Threshold must be between $${MIN_THRESHOLD} and $${MAX_THRESHOLD.toLocaleString()}.`, kind: "err" });
        return;
      }
      if (!amt || amt < MIN_AMOUNT || amt > MAX_AMOUNT) {
        setMsg({ text: `Top-up amount must be between $${MIN_AMOUNT} and $${MAX_AMOUNT.toLocaleString()}.`, kind: "err" });
        return;
      }
    }

    setSaving(true);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Not signed in");
      const idToken = await user.getIdToken();
      const res = await fetch("/api/paypal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "autotopup-save", idToken, enabled, threshold: th, topUpAmount: amt }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Could not save auto top-up settings");

      setMsg({ text: enabled ? "✓ Auto top-up enabled." : "✓ Auto top-up disabled.", kind: "ok" });
    } catch (err: any) {
      console.error("[autotopup save]", err);
      setMsg({ text: err.message || "Something went wrong. Please try again.", kind: "err" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="agent-toggle-card" id="atuCard" style={{ cursor: "default" }}>
        <div className="agent-toggle-icon" style={{ background: "rgba(163,230,53,.12)", color: "#a3e635" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="agent-toggle-meta">
          <div className="agent-toggle-title">Auto Top-Up</div>
          <div className="agent-toggle-desc">
            Automatically add funds from your saved PayPal method whenever your balance drops below your threshold.
          </div>

          <div id="atuExtra" className={`agent-toggle-extra${enabled ? " visible" : ""}`}>
            <div className="agent-threshold-row">
              <span className="agent-threshold-label">When balance drops below</span>
              <span className="wallet-amount-currency" style={{ fontSize: 12 }}>$</span>
              <input
                id="atuThreshold"
                className="agent-threshold-input"
                type="number"
                min={MIN_THRESHOLD}
                max={MAX_THRESHOLD}
                step="0.01"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                placeholder="25.00"
              />
            </div>
            <div className="agent-threshold-row" style={{ marginTop: 8 }}>
              <span className="agent-threshold-label">Top up by</span>
              <span className="wallet-amount-currency" style={{ fontSize: 12 }}>$</span>
              <input
                id="atuAmount"
                className="agent-threshold-input"
                type="number"
                min={MIN_AMOUNT}
                max={MAX_AMOUNT}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="50.00"
              />
            </div>
          </div>
        </div>
        <label className="agent-sw">
          <input id="atuToggle" type="checkbox" checked={enabled} onChange={(e) => handleToggle(e.target.checked)} />
          <span className="agent-sw-track" />
          <span className="agent-sw-thumb" />
        </label>
      </div>

      {loaded && !hasVault ? (
        <div id="atuVaultHint" style={{ marginTop: 14, fontSize: 11, lineHeight: 1.5, color: "rgba(255,255,255,.35)" }}>
          Make one PayPal deposit first so we have a saved payment method to auto-charge.
        </div>
      ) : null}

      {msg.text ? <div id="atuMsg" className={`wallet-msg${msg.kind ? ` ${msg.kind}` : ""}`}>{msg.text}</div> : <div id="atuMsg" className="wallet-msg" />}
      <button className="wallet-submit-btn" id="atuSubmit" style={{ marginTop: 14 }} onClick={handleSave} disabled={saving}>
        <span>{saving ? "Saving…" : "Save Settings"}</span>
      </button>
    </div>
  );
}
