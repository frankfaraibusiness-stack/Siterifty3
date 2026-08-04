"use client";

import type { SettingsState } from "@/lib/useSettingsState";

const InfoIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);

const MedalIcon = ({ color }: { color: string }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8">
    <circle cx="12" cy="8" r="6" />
    <path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11" />
  </svg>
);

// Ports renderSellerBadge() exactly, including its badge-unlock rules.
// Its `case 'sellerbadge':` handler in the original is a no-op ("Badge
// data is rendered statically from state — no extra listeners needed"),
// so nothing else needs wiring here. Note the original only computes
// `unlocked` for the "verified" badge (plan !== 'free'); the other
// three (trusted/toprated/power) are hardcoded `false` in the source
// itself — not something this port simplified away, they're genuinely
// unimplemented upstream (no deal-count/rating/sales-volume check
// exists there yet either).
export default function SellerBadgePanel({
  state,
}: {
  state: SettingsState;
  setState: React.Dispatch<React.SetStateAction<SettingsState>>;
}) {
  const plan = state.plan || "free";
  const badges = [
    {
      id: "verified",
      label: "Verified Seller",
      desc: "Your identity and listings have been reviewed.",
      color: "#a3e635",
      unlocked: plan !== "free",
    },
    {
      id: "trusted",
      label: "Trusted Seller",
      desc: "Completed 5+ deals with no disputes raised.",
      color: "#60a5fa",
      unlocked: false,
    },
    {
      id: "toprated",
      label: "Top Rated",
      desc: "Maintained a buyer rating above 4.8 for 30+ days.",
      color: "#f59e0b",
      unlocked: false,
    },
    {
      id: "power",
      label: "Power Seller",
      desc: "Sold 20+ products totaling over $10,000.",
      color: "#d8b4fe",
      unlocked: false,
    },
  ];

  return (
    <>
      <div className="detail-panel-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2">
          <circle cx="12" cy="8" r="6" />
          <path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11" />
        </svg>
        <h3>Seller Badge</h3>
      </div>
      <p className="detail-panel-desc">
        Badges signal trust and experience to buyers. The more deals you close, the more you unlock.
      </p>
      <hr className="detail-divider" />

      <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        {badges.map((b) => (
          <div
            key={b.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.9rem",
              background: "#0a0a0a",
              border: `1px solid ${b.unlocked ? b.color + "33" : "#1a1a1a"}`,
              borderRadius: "0.9rem",
              padding: "1rem 1.1rem",
              opacity: b.unlocked ? 1 : 0.5,
            }}
          >
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: b.unlocked ? b.color + "18" : "rgba(255,255,255,0.04)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <MedalIcon color={b.unlocked ? b.color : "#555"} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: b.unlocked ? "#fff" : "#555", marginBottom: 2 }}>
                {b.label}
              </div>
              <div style={{ fontSize: 11.5, color: "#555", lineHeight: 1.4 }}>{b.desc}</div>
            </div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                padding: "3px 9px",
                borderRadius: 20,
                background: b.unlocked ? b.color + "18" : "rgba(255,255,255,0.04)",
                color: b.unlocked ? b.color : "#444",
                border: `1px solid ${b.unlocked ? b.color + "33" : "transparent"}`,
                whiteSpace: "nowrap",
              }}
            >
              {b.unlocked ? "Earned" : "Locked"}
            </div>
          </div>
        ))}
      </div>

      <div className="info-card" style={{ marginTop: "0.75rem", borderColor: "rgba(255,255,255,0.08)" }}>
        <InfoIcon />
        <span className="info-text" style={{ color: "#777" }}>
          Badges appear on your public profile and listing cards. Verified Seller requires an active paid plan.
        </span>
      </div>
    </>
  );
}
