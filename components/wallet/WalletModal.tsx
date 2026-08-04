"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { useWalletSummary } from "@/lib/useWalletSummary";
import { useCurrency } from "@/lib/CurrencyContext";
import { useScrollLock } from "@/lib/useScrollLock";
import WithdrawTab from "@/components/wallet/WithdrawTab";
import SendTab from "@/components/wallet/SendTab";
import HistoryTab from "@/components/wallet/HistoryTab";

// Ports the WALLET MODAL from wallet.js (index.html lines 7026-8192) — all
// 4 tabs. Markup mirrors index.html's #walletModal structure 1:1 (same
// ids/classes) so the #walletModal / .wallet-* rules in globals.css
// (ported verbatim from styles/siterifty.css) actually apply — the
// previous version reimplemented this shell with inline styles, which
// left ~90% of that CSS block unused. Withdraw tab's Auto Withdrawal addon
// is a collapsible disclosure nested inside that tab (matching the
// original's DOM placement), not a separate top-level tab. Auto Send
// similarly lives inside SendTab.tsx itself. The balance hero (shared
// across all tabs) uses the live AuthContext profile.walletBalance for the
// headline number (same source Header/NavDrawer already read) and
// useWalletSummary for the pending/escrow breakdown, which isn't in the
// profile listener.
//
// Add Funds via PayPal (create-order/capture-order + the PayPal Buttons
// SDK + the vault-backed Auto Top-Up addon) has been removed — Siterifty
// holds user balances (escrow, wallet), and running that kind of money
// transmission through PayPal's standard checkout isn't something PayPal
// allows for platforms holding customer funds. PayPal is kept for the Pro
// subscription only (a normal recurring charge to Siterifty, not custody
// of user funds — see the Plans modal). This tab is now a placeholder
// until the new deposit provider is wired in.
export default function WalletModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { profile } = useAuth();
  const { summary, refresh } = useWalletSummary();
  const { currency, formatBalance } = useCurrency();
  const [tab, setTab] = useState<"deposit" | "withdraw" | "send" | "history">("deposit");
  const [awdOpen, setAwdOpen] = useState(false);

  useEffect(() => {
    if (open) {
      refresh();
      setTab("deposit");
    }
  }, [open, refresh]);

  // Shared reference-counted lock (see lib/useScrollLock.ts) instead of a
  // hand-rolled html/body position:fixed toggle — the previous version
  // saved/restored styles independently of every other modal's lock, so
  // whichever modal closed first could rip out another modal's lock (or
  // jump the page's scroll position) if two were ever open at once.
  useScrollLock(open);

  if (!open) return null;

  const balance = profile?.walletBalance ?? summary.walletBalance ?? 0;
  const hasPending = summary.pendingBalance > 0;
  const hasIncoming = summary.escrowIncoming > 0;

  return (
    <div id="walletModal" className="active">
      <div id="walletModalInner">
        <div id="walletModalHeader">
          <div id="walletModalHeaderLeft">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a3e635" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="6" width="20" height="14" rx="2.5" />
              <path d="M2 10h20" />
              <path d="M17 15h.01" />
            </svg>
            <div>
              <div id="walletModalTitle">Wallet</div>
              <div id="walletModalSub">Manage your balance</div>
            </div>
          </div>
          <button id="walletModalClose" aria-label="Close wallet" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div id="walletModalBody" data-scroll-lock-exempt>
          <div id="walletModalLeft">
          {/* Balance hero */}
          <div id="walletBalanceCard">
            <img
              src="/images/siterifty-logo.png"
              alt="Siterifty.com — Buy, Sell, Build, Trust"
              style={{ height: 22, marginBottom: 8, display: "block", marginLeft: "auto", marginRight: "auto" }}
            />
            <div id="walletBalanceLabel">Available balance</div>
            <div id="walletBalanceAmt">
              {formatBalance(balance)}
            </div>
            {currency !== "USD" && (
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: -4, marginBottom: 4 }}>
                Actual balance held in USD — shown converted to {currency}
              </div>
            )}
            <div id="walletPendingRow" style={hasPending ? undefined : { display: "none" }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6v6l4 2" strokeLinecap="round" />
              </svg>
              <span>
                <span id="walletPendingAmt">{formatBalance(summary.pendingBalance)}</span> pending withdrawal
              </span>
            </div>

            {/* Sub-balance breakdown grid */}
            <div id="walletSubBalances">
              <div className="wallet-subbal" id="walletSubWithdrawable">
                <div className="wallet-subbal-icon wd">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div className="wallet-subbal-mid">
                  <div className="wallet-subbal-label">Withdrawable</div>
                  <div className="wallet-subbal-amt" id="walletWithdrawableAmt">{formatBalance(summary.withdrawableBalance)}</div>
                </div>
              </div>
              <div className="wallet-subbal" id="walletSubEscrowHeld">
                <div className="wallet-subbal-icon lk">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <rect x="4" y="10" width="16" height="10" rx="2" />
                    <path d="M8 10V7a4 4 0 018 0v3" />
                  </svg>
                </div>
                <div className="wallet-subbal-mid">
                  <div className="wallet-subbal-label">In Escrow</div>
                  <div className="wallet-subbal-amt" id="walletEscrowHeldAmt">{formatBalance(summary.escrowHeld)}</div>
                </div>
              </div>
              <div className="wallet-subbal" id="walletSubEscrowIncoming" style={hasIncoming ? undefined : { display: "none" }}>
                <div className="wallet-subbal-icon inc">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <path d="M12 5v14M19 12l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div className="wallet-subbal-mid">
                  <div className="wallet-subbal-label">Incoming (Escrow)</div>
                  <div className="wallet-subbal-amt" id="walletEscrowIncomingAmt">{formatBalance(summary.escrowIncoming)}</div>
                </div>
              </div>
            </div>
            <div id="walletEscrowHint">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v5M12 16h.01" strokeLinecap="round" />
              </svg>
              Siterifty wallet balance is currently used only to boost your own listings — it can&apos;t be withdrawn
              or sent to other users. We&apos;re not licensed to hold customer funds; PayPal handles the full
              escrow-protected payment for every marketplace purchase.
            </div>
          </div>

          {/* Tabs */}
          <div id="walletTabs">
            <button className={`wallet-tab${tab === "deposit" ? " active" : ""}`} data-wtab="deposit" onClick={() => setTab("deposit")}>
              Add Funds
            </button>
            <button className={`wallet-tab${tab === "withdraw" ? " active" : ""}`} data-wtab="withdraw" onClick={() => setTab("withdraw")}>
              Withdraw
            </button>
            <button className={`wallet-tab${tab === "send" ? " active" : ""}`} data-wtab="send" onClick={() => setTab("send")}>
              Send
            </button>
            <button className={`wallet-tab${tab === "history" ? " active" : ""}`} data-wtab="history" onClick={() => setTab("history")}>
              History
            </button>
          </div>
          </div>

          <div id="walletModalRight">
          {/* ── Deposit panel ── */}
          <div className={`wallet-panel${tab === "deposit" ? " active" : ""}`} id="walletPanelDeposit">
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
                <rect x="2" y="6" width="20" height="14" rx="2.5" />
                <path d="M2 10h20" />
              </svg>
              <div style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.85)" }}>Add Funds is being updated</div>
              <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.45)", maxWidth: 320, lineHeight: 1.5 }}>
                We're switching to a new payment provider for wallet top-ups. Wallet balance is only ever used to
                boost your own listings — it can't be withdrawn or sent to others. This tab will be back shortly;
                your existing balance and withdrawals aren't affected.
              </div>
            </div>
          </div>

          {/* ── Withdraw panel ── */}
          <WithdrawTab active={tab === "withdraw"} withdrawable={summary.withdrawableBalance} onSuccess={refresh} awdOpen={awdOpen} onToggleAwd={() => setAwdOpen((o) => !o)} />

          {/* ── Send panel — disabled pending money-transmission licensing,
              see SendTab.tsx's top comment ── */}
          <SendTab active={tab === "send"} />

          {/* ── History panel ── */}
          <div className={`wallet-panel${tab === "history" ? " active" : ""}`} id="walletPanelHistory">
            <HistoryTab active={tab === "history"} />
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}
