"use client";

import { useEffect, useState } from "react";
import { auth } from "@/lib/firebase";
import { useRecipientLookup } from "@/lib/useRecipientLookup";
import RecipientPreview from "@/components/wallet/RecipientPreview";
import { useLimits } from "@/lib/useLimits";
import { useCurrency } from "@/lib/CurrencyContext";

// Ports the AUTO SEND section from wallet.js (autosend-create/-list/
// -cancel), including _asendScheduleRow's exact markup (.wallet-tx-row /
// .wallet-tx-icon pending|neg / .asend-cancel-btn). Live interval
// options + transfer bounds now come from useLimits() (GET
// /api/limits, LIMITS.autoSend.intervals / LIMITS.wallet). FALLBACK_*
// match app/api/_lib/limits.js exactly ([1,3,7,14,21,30] days,
// transferMin:1, transferMax:10000) and are used only until that fetch
// resolves.
const FALLBACK_INTERVALS = [1, 3, 7, 14, 21, 30];
const FALLBACK_TRANSFER_MIN = 1;
const FALLBACK_TRANSFER_MAX = 10000;

interface Schedule {
  id: string;
  recipientName: string;
  amount: number;
  intervalDays: number;
  status: string;
  nextRunAt: number | null;
  runCount: number;
}

export default function AutoSendAddon() {
  const { limits } = useLimits();
  const { formatBalance } = useCurrency();
  const INTERVALS = limits.autoSend.intervals ?? FALLBACK_INTERVALS;
  const TRANSFER_MIN = limits.wallet.transferMin ?? FALLBACK_TRANSFER_MIN;
  const TRANSFER_MAX = limits.wallet.transferMax ?? FALLBACK_TRANSFER_MAX;

  const { recipient, status, errorMsg, onEmailChange, reset } = useRecipientLookup();
  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState("");
  const [interval, setInterval_] = useState(7);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: "ok" | "err" | "" }>({ text: "", kind: "" });
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  useEffect(() => {
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadList() {
    const user = auth.currentUser;
    if (!user) return;
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/paypal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "autosend-list", idToken }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not load schedules");
      setSchedules(d.schedules || []);
    } catch (err) {
      console.error("[autosend list]", err);
    }
  }

  async function handleCancel(id: string) {
    const user = auth.currentUser;
    if (!user) return;
    setCancellingId(id);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/paypal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "autosend-cancel", idToken, scheduleId: id }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not cancel schedule");
      await loadList();
    } catch (err) {
      console.error("[autosend cancel]", err);
    } finally {
      setCancellingId(null);
    }
  }

  async function handleSubmit() {
    setMsg({ text: "", kind: "" });
    const amt = parseFloat(amount);

    if (!recipient) {
      setMsg({ text: "Enter a recipient email that matches a Siterifty account first.", kind: "err" });
      return;
    }
    if (!amt || amt < TRANSFER_MIN || amt > TRANSFER_MAX) {
      setMsg({ text: `Enter an amount between $${TRANSFER_MIN} and $${TRANSFER_MAX.toLocaleString()} USD.`, kind: "err" });
      return;
    }

    setSubmitting(true);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Not signed in");
      const idToken = await user.getIdToken();
      const res = await fetch("/api/paypal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "autosend-create",
          idToken,
          recipientUid: recipient.uid,
          amount: amt,
          intervalDays: interval,
          note: note.trim(),
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Could not schedule auto send");

      setMsg({ text: `✓ Scheduled $${amt.toFixed(2)} USD to ${result.schedule.recipientName} every ${interval} days.`, kind: "ok" });
      setEmail("");
      setAmount("");
      setNote("");
      reset();
      loadList();
    } catch (err: any) {
      console.error("[autosend create]", err);
      setMsg({ text: err.message || "Something went wrong. Please try again.", kind: "err" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="wallet-field-label">Recipient's email</div>
      <div className="wallet-input-status-wrap">
        <input
          id="asendEmail"
          className="wallet-text-input"
          type="email"
          autoComplete="off"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            onEmailChange(e.target.value);
          }}
          placeholder="friend@example.com"
        />
        <span className="wallet-input-status-icon" id="asendEmailStatus" />
      </div>
      <RecipientPreview status={status} recipient={recipient} errorMsg={errorMsg} />

      <div className="wallet-field-label" style={{ marginTop: 16 }}>Amount per send (USD)</div>
      <div className="wallet-amount-input-wrap">
        <span className="wallet-amount-currency">$</span>
        <input
          id="asendAmt"
          type="number"
          inputMode="decimal"
          min={TRANSFER_MIN}
          max={TRANSFER_MAX}
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
        />
      </div>

      <div className="wallet-field-label" style={{ marginTop: 16 }}>Repeat every</div>
      <select id="asendInterval" className="wallet-text-input" value={interval} onChange={(e) => setInterval_(Number(e.target.value))}>
        {INTERVALS.map((d) => (
          <option key={d} value={d}>
            {d} day{d !== 1 ? "s" : ""}
          </option>
        ))}
      </select>

      <div className="wallet-field-label" style={{ marginTop: 16 }}>Note (optional)</div>
      <input
        id="asendNote"
        className="wallet-text-input"
        type="text"
        maxLength={200}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What's this for?"
      />

      {msg.text ? <div id="asendMsg" className={`wallet-msg${msg.kind ? ` ${msg.kind}` : ""}`}>{msg.text}</div> : <div id="asendMsg" className="wallet-msg" />}
      <button className="wallet-submit-btn" id="asendSubmit" style={{ marginTop: 14 }} onClick={handleSubmit} disabled={submitting}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" strokeLinecap="round" />
        </svg>
        <span>{submitting ? "Scheduling…" : "Schedule Auto Send"}</span>
      </button>

      <div className="wallet-field-label" style={{ marginTop: 22 }}>Active schedules</div>
      <div id="asendList">
        {schedules?.map((s) => {
          const cancelledOrDone = s.status !== "active";
          const next = s.nextRunAt ? new Date(s.nextRunAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—";
          return (
            <div key={s.id} className="wallet-tx-row" data-schedule-id={s.id}>
              <div className={`wallet-tx-icon ${cancelledOrDone ? "neg" : "pending"}`}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 2" strokeLinecap="round" />
                </svg>
              </div>
              <div className="wallet-tx-mid">
                <div className="wallet-tx-label">
                  {formatBalance(Number(s.amount))} to {s.recipientName} · every {s.intervalDays}d
                </div>
                <div className="wallet-tx-sub">
                  {cancelledOrDone ? "Cancelled" : `Next: ${next} · Sent ${s.runCount || 0}×`}
                </div>
              </div>
              {!cancelledOrDone ? (
                <button
                  className="asend-cancel-btn"
                  data-schedule-id={s.id}
                  onClick={() => handleCancel(s.id)}
                  disabled={cancellingId === s.id}
                  style={{ background: "none", border: "1px solid rgba(247,100,100,.3)", color: "#f76464", borderRadius: 8, padding: "6px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                >
                  {cancellingId === s.id ? "Cancelling…" : "Cancel"}
                </button>
              ) : null}
            </div>
          );
        })}
        {schedules && schedules.length === 0 ? (
          <div id="asendEmpty" style={{ display: "block", textAlign: "center", padding: "18px 0", color: "rgba(255,255,255,.35)", fontSize: 12.5 }}>
            No auto sends scheduled yet.
          </div>
        ) : null}
      </div>
    </div>
  );
}
