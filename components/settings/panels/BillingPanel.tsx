"use client";

import { useState } from "react";
import { auth } from "@/lib/firebase";
import type { SettingsState } from "@/lib/useSettingsState";
import { useSrToast } from "@/components/system/SrToastProvider";
import { useConfirm } from "@/lib/useConfirm";
import { usePlansModal } from "@/components/billing/PlansModalProvider";
import { useLimits } from "@/lib/useLimits";

const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <path d="M9 12l2 2 4-4" />
    <path d="M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z" />
  </svg>
);

const PLAN_ORDER = ["free", "starter", "growth", "pro"];

export default function BillingPanel({
  state,
  setState,
}: {
  state: SettingsState;
  setState: React.Dispatch<React.SetStateAction<SettingsState>>;
}) {
  const { show: toast } = useSrToast();
  const { confirm, ConfirmHost } = useConfirm();
  const { openPlansModal } = usePlansModal();
  const { limits } = useLimits();
  const [cancelling, setCancelling] = useState(false);

  // Adapts useLimits()'s LimitsPlan shape (saleFeeDisplay/description) to
  // this component's existing field names (fee/desc) so the JSX below
  // didn't need touching — same plan data as LIMITS.plans, just relabeled.
  const PLANS = Object.fromEntries(
    Object.entries(limits.plans).map(([key, p]) => [
      key,
      { name: p.name, price: p.price, color: p.color, fee: p.saleFeeDisplay, desc: p.description },
    ])
  );

  const currentPlan = state.plan || "free";
  const plan = PLANS[currentPlan] || PLANS.free;
  const upgradeCards = PLAN_ORDER.filter((p) => p !== "free" && p !== currentPlan);

  // Ports cancelPlanBtn's handler — confirm, then POST /api/paypal with
  // action 'cancel-sub' (route already ported server-side, Step 7).
  async function handleCancel() {
    const user = auth.currentUser;
    if (!user) return;
    const ok = await confirm({
      theme: "danger",
      title: "Cancel Subscription",
      msg: "Your plan will downgrade to Free at the end of the current billing cycle. All Pro features will be disabled.",
      confirmText: "Cancel Subscription",
      cancelText: "Keep Plan",
    });
    if (!ok) return;
    setCancelling(true);
    try {
      const idToken = await user.getIdToken();
      const r = await fetch("/api/paypal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel-sub", idToken }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Cancellation failed");
      setState((prev) => ({ ...prev, plan: "free" }));
      toast("Subscription cancelled. Your plan reverts to Free at end of cycle.", "success");
    } catch (err: any) {
      toast(`Error: ${err.message}`, "error");
    } finally {
      setCancelling(false);
    }
  }

  return (
    <>
      <div className="detail-panel-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
          <line x1="1" y1="10" x2="23" y2="10" />
        </svg>
        <h3>Billing & Plans</h3>
      </div>
      <p className="detail-panel-desc">Manage your subscription. Payments processed securely via PayPal.</p>
      <hr className="detail-divider" />

      <div className="info-card" style={{ borderColor: `${plan.color}44` }}>
        <CheckIcon />
        <span className="info-text">
          <strong>Current Plan:</strong>{" "}
          <span style={{ color: plan.color, fontWeight: 700 }}>{plan.name}</span>
          {currentPlan !== "free" ? " · Active subscription" : " · Free forever"}
        </span>
      </div>

      {currentPlan !== "free" ? (
        <button className="danger-btn" style={{ marginBottom: "1rem" }} onClick={handleCancel} disabled={cancelling}>
          {cancelling ? "Cancelling…" : "Cancel Subscription"}
        </button>
      ) : null}

      {upgradeCards.length > 0 ? (
        upgradeCards.map((p) => {
          const info = PLANS[p];
          return (
            <div
              key={p}
              className="info-card"
              style={{ flexDirection: "column", alignItems: "stretch", borderColor: `${info.color}33` }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <span style={{ fontWeight: 700, color: info.color, fontSize: "0.95rem" }}>{info.name} Plan</span>
                <span style={{ fontSize: "0.88rem", color: "#aaa" }}>
                  ${info.price}/mo · {info.fee} fee
                </span>
              </div>
              <span className="hint" style={{ marginBottom: "0.7rem" }}>
                {info.desc}
              </span>
              {/* Ports data-paypal-plan upgrade buttons — the original wires
                  these through a separate standalone Plans modal
                  (window.__openPlansModal) via document-level delegation.
                  Now that /upgrade is a full page, this navigates there
                  with this card's plan preselected. */}
              <button
                className="save-btn"
                style={{ background: info.color, color: "#000", padding: "0.6rem 1rem", fontSize: "0.82rem" }}
                onClick={() => openPlansModal(p as "starter" | "growth" | "pro")}
              >
                Upgrade
              </button>
            </div>
          );
        })
      ) : (
        <p style={{ color: "#a3e635", fontSize: "0.88rem" }}>You are on the highest plan. Thank you!</p>
      )}

      <p className="plans-note" style={{ marginTop: "1rem", color: "#444", fontSize: "0.72rem" }}>
        All payments handled by PayPal · Cancel anytime · No hidden fees
      </p>

      <ConfirmHost />
    </>
  );
}
