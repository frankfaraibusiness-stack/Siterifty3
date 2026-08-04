"use client";

import { useCallback, useState } from "react";
import { auth } from "@/lib/firebase";

// Ports _walletSummary + _walletFetchSummary from wallet.js. Pulls the
// authoritative balance/withdrawable/escrow breakdown from /api/paypal's
// wallet-summary action — escrow totals in particular can't be trusted
// from client cache since they're computed from every deal doc
// server-side. walletBalance/withdrawableBalance/pendingBalance here are
// the same numbers AuthContext's onSnapshot listener also streams from
// the user doc; this hook exists for the escrow breakdown fields that
// listener deliberately doesn't fetch (wallet-modal-specific, per the
// original's own comment).
export interface WalletSummary {
  walletBalance: number;
  withdrawableBalance: number;
  pendingBalance: number;
  escrowHeld: number;
  escrowIncoming: number;
  escrowCount: number;
}

const EMPTY_SUMMARY: WalletSummary = {
  walletBalance: 0,
  withdrawableBalance: 0,
  pendingBalance: 0,
  escrowHeld: 0,
  escrowIncoming: 0,
  escrowCount: 0,
};

export function useWalletSummary() {
  const [summary, setSummary] = useState<WalletSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) return;
    setLoading(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/paypal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "wallet-summary", idToken }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not load wallet summary");
      setSummary(d);
    } catch (err) {
      console.error("[wallet summary]", err);
    } finally {
      setLoading(false);
    }
  }, []);

  return { summary, loading, refresh };
}
