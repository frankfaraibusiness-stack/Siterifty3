"use client";

import { useRef, useState } from "react";
import { auth } from "@/lib/firebase";

// Shared by SendTab and AutoSendAddon — both ported _walletLookupRecipient
// / _asendLookupRecipient, which were byte-for-byte identical copies of
// the same debounced lookup-recipient call in the original (the only
// difference was which DOM elements they wrote into). Extracted here once
// instead of duplicating the fetch/debounce/stale-response-guard logic
// twice.
export interface WalletRecipient {
  uid: string;
  displayName: string;
  username: string;
  email: string;
  profilePic: string | null;
}

export function useRecipientLookup() {
  const [recipient, setRecipient] = useState<WalletRecipient | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokenRef = useRef(0);

  function onEmailChange(email: string) {
    setRecipient(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const clean = email.trim();
    if (!clean.includes("@") || !clean.includes(".")) {
      setStatus("idle");
      return;
    }
    setStatus("loading");
    debounceRef.current = setTimeout(() => lookup(clean), 500);
  }

  async function lookup(email: string) {
    const user = auth.currentUser;
    if (!user) return;
    const myToken = ++tokenRef.current;
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/paypal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "lookup-recipient", idToken, email }),
      });
      const d = await res.json();
      if (myToken !== tokenRef.current) return; // superseded by a newer lookup
      if (!res.ok) throw new Error(d.error || "Recipient not found");
      setRecipient(d);
      setStatus("ok");
    } catch (err: any) {
      if (myToken !== tokenRef.current) return;
      setRecipient(null);
      setErrorMsg(err.message || "Recipient not found");
      setStatus("err");
    }
  }

  function reset() {
    setRecipient(null);
    setStatus("idle");
    setErrorMsg("");
  }

  return { recipient, status, errorMsg, onEmailChange, reset };
}
