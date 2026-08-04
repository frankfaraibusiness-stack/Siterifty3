import type { WalletTransaction } from "@/lib/useWalletHistory";

// Ports _walletTxIcon from wallet.js — same type→(color class, icon path)
// mapping. Icon paths are returned as plain SVG path/shape strings since
// the original builds raw HTML; here they're just interpolated as JSX
// path elements by the caller (see WalletModal.tsx's renderTxIcon).
export function walletTxIconKind(type?: string): "pos" | "pending" | "neg" {
  if (type === "deposit" || type === "receive" || type === "referral_bonus" || type === "sale" || type === "escrow_release") {
    return "pos";
  }
  if (type === "withdraw") return "pending";
  if (type === "escrow_pay" || type === "escrow_hold") return "pending";
  return "neg";
}

// Ports _walletFeeSub from wallet.js exactly — same per-type fee-breakdown
// copy, same field names read off the transaction doc.
export function walletFeeSub(tx: WalletTransaction): string {
  const fee = Number(tx.fee || 0);
  const amt = Number(tx.amount || 0);

  if (tx.type === "send") {
    if (typeof tx.receiveAmount === "number") {
      return `Recipient received $${tx.receiveAmount.toFixed(2)}`;
    }
    return "";
  }
  if (fee > 0 && tx.type === "withdraw") {
    const gross = Math.abs(amt);
    const net = typeof tx.receive === "number" ? tx.receive : parseFloat((gross - fee).toFixed(2));
    return `You'll receive $${net.toFixed(2)} after $${fee.toFixed(2)} fee`;
  }
  if (fee > 0 && (tx.type === "receive" || tx.type === "donate" || tx.type === "donation_received" || tx.type === "escrow_release")) {
    const gross = Number(tx.grossAmount != null ? tx.grossAmount : Math.abs(amt) + fee);
    return `$${gross.toFixed(2)} − $${fee.toFixed(2)} fee = $${Math.abs(amt).toFixed(2)}`;
  }
  return "";
}

// Converts a Firestore Timestamp | millis | null into the same
// "Mon 5 · 3:42 PM" display string the original builds from
// tx.createdAt?.toDate().
export function fmtWalletDate(value: unknown): string {
  let when: Date | null = null;
  if (value && typeof (value as { toDate?: () => Date }).toDate === "function") {
    when = (value as { toDate: () => Date }).toDate();
  } else if (typeof value === "number") {
    when = new Date(value);
  }
  if (!when) return "";
  return (
    when.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " · " +
    when.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  );
}
