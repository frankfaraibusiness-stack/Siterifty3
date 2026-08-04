"use client";

import { useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type { SettingsState } from "@/lib/useSettingsState";
import { useSrToast } from "@/components/system/SrToastProvider";

const SaveIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <path d="M9 12l2 2 4-4" />
    <path d="M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z" />
  </svg>
);

const PayPalIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="#009cde">
    <path d="M7.076 21.337H2.47a.641.641 0 0 1-.633-.74L4.944.901C5.026.382 5.474 0 5.998 0h7.46c2.57 0 4.578.543 5.69 1.81 1.01 1.15 1.304 2.42 1.012 4.287-.023.143-.047.291-.077.443v.03c-.618 3.425-2.716 5.142-5.768 5.142H12.7a.645.645 0 0 0-.633.54l-.995 6.306a.641.641 0 0 1-.633.54H7.076z" />
  </svg>
);

export default function PaymentsPanel({
  state,
  setState,
}: {
  state: SettingsState;
  setState: React.Dispatch<React.SetStateAction<SettingsState>>;
}) {
  const { show: toast } = useSrToast();
  const [paypalEmail, setPaypalEmail] = useState(state.paypalEmail);
  const [saving, setSaving] = useState(false);

  // Ports savePaypalBtn's handler — same validation (must contain '@'),
  // direct Firestore write, same as the original.
  async function handleSave() {
    const user = auth.currentUser;
    if (!user) return;
    const email = paypalEmail.trim();
    if (!email || !email.includes("@")) {
      toast("Please enter a valid PayPal email.", "error");
      return;
    }
    setSaving(true);
    try {
      await updateDoc(doc(db, "users", user.uid), { paypalEmail: email });
      setState((prev) => ({ ...prev, paypalEmail: email }));
      toast("PayPal account saved.", "success");
    } catch (err: any) {
      toast(`Save failed: ${err.message}`, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="detail-panel-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="12" y1="1" x2="12" y2="23" />
          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
        <h3>Payment Methods</h3>
      </div>
      <p className="detail-panel-desc">Add your PayPal email to receive withdrawal payouts. This isn&apos;t used to add funds to your wallet — wallet balance is only ever used to boost your own listings.</p>
      <hr className="detail-divider" />

      {state.paypalEmail ? (
        <div className="info-card" style={{ borderColor: "rgba(0,112,191,0.3)" }}>
          <PayPalIcon />
          <span className="info-text">
            <strong>PayPal Connected:</strong> {state.paypalEmail}
          </span>
        </div>
      ) : null}

      <div className="input-group">
        <label>PayPal Email</label>
        <input
          className="input-field"
          type="email"
          value={paypalEmail}
          onChange={(e) => setPaypalEmail(e.target.value)}
          placeholder="your@paypal.com"
        />
        <span className="hint">Used for withdrawal payouts. Wallet balance can&apos;t be topped up with PayPal and can&apos;t be sent to other users.</span>
      </div>

      <button className="save-btn" onClick={handleSave} disabled={saving}>
        <SaveIcon />
        {saving ? "Saving…" : "Save PayPal Account"}
      </button>

      <hr className="detail-divider" />

      <div className="info-card" style={{ borderColor: "#2a2a2a", opacity: 0.55 }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2">
          <rect x="1" y="4" width="22" height="16" rx="2" />
          <line x1="1" y1="10" x2="23" y2="10" />
        </svg>
        <span className="info-text" style={{ color: "#666" }}>
          <strong>Credit / Debit Card</strong> —{" "}
          <span
            style={{
              background: "#2a2a2a",
              color: "#888",
              padding: "2px 8px",
              borderRadius: 4,
              fontSize: "0.72rem",
              fontWeight: 700,
              letterSpacing: "0.04em",
            }}
          >
            COMING SOON
          </span>
        </span>
      </div>

    </>
  );
}
