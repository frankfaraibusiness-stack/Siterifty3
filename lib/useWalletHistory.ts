"use client";

import { useEffect, useState } from "react";
import { collection, query, orderBy, limit, onSnapshot, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/AuthContext";

// Ports _walletLoadHistory / _walletRenderHistory from wallet.js. Original
// dynamically imports the Firestore SDK from a CDN URL inside the handler
// (`await import('https://www.gstatic.com/.../firebase-firestore.js')`) —
// this app already statically imports firebase/firestore everywhere else
// (lib/firebase.ts, useSeller.ts, useSettingsState.ts, etc.), so this hook
// just uses that same client instance instead of re-fetching the SDK.
export interface WalletTransaction {
  type?: string;
  amount?: number;
  fee?: number;
  receive?: number;
  receiveAmount?: number;
  grossAmount?: number;
  label?: string;
  note?: string;
  status?: string;
  createdAt?: Timestamp | number | null;
  scheduledFor?: Timestamp | number | null;
}

// Only mounts the onSnapshot listener once `active` is true, so the
// History tab's data doesn't load until the user actually opens it —
// same as the original's `_walletHistoryLoaded` lazy-load gate.
export function useWalletHistory(active: boolean) {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<WalletTransaction[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!active || !user) return;
    setLoading(true);
    const q = query(
      collection(db, "users", user.uid, "transactions"),
      orderBy("createdAt", "desc"),
      limit(50)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setTransactions(snap.docs.map((d) => d.data() as WalletTransaction));
        setLoading(false);
      },
      (err) => {
        console.error("[wallet history]", err);
        setTransactions([]);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [active, user]);

  return { transactions, loading };
}
