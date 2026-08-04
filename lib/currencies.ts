// Shared between app/api/fx/route.ts (server) and lib/CurrencyContext.tsx
// (client). Split out on its own because route.ts is a Next.js Route
// Handler module — importing it from client code would risk pulling
// server-only code (firebase-admin via lib/server/adminDb) into the
// browser bundle. This file has zero imports, so it's safe from both
// sides.

export const SUPPORTED_CURRENCIES = [
  "USD", "EUR", "GBP", "CAD", "AUD", "JPY", "INR", "BRL", "MXN", "NGN",
  "ZAR", "SGD", "AED", "CHF", "SEK", "PLN",
] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

export const CURRENCY_LABELS: Record<CurrencyCode, string> = {
  USD: "US Dollar",
  EUR: "Euro",
  GBP: "British Pound",
  CAD: "Canadian Dollar",
  AUD: "Australian Dollar",
  JPY: "Japanese Yen",
  INR: "Indian Rupee",
  BRL: "Brazilian Real",
  MXN: "Mexican Peso",
  NGN: "Nigerian Naira",
  ZAR: "South African Rand",
  SGD: "Singapore Dollar",
  AED: "UAE Dirham",
  CHF: "Swiss Franc",
  SEK: "Swedish Krona",
  PLN: "Polish Złoty",
};
