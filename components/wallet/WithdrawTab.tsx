"use client";

import { useState } from "react";
import { auth } from "@/lib/firebase";
import { useLimits } from "@/lib/useLimits";
import { useCurrency } from "@/lib/CurrencyContext";
import AutoWithdrawAddon from "@/components/wallet/AutoWithdrawAddon";

// Ports the WITHDRAW section from wallet.js (payment method, scheduler,
// fee breakdown, submit). Live bounds now come from useLimits() (GET
// /api/limits, LIMITS.wallet). FALLBACK_* match app/api/_lib/limits.js's
// wallet block exactly (withdrawMin:10, withdrawMax:10000, withdrawFee:0.05)
// and are used only until that fetch resolves. Markup mirrors
// index.html's #walletPanelWithdraw structure so globals.css's
// .wallet-* rules apply.
//
// Payment method fields were rewritten to collect what a payout actually
// needs instead of a single email address for every method: PayPal keeps
// its email, Bank now collects real US ACH details (account holder name,
// routing number, account number, account type), and Bitcoin is a new
// third method that just collects a wallet address — Siterifty doesn't
// process BTC payouts itself, it sends them manually once a withdrawal is
// approved (same manual-payout model bank/PayPal already use here).
const FALLBACK_WITHDRAW_MIN = 10;
const FALLBACK_WITHDRAW_MAX = 10000;
const FALLBACK_WITHDRAW_FEE_RATE = 0.05;

const BTC_ADDRESS_RE = /^(1[a-km-zA-HJ-NP-Z1-9]{25,34}|3[a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-z0-9]{25,59})$/;

