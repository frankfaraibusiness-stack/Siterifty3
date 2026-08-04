"use client";

import { useEffect, useRef, useState } from "react";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/lib/AuthContext";
import { loadPaypalSdk } from "@/lib/paypalSdk";
import { useLimits } from "@/lib/useLimits";
import { useScrollLock } from "@/lib/useScrollLock";
import { useCurrency } from "@/lib/CurrencyContext";

// Ports the PLANS MODAL from plans-boost.js (index.html lines
// 22915-23678). PLAN_DATA below is a mix of two kinds of content:
//   - Live business numbers (price, fee, color, tagline) — these now come
//     from useLimits() (GET /api/limits, LIMITS.plans) inside the
//     component below, via withLiveNumbers(). The literals here are only
//     the fallback, used until that fetch resolves.
//   - Static marketing content (pills, features checklist) — this isn't
//     part of LIMITS at all (the original's own window.__limits has no
//     equivalent field for it either), so it stays hardcoded here; there's
//     nothing to fetch.
type PlanKey = "starter" | "growth" | "pro";

interface PlanInfo {
  name: string;
  price: number;
  fee: string;
  color: string;
  tagline: string;
  pills: string[];
  features: { text: string; on: boolean }[];
}

const PLAN_DATA: Record<PlanKey, PlanInfo> = {
  starter: {
    name: "Starter",
    price: 10,
    fee: "24%",
    color: "#60a5fa",
    tagline: "For developers listing regularly",
    pills: ["15 listings/wk", "24% fee"],
    features: [
      { text: "Escrow protection", on: true },
      { text: "Wallet access", on: true },
      { text: "Basic analytics", on: true },
      { text: "Priority placement", on: true },
      { text: "Featured badge", on: false },
      { text: "Dedicated support", on: false },
    ],
  },
  growth: {
    name: "Growth",
    price: 20,
    fee: "18%",
    color: "#a3e635",
    tagline: "For serious sellers scaling up",
    pills: ["30 listings/wk", "18% fee"],
    features: [
      { text: "Escrow protection", on: true },
      { text: "Wallet access", on: true },
      { text: "Advanced analytics", on: true },
      { text: "Priority placement", on: true },
      { text: "Featured badge", on: true },
      { text: "Dedicated support", on: false },
    ],
  },
  pro: {
    name: "Pro",
    price: 30,
    fee: "12%",
    color: "#d8b4fe",
    tagline: "For high-volume power sellers",
    pills: ["Unlimited listings", "12% fee"],
    features: [
      { text: "Escrow protection", on: true },
      { text: "Wallet access", on: true },
      { text: "Full analytics dashboard", on: true },
      { text: "Top placement + Pro badge", on: true },
      { text: "Featured badge", on: true },
      { text: "Dedicated support", on: true },
    ],
  },
};

const PLAN_ORDER: PlanKey[] = ["starter", "growth", "pro"];

const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a3e635" strokeWidth="2.4" strokeLinecap="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const XIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#444" strokeWidth="2.4" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

