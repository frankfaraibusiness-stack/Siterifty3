"use client";

// Display-only currency conversion. Never touches the actual deal/escrow
// amount — app/api/paypal/_handler.js hardcodes currency_code: 'USD' for
// every real charge, and that stays true regardless of what's selected
// here. This purely controls what number is shown next to a USD price
// while browsing.
//
// Same persistence convention as components/theme/ThemeModalProvider.tsx:
// localStorage first (works signed-out, applies instantly), best-effort
// Firestore sync via setDoc(..., { merge: true }) when signed in so the
// preference follows the user across devices.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { doc, setDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useAuth } from "@/lib/AuthContext";
import { SUPPORTED_CURRENCIES, type CurrencyCode } from "@/lib/currencies";

export type { CurrencyCode };

const STORAGE_KEY = "srf_currency";
const DEFAULT_CURRENCY: CurrencyCode = "USD";

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$", EUR: "€", GBP: "£", CAD: "CA$", AUD: "AU$", JPY: "¥",
  INR: "₹", BRL: "R$", MXN: "MX$", NGN: "₦", ZAR: "R", SGD: "S$",
  AED: "AED ", CHF: "CHF ", SEK: "kr", PLN: "zł",
};

interface CurrencyContextValue {
  currency: CurrencyCode;
  setCurrency: (code: CurrencyCode) => void;
  rates: Record<string, number> | null;
  ratesLoading: boolean;
  /** Converts a USD amount into the selected currency. Returns null if rates aren't loaded yet or the currency is USD (no conversion needed). */
  convert: (usdAmount: number) => number | null;
  /** Formats a USD amount as "{symbol}{converted} (≈ $usd USD)" when currency !== USD, or just "${usd}" when it is. Mirrors fmtPrice's "Make offer" fallback for null/undefined. */
  formatPrice: (usdAmount: number | undefined | null) => string;
  /** Same as formatPriceShort but without the "(≈ $usd USD)" suffix — just the converted figure, for tight spaces like marketplace card headlines where the full disclosure doesn't fit. Pair with a tooltip/title attribute showing the USD amount where possible. */
  formatPriceShort: (usdAmount: number | undefined | null) => string;
  /** Currency-aware equivalent of lib/listings.ts's fmtFinVal — abbreviates large numbers (1.2M / 45k) for card stat strips (revenue/expenses/profit). Converts to the selected display currency the same way formatPriceShort does; returns "—" for null/undefined instead of "Make offer" since these are metrics, not prices. */
  formatFinCompact: (usdAmount: number | undefined | null) => string;
  /** Same conversion as formatPriceShort (full number, no abbreviation) but returns "—" instead of "Make offer" for null/undefined — for financial metrics like revenue/expenses/profit where "Make offer" doesn't make sense. */
  formatFinFull: (usdAmount: number | undefined | null) => string;
  /** Like formatFinFull but keeps 2 decimal places instead of rounding to whole numbers — for exact monetary balances (wallet, transfers) where cents matter. Returns "0.00"-style zero rather than "—" for null/undefined, matching the wallet's existing all-zero-state display. */
  formatBalance: (usdAmount: number | undefined | null) => string;
}