function tomorrowStr() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function maxDateStr() {
  return new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default function WithdrawTab({
  active,
  withdrawable,
  onSuccess,
  awdOpen,
  onToggleAwd,
}: {
  active: boolean;
  withdrawable: number;
  onSuccess: () => void;
  awdOpen: boolean;
  onToggleAwd: () => void;
}) {
  const [method, setMethod] = useState<"paypal" | "bank" | "bitcoin">("paypal");
  const [scheduleMode, setScheduleMode] = useState<"asap" | "scheduled">("asap");
  const [amount, setAmount] = useState("");
  const [email, setEmail] = useState("");
  const [bankAccountName, setBankAccountName] = useState("");
  const [bankRoutingNumber, setBankRoutingNumber] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankAccountType, setBankAccountType] = useState<"checking" | "savings">("checking");
  const [bitcoinAddress, setBitcoinAddress] = useState("");
  const [date, setDate] = useState(tomorrowStr());
  const [time, setTime] = useState("12:00");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: "ok" | "err" | "" }>({ text: "", kind: "" });

  const { limits } = useLimits();
  const { formatBalance } = useCurrency();
  const WITHDRAW_MIN = limits.wallet.withdrawMin ?? FALLBACK_WITHDRAW_MIN;
  const WITHDRAW_MAX = limits.wallet.withdrawMax ?? FALLBACK_WITHDRAW_MAX;
  const WITHDRAW_FEE_RATE = limits.wallet.withdrawFee ?? FALLBACK_WITHDRAW_FEE_RATE;

  const amt = parseFloat(amount);
  const showFee = amt > 0;
  const fee = showFee ? amt * WITHDRAW_FEE_RATE : 0;
  const receive = showFee ? amt - fee : 0;

  function validateMethodFields(): string | null {
    if (method === "paypal") {
      if (!email.trim().includes("@")) return "Enter a valid PayPal email address.";
    } else if (method === "bank") {
      if (!bankAccountName.trim()) return "Enter the account holder name.";
      if (!/^\d{9}$/.test(bankRoutingNumber.trim())) return "Enter a valid 9-digit routing number.";
      if (!/^\d{4,17}$/.test(bankAccountNumber.trim())) return "Enter a valid account number.";
    } else {
      if (!BTC_ADDRESS_RE.test(bitcoinAddress.trim())) return "Enter a valid Bitcoin wallet address.";
    }
    return null;
  }

  async function handleSubmit() {
    setMsg({ text: "", kind: "" });

    if (!amt || amt < WITHDRAW_MIN || amt > WITHDRAW_MAX) {
      setMsg({ text: `Enter an amount between $${WITHDRAW_MIN} and $${WITHDRAW_MAX.toLocaleString()} USD.`, kind: "err" });
      return;
    }
    if (amt > withdrawable) {
      setMsg({
        text:
          withdrawable <= 0
            ? "You don't have any withdrawable balance yet. Deposited funds can be spent on Siterifty but can't be cashed out — only sale earnings, money received, and referral bonuses qualify."
            : `You can only withdraw up to $${withdrawable.toFixed(2)} USD — the rest of your balance came from deposits, which aren't withdrawable.`,
        kind: "err",
      });
      return;
    }
    const fieldErr = validateMethodFields();
    if (fieldErr) {
      setMsg({ text: fieldErr, kind: "err" });
      return;
    }

    let scheduledForIso: string | null = null;
    if (scheduleMode === "scheduled") {
      if (!date || !time) {
        setMsg({ text: "Pick a date and time for the scheduled payout.", kind: "err" });
        return;
      }
      scheduledForIso = new Date(`${date}T${time}:00`).toISOString();
    }

    setSubmitting(true);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Not signed in");
      const idToken = await user.getIdToken();

      const body: Record<string, unknown> = {
        action: "withdraw",
        idToken,
        amount: amt,
        method,
        scheduledFor: scheduledForIso,
      };
      if (method === "paypal") {
        body.paypalEmail = email.trim();
      } else if (method === "bank") {
        body.bankAccountName = bankAccountName.trim();
        body.bankRoutingNumber = bankRoutingNumber.trim();
        body.bankAccountNumber = bankAccountNumber.trim();
        body.bankAccountType = bankAccountType;
      } else {
        body.bitcoinAddress = bitcoinAddress.trim();
      }

      const res = await fetch("/api/paypal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Withdrawal failed");

      const etaMsg =
        method === "bank" ? "3–5 business days" : method === "bitcoin" ? "1–2 business days" : "1–3 business days";
      const whenMsg = scheduledForIso
        ? `on ${new Date(scheduledForIso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} at ${new Date(scheduledForIso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
        : `within ${etaMsg}`;
      setMsg({ text: `✓ Withdrawal requested. You'll receive $${result.receive.toFixed(2)} USD ${whenMsg}.`, kind: "ok" });
      setAmount("");
      setEmail("");
      setBankAccountName("");
      setBankRoutingNumber("");
      setBankAccountNumber("");
      setBitcoinAddress("");
      onSuccess();
    } catch (err: any) {
      console.error("[wallet withdraw]", err);
      setMsg({ text: err.message || "Something went wrong. Please try again.", kind: "err" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={`wallet-panel${active ? " active" : ""}`} id="walletPanelWithdraw">
      <div id="walletWithdrawAvailBanner">
        <span>Available to withdraw</span>
        <strong id="walletWithdrawAvailAmt">{formatBalance(withdrawable)}</strong>
      </div>

      <div className="wallet-field-label">Amount to withdraw (USD)</div>
      <div className="wallet-amount-input-wrap">
        <span className="wallet-amount-currency">$</span>
        <input
          type="number"
          id="walletWithdrawAmt"
          inputMode="decimal"
          placeholder="0.00"
          min={WITHDRAW_MIN}
          max={WITHDRAW_MAX}
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <button type="button" id="walletWithdrawMaxBtn" onClick={() => setAmount(withdrawable > 0 ? withdrawable.toFixed(2) : "")}>
          Max
        </button>
      </div>

      <div className="wallet-field-label" style={{ marginTop: 18 }}>Payment method</div>
      <div id="walletMethodGrid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        <button type="button" className={`wallet-method-card${method === "paypal" ? " active" : ""}`} data-method="paypal" onClick={() => setMethod("paypal")}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M7 5h8a4 4 0 010 8H9l-1 6H5l3-14z" />
            <path d="M11 9h6a3.5 3.5 0 010 7h-4" />
          </svg>
          <span>PayPal</span>
        </button>
        <button type="button" className={`wallet-method-card${method === "bank" ? " active" : ""}`} data-method="bank" onClick={() => setMethod("bank")}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M3 10l9-6 9 6" />
            <path d="M4 10v9h16v-9" />
            <path d="M9 21v-6h6v6" />
          </svg>
          <span>Bank</span>
        </button>
        <button type="button" className={`wallet-method-card${method === "bitcoin" ? " active" : ""}`} data-method="bitcoin" onClick={() => setMethod("bitcoin")}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="12" r="9" />
            <path d="M9.5 8h3.6a2 2 0 010 4H9.5m0 0h4a2 2 0 010 4H9.5m0-8V7m0 9v1m2.5-10V7m0 9v1" strokeLinecap="round" />
          </svg>
          <span>Bitcoin</span>
        </button>
      </div>

      {method === "paypal" ? (
        <div id="walletMethodPaypalFields">
          <div className="wallet-field-label" style={{ marginTop: 16 }}>PayPal email</div>
          <input
            type="email"
            id="walletWithdrawEmail"
            className="wallet-text-input"
            placeholder="you@example.com"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
      ) : null}

      {method === "bank" ? (
        <div id="walletMethodBankFields">
          <div className="wallet-field-label" style={{ marginTop: 16 }}>Account holder name</div>
          <input
            type="text"
            id="walletWithdrawBankName"
            className="wallet-text-input"
            placeholder="Full name on the account"
            autoComplete="name"
            value={bankAccountName}
            onChange={(e) => setBankAccountName(e.target.value)}
          />
          <div className="wallet-field-label" style={{ marginTop: 12 }}>Routing number</div>
          <input
            type="text"
            id="walletWithdrawRouting"
            className="wallet-text-input"
            placeholder="9-digit routing number"
            inputMode="numeric"
            maxLength={9}
            value={bankRoutingNumber}
            onChange={(e) => setBankRoutingNumber(e.target.value.replace(/\D/g, ""))}
          />
          <div className="wallet-field-label" style={{ marginTop: 12 }}>Account number</div>
          <input
            type="text"
            id="walletWithdrawAccountNum"
            className="wallet-text-input"
            placeholder="Account number"
            inputMode="numeric"
            maxLength={17}
            value={bankAccountNumber}
            onChange={(e) => setBankAccountNumber(e.target.value.replace(/\D/g, ""))}
          />
          <div className="wallet-field-label" style={{ marginTop: 12 }}>Account type</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className={`wallet-schedule-chip${bankAccountType === "checking" ? " active" : ""}`}
              onClick={() => setBankAccountType("checking")}
            >
              Checking
            </button>
            <button
              type="button"
              className={`wallet-schedule-chip${bankAccountType === "savings" ? " active" : ""}`}
              onClick={() => setBankAccountType("savings")}
            >
              Savings
            </button>
          </div>
          <div className="wallet-hint" style={{ marginTop: 8 }}>US bank accounts only (ACH transfer).</div>
        </div>
      ) : null}

      {method === "bitcoin" ? (
        <div id="walletMethodBitcoinFields">
          <div className="wallet-field-label" style={{ marginTop: 16 }}>Bitcoin wallet address</div>
          <input
            type="text"
            id="walletWithdrawBtcAddress"
            className="wallet-text-input"
            placeholder="bc1... / 1... / 3..."
            autoComplete="off"
            spellCheck={false}
            value={bitcoinAddress}
            onChange={(e) => setBitcoinAddress(e.target.value.trim())}
          />
          <div className="wallet-hint" style={{ marginTop: 8 }}>
            Double-check this address — Bitcoin transfers can't be reversed once sent. Payouts are sent manually and aren't instant.
          </div>
        </div>
      ) : null}

      <div className="wallet-field-label" style={{ marginTop: 18 }}>When should we send it?</div>
      <div id="walletScheduleRow">
        <button type="button" className={`wallet-schedule-chip${scheduleMode === "asap" ? " active" : ""}`} data-when="asap" onClick={() => setScheduleMode("asap")}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M13 2L3 14h7l-1 8 11-14h-7l1-6z" />
          </svg>
          As soon as possible
        </button>
        <button type="button" className={`wallet-schedule-chip${scheduleMode === "scheduled" ? " active" : ""}`} data-when="scheduled" onClick={() => setScheduleMode("scheduled")}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M16 3v4M8 3v4M3 10h18" strokeLinecap="round" />
          </svg>
          Choose date &amp; time
        </button>
      </div>
      <div id="walletScheduleFields" style={scheduleMode === "scheduled" ? undefined : { display: "none" }}>
        <div className="wallet-schedule-inputs">
          <div className="wallet-schedule-field">
            <label htmlFor="walletScheduleDate">Date</label>
            <input
              type="date"
              id="walletScheduleDate"
              min={tomorrowStr()}
              max={maxDateStr()}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="wallet-schedule-field">
            <label htmlFor="walletScheduleTime">Time</label>
            <input type="time" id="walletScheduleTime" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        </div>
        <div className="wallet-hint">Payouts can be scheduled up to 90 days ahead. We'll process it automatically on that date.</div>
      </div>

      <div className="wallet-fee-breakdown" id="walletWithdrawFeeRow" style={showFee ? undefined : { display: "none" }}>
        <div className="wallet-fee-line"><span>Withdrawal amount (USD)</span><span id="walletWithdrawGross">${amt ? amt.toFixed(2) : "0.00"}</span></div>
        <div className="wallet-fee-line"><span id="walletWithdrawFeeLabel">Processing fee (5%, USD)</span><span id="walletWithdrawFee">${fee.toFixed(2)}</span></div>
        <div className="wallet-fee-line total"><span>You'll receive (USD)</span><span id="walletWithdrawReceive">${receive.toFixed(2)}</span></div>
      </div>

      <div className="wallet-hint" id="walletWithdrawHint">Min ${WITHDRAW_MIN} · Max ${WITHDRAW_MAX.toLocaleString()} USD · PayPal: 1–3 business days · Bank: 3–5 business days · Bitcoin: 1–2 business days</div>
      {msg.text ? <div id="walletWithdrawMsg" className={`wallet-msg${msg.kind ? ` ${msg.kind}` : ""}`}>{msg.text}</div> : <div id="walletWithdrawMsg" className="wallet-msg" />}
      <button className="wallet-submit-btn" id="walletWithdrawSubmit" onClick={handleSubmit} disabled={submitting}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
          <path d="M12 5v14M5 12l7 7 7-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>{submitting ? "Processing…" : "Request Withdrawal"}</span>
      </button>

      {/* ── Auto Withdrawal addon ── */}
      <button type="button" className={`wallet-addon-toggle${awdOpen ? " open" : ""}`} id="awdAddonToggle" aria-expanded={awdOpen} onClick={onToggleAwd}>
        <span className="wallet-addon-toggle-left">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12l7 7 7-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>Auto Withdrawal</span>
        </span>
        <svg className="wallet-addon-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div className={`wallet-addon-panel${awdOpen ? " open" : ""}`} id="walletPanelAutowithdraw">
        {awdOpen ? <AutoWithdrawAddon onEnabled={onSuccess} /> : null}
      </div>
    </div>
  );
}
