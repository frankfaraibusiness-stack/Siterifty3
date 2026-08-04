"use client";

import { useEffect, useState } from "react";
import { auth } from "@/lib/firebase";
import { useLimits } from "@/lib/useLimits";

// Ports the AUTO WITHDRAWAL section from wallet.js (autowithdraw-get/
// -save). Live bounds now come from useLimits() (GET /api/limits,
// LIMITS.autoWithdraw). FALLBACK_* match app/api/_lib/limits.js's
// autoWithdraw block exactly (minThreshold:10, maxThreshold:10000,
// minKeepBalance:0, maxKeepBalance:10000) and are used only until that
// fetch resolves. Markup mirrors index.html's #awdCard structure
// (.agent-toggle-card / .agent-sw / .wallet-method-card) so
// globals.css's rules apply instead of duplicating the look inline.
const FALLBACK_MIN_THRESHOLD = 10;
const FALLBACK_MAX_THRESHOLD = 10000;
const FALLBACK_MIN_KEEP = 0;
const FALLBACK_MAX_KEEP = 10000;

export default function AutoWithdrawAddon({ onEnabled }: { onEnabled: () => void }) {
  const { limits } = useLimits();
  const MIN_THRESHOLD = limits.autoWithdraw.minThreshold ?? FALLBACK_MIN_THRESHOLD;
  const MAX_THRESHOLD = limits.autoWithdraw.maxThreshold ?? FALLBACK_MAX_THRESHOLD;
  const MIN_KEEP = limits.autoWithdraw.minKeepBalance ?? FALLBACK_MIN_KEEP;
  const MAX_KEEP = limits.autoWithdraw.maxKeepBalance ?? FALLBACK_MAX_KEEP;

  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [threshold, setThreshold] = useState("");
  const [keepBalance, setKeepBalance] = useState("");
  const [method, setMethod] = useState<"paypal" | "bank">("paypal");
  const [paypalEmail, setPaypalEmail] = useState("");
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
        body: JSON.stringify({ action: "autowithdraw-get", idToken }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not load auto withdrawal settings");
      setLoaded(true);
      setEnabled(Boolean(d.enabled));
      setThreshold(d.threshold ? d.threshold.toFixed(2) : "");
      setKeepBalance(d.keepBalance != null ? Number(d.keepBalance).toFixed(2) : "");
      setPaypalEmail(d.paypalEmail || user.email || "");
      setMethod(d.method === "bank" ? "bank" : "paypal");
    } catch (err) {
      console.error("[autowithdraw get]", err);
    }
  }

  async function handleSave() {
    setMsg({ text: "", kind: "" });
    const th = parseFloat(threshold);
    const keep = keepBalance === "" ? 0 : parseFloat(keepBalance);

    if (enabled) {
      if (!paypalEmail.trim() || !paypalEmail.includes("@")) {
        setMsg({ text: "Enter a valid payout email.", kind: "err" });
        return;
      }
      if (!th || th < MIN_THRESHOLD || th > MAX_THRESHOLD) {
        setMsg({ text: `Threshold must be between $${MIN_THRESHOLD} and $${MAX_THRESHOLD.toLocaleString()} USD.`, kind: "err" });
        return;
      }
      if (keep < MIN_KEEP || keep > MAX_KEEP) {
        setMsg({ text: `Keep-in-wallet amount must be between $${MIN_KEEP} and $${MAX_KEEP.toLocaleString()} USD.`, kind: "err" });
        return;
      }
      if (keep >= th) {
        setMsg({ text: "The amount you keep must be less than your threshold.", kind: "err" });
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
        body: JSON.stringify({
          action: "autowithdraw-save",
          idToken,
          enabled,
          threshold: th,
          keepBalance: keep,
          method,
          paypalEmail: paypalEmail.trim(),
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Could not save auto withdrawal settings");

      setMsg({ text: enabled ? "✓ Auto withdrawal enabled." : "✓ Auto withdrawal disabled.", kind: "ok" });
      // Enabling can trigger an immediate payout server-side if the user is
      // already over threshold — let the parent refresh balance/history.
      if (enabled) onEnabled();
    } catch (err: any) {
      console.error("[autowithdraw save]", err);
      setMsg({ text: err.message || "Something went wrong. Please try again.", kind: "err" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="agent-toggle-card" id="awdCard" style={{ cursor: "default" }}>
        <div className="agent-toggle-icon" style={{ background: "rgba(163,230,53,.12)", color: "#a3e635" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12l7 7 7-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="agent-toggle-meta">
          <div className="agent-toggle-title">Auto Withdrawal</div>
          <div className="agent-toggle-desc">
            Automatically cash out to your PayPal or bank once your withdrawable balance reaches your threshold.
          </div>

          <div id="awdExtra" className={`agent-toggle-extra${enabled ? " visible" : ""}`}>
            <div className="agent-threshold-row">
              <span className="agent-threshold-label">When withdrawable reaches (USD)</span>
              <span className="wallet-amount-currency" style={{ fontSize: 12 }}>$</span>
              <input
                id="awdThreshold"
                className="agent-threshold-input"
                type="number"
                min={MIN_THRESHOLD}
                max={MAX_THRESHOLD}
                step="0.01"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                placeholder="500.00"
              />
            </div>
            <div className="agent-threshold-row" style={{ marginTop: 8 }}>
              <span className="agent-threshold-label">Keep in wallet (USD)</span>
              <span className="wallet-amount-currency" style={{ fontSize: 12 }}>$</span>
              <input
                id="awdKeepBalance"
                className="agent-threshold-input"
                type="number"
                min={MIN_KEEP}
                max={MAX_KEEP}
                step="0.01"
                value={keepBalance}
                onChange={(e) => setKeepBalance(e.target.value)}
                placeholder="0.00"
              />
            </div>
          </div>
        </div>
        <label className="agent-sw">
          <input
            id="awdToggle"
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked);
              setMsg({ text: "", kind: "" });
            }}
          />
          <span className="agent-sw-track" />
          <span className="agent-sw-thumb" />
        </label>
      </div>

      {loaded && enabled ? (
        <div id="awdExtra2" style={{ marginTop: 14 }}>
          <div className="wallet-field-label">Payout method</div>
          <div id="awdMethodGrid">
            <button type="button" className={`wallet-method-card${method === "paypal" ? " active" : ""}`} data-awdmethod="paypal" onClick={() => setMethod("paypal")}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M7 5h8a4 4 0 010 8H9l-1 6H5l3-14z" />
                <path d="M11 9h6a3.5 3.5 0 010 7h-4" />
              </svg>
              <span>PayPal</span>
            </button>
            <button type="button" className={`wallet-method-card${method === "bank" ? " active" : ""}`} data-awdmethod="bank" onClick={() => setMethod("bank")}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M3 10l9-6 9 6" />
                <path d="M4 10v9h16v-9" />
                <path d="M9 21v-6h6v6" />
              </svg>
              <span>Bank</span>
            </button>
          </div>
          <div className="wallet-field-label" style={{ marginTop: 14 }}>Payout email</div>
          <input
            id="awdPaypalEmail"
            className="wallet-text-input"
            type="email"
            value={paypalEmail}
            onChange={(e) => setPaypalEmail(e.target.value)}
            placeholder="you@example.com"
          />
          <div className="wallet-hint" style={{ marginTop: 8 }}>
            Bank payouts route through PayPal's linked bank transfer — same email as your PayPal-linked account.
          </div>
        </div>
      ) : null}

      {msg.text ? <div id="awdMsg" className={`wallet-msg${msg.kind ? ` ${msg.kind}` : ""}`}>{msg.text}</div> : <div id="awdMsg" className="wallet-msg" />}
      <button className="wallet-submit-btn" id="awdSubmit" style={{ marginTop: 14 }} onClick={handleSave} disabled={saving}>
        <span>{saving ? "Saving…" : "Save Settings"}</span>
      </button>
    </div>
  );
}