// Fallback used only if CurrencyProvider genuinely isn't mounted above a
// consumer (e.g. a component prerendered/rendered outside the normal app
// tree). Behaves as if the visitor is on USD with no conversion available
// — same numbers a signed-out, geo-undetected US visitor would see — so a
// missing provider degrades to plain USD display instead of crashing the
// whole page. setCurrency/formatBalance etc. are still fully functional;
// only convert() is inert (no rates), which is a no-op anyway since
// currency is always "USD" here.
function fmtUsd(n: number): string {
  return `$${n.toLocaleString()}`;
}
const DEFAULT_CONTEXT_VALUE: CurrencyContextValue = {
  currency: DEFAULT_CURRENCY,
  setCurrency: () => {},
  rates: null,
  ratesLoading: false,
  convert: (usdAmount) => usdAmount,
  formatPrice: (usdAmount) => (typeof usdAmount === "number" ? fmtUsd(usdAmount) : "Make offer"),
  formatPriceShort: (usdAmount) => (typeof usdAmount === "number" ? fmtUsd(usdAmount) : "Make offer"),
  formatFinCompact: (usdAmount) => {
    if (typeof usdAmount !== "number") return "—";
    const abs = Math.abs(usdAmount);
    if (abs >= 1_000_000) return "$" + (usdAmount / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
    if (abs >= 10_000) return "$" + (usdAmount / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
    return fmtUsd(Math.round(usdAmount));
  },
  formatFinFull: (usdAmount) => (typeof usdAmount === "number" ? fmtUsd(usdAmount) : "—"),
  formatBalance: (usdAmount) =>
    `$${(typeof usdAmount === "number" ? usdAmount : 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`,
};

const CurrencyContext = createContext<CurrencyContextValue>(DEFAULT_CONTEXT_VALUE);

export function useCurrency(): CurrencyContextValue {
  return useContext(CurrencyContext);
}

// Returns null when no preference has ever been stored — distinct from
// an explicit USD pick — so the geo-detect effect below knows whether
// it's safe to apply an auto-detected currency (only ever on a true
// first visit) versus a returning user who chose USD on purpose.
function loadStoredCurrency(): CurrencyCode | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (SUPPORTED_CURRENCIES as readonly string[]).includes(stored)) {
      return stored as CurrencyCode;
    }
  } catch {}
  return null;
}