export default function PlansModal({
  open,
  preselect,
  onClose,
  onSubscribed,
}: {
  open: boolean;
  preselect?: PlanKey;
  onClose: () => void;
  onSubscribed: (plan: PlanKey) => void;
}) {
  const { profile } = useAuth();
  const currentPlan = (profile?.plan || "free") as string;
  const { limits } = useLimits();
  const { currency, formatBalance } = useCurrency();

  // Merges live price/fee/color/tagline from useLimits() onto the static
  // PLAN_DATA fallback (pills/features have no live equivalent — see the
  // header comment above). Falls back to PLAN_DATA's own literal for any
  // key useLimits() doesn't resolve yet.
  const PLANS: Record<PlanKey, PlanInfo> = Object.fromEntries(
    (Object.entries(PLAN_DATA) as [PlanKey, PlanInfo][]).map(([key, fallback]) => {
      const live = limits.plans[key];
      return [
        key,
        live
          ? { ...fallback, price: live.price, fee: live.saleFeeDisplay, color: live.color, tagline: live.tagline }
          : fallback,
      ];
    })
  ) as Record<PlanKey, PlanInfo>;

  const [activePlan, setActivePlan] = useState<PlanKey>("growth");
  const [showSubscribeBtn, setShowSubscribeBtn] = useState(true);
  const [msg, setMsg] = useState<{ text: string; kind: "ok" | "err" | "" }>({ text: "", kind: "" });

  const paypalContainerRef = useRef<HTMLDivElement>(null);
  const buttonsRef = useRef<any>(null);

  // Scroll lock — shared across every modal/overlay in the app.
  useScrollLock(open);

  // Ports openPlansModal's preselect/default-tab logic.
  useEffect(() => {
    if (!open) return;
    let start: PlanKey =
      preselect && PLANS[preselect]
        ? preselect
        : currentPlan === "starter"
        ? "growth"
        : currentPlan === "growth"
        ? "pro"
        : "growth";
    if (currentPlan !== "free" && PLANS[currentPlan as PlanKey] && !preselect) {
      start = currentPlan as PlanKey;
    }
    setActivePlan(start);
    setShowSubscribeBtn(true);
    setMsg({ text: "", kind: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preselect]);

  function selectPlan(key: PlanKey) {
    setActivePlan(key);
    setShowSubscribeBtn(true);
    setMsg({ text: "", kind: "" });
    buttonsRef.current?.close?.();
    buttonsRef.current = null;
    if (paypalContainerRef.current) paypalContainerRef.current.innerHTML = "";
  }

  async function mountPaypalButton(planKey: PlanKey) {
    const container = paypalContainerRef.current;
    const user = auth.currentUser;
    if (!container) return;
    if (!user) {
      setMsg({ text: "Log in to subscribe.", kind: "err" });
      return;
    }

    buttonsRef.current?.close?.();
    container.innerHTML = '<div style="height:45px;border-radius:50px;background:rgba(255,255,255,.06);"></div>';
    setMsg({ text: "", kind: "" });

    let paypal;
    try {
      paypal = await loadPaypalSdk("vault=true&intent=subscription&components=buttons");
    } catch (err) {
      console.error("[plans] SDK load failed", err);
      container.innerHTML = "";
      setMsg({ text: "Could not load PayPal. Check your connection and try again.", kind: "err" });
      return;
    }

    if (activePlan !== planKey) return; // switched tabs while loading
    container.innerHTML = "";

    buttonsRef.current = paypal.Buttons({
      style: { layout: "horizontal", color: "gold", shape: "pill", height: 45, label: "subscribe" },

      createSubscription: async () => {
        try {
          const idToken = await user.getIdToken();
          const res = await fetch("/api/paypal", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "get-plan-id", idToken, plan: planKey }),
          });
          const d = await res.json();
          if (!res.ok) throw new Error(d.error || "Could not start subscription");
          return d.planId;
        } catch (err: any) {
          setMsg({ text: err.message || "Could not start subscription", kind: "err" });
          throw err;
        }
      },

      onApprove: async (data: { subscriptionID: string }) => {
        try {
          const idToken = await user.getIdToken();
          const res = await fetch("/api/paypal", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "activate-sub",
              idToken,
              plan: planKey,
              subscriptionID: data.subscriptionID,
            }),
          });
          const d = await res.json();
          if (!res.ok) throw new Error(d.error || "Subscription could not be activated");

          setMsg({ text: `You're now on the ${PLANS[planKey].name} plan.`, kind: "ok" });
          onSubscribed(planKey);
        } catch (err: any) {
          setMsg({ text: err.message || "Subscription could not be activated", kind: "err" });
        }
      },

      onError: (err: unknown) => {
        console.error("[plans] PayPal Buttons error", err);
        setMsg({ text: "PayPal ran into a problem. Please try again.", kind: "err" });
      },

      onCancel: () => {
        setMsg({ text: "", kind: "" });
      },
    });

    buttonsRef.current.render(container).catch((err: unknown) => {
      console.error("[plans] Buttons render failed", err);
      container.innerHTML = "";
      setMsg({ text: "Could not display PayPal button.", kind: "err" });
    });
  }

  if (!open) return null;

  const p = PLANS[activePlan];
  const isCurrentPlan = currentPlan === activePlan;

  return (
    <div
      id="srfPlansOverlay"
      className="active"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="srf-plans-modal">
        <div className="srf-plans-header">
          <div className="srf-plans-brand">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
            <h2>Upgrade Plan</h2>
          </div>
          <button className="srf-plans-close" id="srfPlansCloseBtn" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="srf-plans-tabs" id="srfPlansTabs">
          {PLAN_ORDER.map((key) => (
            <button
              key={key}
              className={`srf-plan-tab${activePlan === key ? " active" : ""}`}
              data-plan={key}
              onClick={() => selectPlan(key)}
            >
              {PLANS[key].name}
              {key === "growth" ? <span className="srf-plan-chip">popular</span> : null}
            </button>
          ))}
        </div>

        <div className="srf-plans-body" id="srfPlansBody" data-scroll-lock-exempt>
          <div className="srf-plan-name">
            {p.name}
            {activePlan === "growth" ? <span className="srf-plan-chip">popular</span> : null}
          </div>
          <div className="srf-plan-price">
            {formatBalance(p.price).replace(/\.00$/, "")}
            <small>/month</small>
          </div>
          {currency !== "USD" && (
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: -8, marginBottom: 4 }}>
              Billed in USD via PayPal — shown converted to {currency}
            </div>
          )}
          <p className="srf-plan-desc">{p.tagline}</p>
          <div className="srf-plan-pills">
            {p.pills.map((text) => (
              <span key={text} className="srf-plan-pill" style={{ color: p.color, borderColor: `${p.color}55` }}>
                {text}
              </span>
            ))}
          </div>
          <ul className="srf-plan-features">
            {p.features.map((f) => (
              <li key={f.text} className={f.on ? "" : "is-dim"}>
                {f.on ? <CheckIcon /> : <XIcon />}
                {f.text}
              </li>
            ))}
          </ul>
        </div>

        <div className="srf-plans-footer">
          <div id="srfPlansFooterInner">
            {isCurrentPlan ? (
              <div className="srf-current-banner">✓ This is your current plan</div>
            ) : (
              <>
                {showSubscribeBtn ? (
                  <button
                    id="srfSubscribeBtn"
                    className="srf-subscribe-cta"
                    style={{ background: p.color, color: "#000" }}
                    onClick={() => {
                      setShowSubscribeBtn(false);
                      mountPaypalButton(activePlan);
                    }}
                  >
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                    Subscribe to {p.name}
                  </button>
                ) : null}
                <div id="srfPlansPaypalContainer" ref={paypalContainerRef} />
              </>
            )}
          </div>
          <div className={`srf-plans-msg${msg.kind ? ` ${msg.kind}` : ""}`} id="srfPlansMsg">
            {msg.text}
          </div>
          <p className="srf-plans-note">Secure payment via PayPal · Cancel anytime</p>
        </div>
      </div>
    </div>
  );
}
