"use client";

import { useEffect, useState } from "react";
import { useScrollLock } from "@/lib/useScrollLock";

// Full-screen takeover shown while the seller's "Request Payment" send is
// in flight. Spins for a fixed 3s (matches the requested UX beat — long
// enough to read as "sending", not just a flash), then swaps to a green
// checkmark SVG (never an emoji) and auto-closes shortly after. Uses the
// app's --mp-* dark theme tokens (see globals.css) rather than a custom
// palette, so it matches the rest of the deal chat surface.
//
// Deliberately its own full-screen component instead of routing through
// useConfirm's alert()/confirm() — those render a small centered modal
// box (.srf-modal-box), not a full-screen takeover.

const SEND_DELAY_MS = 3000;
const AUTO_CLOSE_MS = 1400; // how long the checkmark stays up before onDone

export default function RequestPaymentOverlay({ onDone }: { onDone: () => void }) {
  const [sent, setSent] = useState(false);
  useScrollLock(true);

  useEffect(() => {
    const sendTimer = setTimeout(() => setSent(true), SEND_DELAY_MS);
    return () => clearTimeout(sendTimer);
  }, []);

  useEffect(() => {
    if (!sent) return;
    const closeTimer = setTimeout(onDone, AUTO_CLOSE_MS);
    return () => clearTimeout(closeTimer);
  }, [sent, onDone]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 999999,
        background: "var(--mp-bg, #050508)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
      }}
      role="status"
      aria-live="polite"
    >
      {!sent ? (
        <>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              border: "3px solid var(--mp-border, rgba(255,255,255,0.14))",
              borderTopColor: "var(--mp-accent, #a3e635)",
              animation: "rp-spin 0.8s linear infinite",
            }}
          />
          <div style={{ color: "var(--mp-text, #f1f1f3)", fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em" }}>
            Sending payment request…
          </div>
          <div style={{ color: "var(--mp-text-sec, rgba(255,255,255,0.55))", fontSize: 13 }}>
            Notifying the buyer to complete their payment
          </div>
        </>
      ) : (
        <>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: "50%",
              background: "rgba(163,230,53,0.14)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              animation: "rp-pop 0.25s ease",
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="#a3e635" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="36" height="36">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div style={{ color: "var(--mp-text, #f1f1f3)", fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em" }}>
            Request sent
          </div>
          <div style={{ color: "var(--mp-text-sec, rgba(255,255,255,0.55))", fontSize: 13 }}>
            The buyer has been notified
          </div>
        </>
      )}
      <style>{`
        @keyframes rp-spin { to { transform: rotate(360deg); } }
        @keyframes rp-pop { from { transform: scale(0.7); opacity: 0; } to { transform: scale(1); opacity: 1; } }
      `}</style>
    </div>
  );
}
