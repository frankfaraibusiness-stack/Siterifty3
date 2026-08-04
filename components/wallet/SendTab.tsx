"use client";

// Ports the SEND (P2P transfer) section from wallet.js.
//
// ── DISABLED (2026-07-25) ─────────────────────────────────────────────────
// Sending wallet balance to another user (and Auto Send, which is the same
// transfer on a schedule) moves real ledger money between two ordinary
// users with no PayPal (or other licensed) rail involved — that's
// custodial money transmission, which Siterifty isn't currently licensed
// for. Wallet balance is licensed-safe only as a spend-only credit for
// boosting your own listings. This tab is now a placeholder, matching the
// existing Deposit tab's pattern, until Siterifty completes money-
// transmission licensing — nothing is deleted: the original form, the
// live recipient-lookup UI, and AutoSendAddon are all still in this
// directory and the backend's `transfer` action still exists (see
// app/api/paypal/_handler.js), just gated behind a 410 response. Re-enable
// by restoring this file's previous body and deleting that gate.
// ─────────────────────────────────────────────────────────────────────────
export default function SendTab({ active }: { active: boolean; balance?: number; onSuccess?: () => void }) {
  return (
    <div className={`wallet-panel${active ? " active" : ""}`} id="walletPanelSend">
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          gap: 10,
          padding: "2.2rem 1rem",
          border: "1px dashed rgba(255,255,255,0.14)",
          borderRadius: 14,
          background: "rgba(255,255,255,0.02)",
        }}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
        </svg>
        <div style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.85)" }}>Send Money is unavailable</div>
        <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.45)", maxWidth: 340, lineHeight: 1.5 }}>
          Your Siterifty wallet balance can currently only be used to boost your own listings — it can&apos;t be
          sent to other users or withdrawn. PayPal handles the full escrow-protected payment for marketplace
          purchases. This feature will return once Siterifty completes money-transmission licensing.
        </div>
      </div>
    </div>
  );
}
