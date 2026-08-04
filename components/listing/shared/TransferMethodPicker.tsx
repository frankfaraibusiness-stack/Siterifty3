"use client";

import type { TransferMethod } from "./transferMethods";

// Renders the transfer-method checklist for a listing form. Groups by
// safety tier with a small heading per group instead of a flat grid, so
// the recommended/escrow-backed options read as the obvious first choice
// rather than being just another item in a list.

const TIER_LABEL: Record<TransferMethod["tier"], string> = {
  recommended: "Recommended — escrow or platform-verified",
  standard: "Standard methods",
  caution: "Use with caution",
};

export default function TransferMethodPicker({
  methods,
  selected,
  onToggle,
  accent,
}: {
  methods: TransferMethod[];
  selected: string[];
  onToggle: (value: string) => void;
  accent: string;
}) {
  const tiers: TransferMethod["tier"][] = ["recommended", "standard", "caution"];

  return (
    <div>
      {tiers.map((tier) => {
        const group = methods.filter((m) => m.tier === tier);
        if (group.length === 0) return null;
        return (
          <div key={tier} style={{ marginBottom: 14 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                marginBottom: 8,
                color: tier === "recommended" ? accent : tier === "caution" ? "#f59e0b" : "rgba(255,255,255,0.4)",
              }}
            >
              {TIER_LABEL[tier]}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
              {group.map((m) => {
                const isSelected = selected.includes(m.value);
                return (
                  <label
                    key={m.value}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      padding: "12px 14px",
                      background: isSelected ? `${accent}14` : "rgba(255,255,255,0.03)",
                      border: `1px solid ${isSelected ? `${accent}55` : "rgba(255,255,255,0.08)"}`,
                      borderRadius: 10,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggle(m.value)}
                      style={{ accentColor: accent, marginTop: 2, flexShrink: 0 }}
                    />
                    <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      <span style={{ fontWeight: 600, fontSize: 13.5 }}>{m.label}</span>
                      <span
                        style={{
                          fontSize: 11.5,
                          lineHeight: 1.4,
                          color: m.tier === "caution" ? "#f0b45f" : "rgba(255,255,255,0.5)",
                        }}
                      >
                        {m.note}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
