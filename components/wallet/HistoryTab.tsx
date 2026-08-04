"use client";

import { useWalletHistory } from "@/lib/useWalletHistory";
import { walletTxIconKind, walletFeeSub, fmtWalletDate } from "@/lib/walletHistoryHelpers";
import { useCurrency } from "@/lib/CurrencyContext";

// Ports _walletRenderHistory from wallet.js — same icon/fee-sub/date
// formatting, backed by useWalletHistory's live Firestore onSnapshot
// listener instead of the original's dynamically-imported SDK. Markup
// mirrors index.html's #walletHistoryList / #walletHistoryEmpty +
// .wallet-tx-* classes so globals.css's rules apply.
function TxIcon({ type }: { type?: string }) {
  const kind = walletTxIconKind(type); // "pos" | "neg" | "pending"
  let path;
  if (kind === "pos") {
    path = <path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />;
  } else if (type === "withdraw" || type === "escrow_pay" || type === "escrow_hold") {
    path =
      type === "withdraw" ? (
        <>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" strokeLinecap="round" />
        </>
      ) : (
        <>
          <rect x="4" y="10" width="16" height="10" rx="2" />
          <path d="M8 10V7a4 4 0 018 0v3" />
        </>
      );
  } else {
    path = <path d="M12 5v14M5 12l7 7 7-7" strokeLinecap="round" strokeLinejoin="round" />;
  }
  return (
    <div className={`wallet-tx-icon ${kind}`}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
        {path}
      </svg>
    </div>
  );
}

export default function HistoryTab({ active }: { active: boolean }) {
  const { transactions, loading } = useWalletHistory(active);
  const { currency, formatBalance } = useCurrency();

  if (loading || transactions === null) {
    return (
      <div id="walletHistoryList" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="wallet-skel-row" />
        ))}
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <>
        <div id="walletHistoryList" />
        <div id="walletHistoryEmpty" style={{ display: "flex" }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5">
            <rect x="2" y="6" width="20" height="14" rx="2.5" />
            <path d="M2 10h20" />
          </svg>
          <div>No transactions yet</div>
        </div>
      </>
    );
  }

  return (
    <div id="walletHistoryList">
      {transactions.map((tx, i) => {
        const amt = Number(tx.amount || 0);
        const isPos = amt >= 0;
        const whenStr = fmtWalletDate(tx.createdAt);
        const scheduled = tx.scheduledFor ? fmtWalletDate(tx.scheduledFor) : "";
        const feeStr = walletFeeSub(tx);
        return (
          <div key={i} className="wallet-tx-row">
            <TxIcon type={tx.type} />
            <div className="wallet-tx-mid">
              <div className="wallet-tx-label">{tx.label || tx.type || "Transaction"}</div>
              <div className="wallet-tx-sub">
                {whenStr}
                {tx.status === "pending" ? " · Pending" : ""}
                {scheduled ? ` · Scheduled ${scheduled}` : ""}
              </div>
              {feeStr ? (
                <div className="wallet-tx-fee">
                  {feeStr}
                  {currency !== "USD" ? " (USD)" : ""}
                </div>
              ) : null}
            </div>
            <div className={`wallet-tx-amt ${isPos ? "pos" : "neg"}`}>
              {isPos ? "+" : "-"}
              {formatBalance(Math.abs(amt))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