async function saveCurrencyToFirestore(code: CurrencyCode) {
  const user = auth.currentUser;
  if (!user) return;
  try {
    await setDoc(doc(db, "users", user.uid), { currency: code }, { merge: true });
  } catch {
    // silent — local preference already applied, Firestore sync is non-critical
  }
}

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth();
  const [currency, setCurrencyState] = useState<CurrencyCode>(DEFAULT_CURRENCY);
  const [rates, setRates] = useState<Record<string, number> | null>(null);
  const [ratesLoading, setRatesLoading] = useState(true);
  // True once *any* preference is known to exist (stored locally, synced
  // from Firestore, or auto-detected from geo) — gates the geo-detect
  // effect so it only ever applies on a genuine first visit and never
  // clobbers a preference the user (or another device) already set.
  const [hasStoredPreference, setHasStoredPreference] = useState(false);

  // Local preference on mount — works before auth resolves, works
  // signed-out.
  useEffect(() => {
    const stored = loadStoredCurrency();
    if (stored) {
      setCurrencyState(stored);
      setHasStoredPreference(true);
    }
  }, []);

  // Once signed in, a Firestore-saved preference (set from another
  // device) takes precedence over whatever's in this browser's
  // localStorage — same "remote wins once loaded" behavior
  // ThemeModalProvider follows for theme.
  useEffect(() => {
    const remote = profile?.currency;
    if (remote && (SUPPORTED_CURRENCIES as readonly string[]).includes(remote)) {
      setCurrencyState(remote as CurrencyCode);
      setHasStoredPreference(true);
      try {
        localStorage.setItem(STORAGE_KEY, remote);
      } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, profile?.currency]);

  // First-visit-only geo auto-default: if no preference exists anywhere
  // (not local, not Firestore) by the time /api/geo resolves, apply the
  // visitor's local currency and persist it — from that point on it's
  // an explicit preference like any other and this never fires again.
  // Never overrides an existing choice, including an explicit USD pick.
  useEffect(() => {
    if (hasStoredPreference) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/geo");
        const data = await res.json();
        const detected = data?.currency;
        if (
          !cancelled &&
          !hasStoredPreference &&
          detected &&
          (SUPPORTED_CURRENCIES as readonly string[]).includes(detected)
        ) {
          setCurrencyState(detected as CurrencyCode);
          setHasStoredPreference(true);
          try {
            localStorage.setItem(STORAGE_KEY, detected);
          } catch {}
          // Best-effort — mirrors setCurrency's own Firestore sync so a
          // signed-in first-time visitor's auto-detected currency also
          // follows them to other devices.
          saveCurrencyToFirestore(detected as CurrencyCode);
        }
      } catch {
        // Silent — USD default already applied, geo-detect is a nicety
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasStoredPreference]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/fx");
        const data = await res.json();
        if (!cancelled) setRates(data?.rates || { USD: 1 });
      } catch {
        if (!cancelled) setRates({ USD: 1 });
      } finally {
        if (!cancelled) setRatesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function setCurrency(code: CurrencyCode) {
    setCurrencyState(code);
    setHasStoredPreference(true);
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch {}
    saveCurrencyToFirestore(code);
  }

  function convert(usdAmount: number): number | null {
    if (currency === "USD") return usdAmount;
    if (!rates || !rates[currency]) return null;
    return usdAmount * rates[currency];
  }

  function formatPrice(usdAmount: number | undefined | null): string {
    if (typeof usdAmount !== "number") return "Make offer";
    const usdFormatted = `$${usdAmount.toLocaleString()}`;
    if (currency === "USD") return usdFormatted;

    const converted = convert(usdAmount);
    if (converted === null) return usdFormatted; // rates not ready yet — fall back to USD rather than show nothing

    const symbol = CURRENCY_SYMBOLS[currency] || `${currency} `;
    const convertedFormatted = `${symbol}${Math.round(converted).toLocaleString()}`;
    return `${convertedFormatted} (≈ ${usdFormatted} USD)`;
  }

  function formatPriceShort(usdAmount: number | undefined | null): string {
    if (typeof usdAmount !== "number") return "Make offer";
    if (currency === "USD") return `$${usdAmount.toLocaleString()}`;

    const converted = convert(usdAmount);
    if (converted === null) return `$${usdAmount.toLocaleString()}`;

    const symbol = CURRENCY_SYMBOLS[currency] || `${currency} `;
    return `${symbol}${Math.round(converted).toLocaleString()}`;
  }

  function formatFinCompact(usdAmount: number | undefined | null): string {
    if (typeof usdAmount !== "number") return "—";
    const converted = currency === "USD" ? usdAmount : convert(usdAmount);
    const amount = converted === null ? usdAmount : converted; // rates not ready — fall back to USD figure rather than show nothing
    const symbol = currency === "USD" || converted === null ? "$" : CURRENCY_SYMBOLS[currency] || `${currency} `;
    const abs = Math.abs(amount);
    if (abs >= 1_000_000) return symbol + (amount / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
    if (abs >= 10_000) return symbol + (amount / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
    return symbol + Math.round(amount).toLocaleString();
  }

  function formatFinFull(usdAmount: number | undefined | null): string {
    if (typeof usdAmount !== "number") return "—";
    if (currency === "USD") return `$${usdAmount.toLocaleString()}`;
    const converted = convert(usdAmount);
    if (converted === null) return `$${usdAmount.toLocaleString()}`;
    const symbol = CURRENCY_SYMBOLS[currency] || `${currency} `;
    return `${symbol}${Math.round(converted).toLocaleString()}`;
  }

  function formatBalance(usdAmount: number | undefined | null): string {
    const n = typeof usdAmount === "number" ? usdAmount : 0;
    if (currency === "USD") {
      return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    const converted = convert(n);
    const amount = converted === null ? n : converted; // rates not ready — fall back to USD figure
    const symbol = converted === null ? "$" : CURRENCY_SYMBOLS[currency] || `${currency} `;
    return `${symbol}${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  return (
    <CurrencyContext.Provider
      value={{
        currency,
        setCurrency,
        rates,
        ratesLoading,
        convert,
        formatPrice,
        formatPriceShort,
        formatFinCompact,
        formatFinFull,
        formatBalance,
      }}
    >
      {children}
    </CurrencyContext.Provider>
  );
}
