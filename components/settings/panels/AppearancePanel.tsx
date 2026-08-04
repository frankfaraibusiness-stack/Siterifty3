"use client";

import { useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type { SettingsState } from "@/lib/useSettingsState";
import { useSrToast } from "@/components/system/SrToastProvider";
import { useThemeModal } from "@/components/theme/ThemeModalProvider";
import { useCurrency } from "@/lib/CurrencyContext";
import { SUPPORTED_CURRENCIES, CURRENCY_LABELS } from "@/lib/currencies";

const SaveIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <path d="M19 21H5C3.89543 21 3 20.1046 3 19V5C3 3.89543 3.89543 3 5 3H16L21 8V19C21 20.1046 20.1046 21 19 21Z" />
  </svg>
);

const FONT_SIZE_PX: Record<string, string> = { small: "13px", medium: "15px", large: "17px" };

const FONT_SIZES: { key: "small" | "medium" | "large"; label: string; glyphSize: string }[] = [
  { key: "small", label: "Small", glyphSize: "0.72rem" },
  { key: "medium", label: "Medium", glyphSize: "0.9rem" },
  { key: "large", label: "Large", glyphSize: "1.1rem" },
];

export default function AppearancePanel({
  state,
  setState,
}: {
  state: SettingsState;
  setState: React.Dispatch<React.SetStateAction<SettingsState>>;
}) {
  const { show: toast } = useSrToast();
  const { openThemePicker } = useThemeModal();
  const { currency, setCurrency } = useCurrency();

  const [fontSize, setFontSize] = useState(state.fontSize);
  const [compactMode, setCompactMode] = useState(state.compactMode);
  const [saving, setSaving] = useState(false);

  // Ports applyFontSize — applies immediately to the document, persists a
  // localStorage fallback, and syncs to Firestore, matching the original's
  // instant-apply behavior for the 3-button font size picker.
  async function handleFontSizeChange(size: "small" | "medium" | "large") {
    setFontSize(size);
    setState((prev) => ({ ...prev, fontSize: size }));
    const px = FONT_SIZE_PX[size] || "15px";
    if (typeof document !== "undefined") {
      document.documentElement.style.setProperty("--app-font-size", px);
      document.body.style.fontSize = px;
      try {
        localStorage.setItem("srf_fontSize", size);
      } catch {}
    }
    const user = auth.currentUser;
    if (!user) return;
    try {
      await updateDoc(doc(db, "users", user.uid), { fontSize: size });
      toast(`Font size set to ${size}.`, "success");
    } catch {
      toast("Save failed.", "error");
    }
  }

  // Ports compactModeToggle's change handler — applies the class instantly
  // so the user sees the effect before the Save button is even pressed.
  function handleCompactModeChange(checked: boolean) {
    setCompactMode(checked);
    if (typeof document !== "undefined") {
      if (checked) {
        document.body.classList.add("compact-mode");
        try {
          localStorage.setItem("srf_compactMode", "1");
        } catch {}
      } else {
        document.body.classList.remove("compact-mode");
        try {
          localStorage.removeItem("srf_compactMode");
        } catch {}
      }
    }
  }

  // Ports saveAppearanceBtn — persists fontSize + compactMode together.
  async function handleSave() {
    const user = auth.currentUser;
    if (!user) {
      toast("Not signed in.", "error");
      return;
    }
    setSaving(true);
    try {
      await updateDoc(doc(db, "users", user.uid), { fontSize: fontSize || "medium", compactMode });
      setState((prev) => ({ ...prev, fontSize, compactMode }));
      handleCompactModeChange(compactMode);
    } catch (err: any) {
      toast(`Save failed: ${err.message}`, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="detail-panel-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 2a10 10 0 0 1 0 20" />
        </svg>
        <h3>Appearance</h3>
      </div>
      <p className="detail-panel-desc">Customize how Siterifty looks and feels.</p>
      <hr className="detail-divider" />

      <div className="input-group">
        <label>Themes</label>
        <p style={{ fontSize: "0.8rem", color: "#777", marginBottom: "0.75rem" }}>
          Choose a background theme for modals and panels. Your selection syncs across devices.
        </p>
        <button
          className="save-btn"
          style={{ background: "rgba(167,139,250,0.12)", border: "1px solid rgba(167,139,250,0.3)", color: "#c4b5fd" }}
          onClick={openThemePicker}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="13.5" cy="6.5" r="2.5" />
            <path d="M19.5 12.5L12 20l-8-8 7.5-7.5L19.5 12.5z" />
          </svg>
          Open Theme Picker
        </button>
      </div>

      <hr className="detail-divider" />

      <div className="input-group">
        <label>Currency</label>
        <p style={{ fontSize: "0.8rem", color: "#777", marginBottom: "0.75rem" }}>
          Show listing prices converted to your preferred currency while browsing. This is an
          estimate only — every deal is still charged and settled in USD.
        </p>
        <select
          className="select-field"
          value={currency}
          onChange={(e) => {
            setCurrency(e.target.value as (typeof SUPPORTED_CURRENCIES)[number]);
            toast(`Prices now shown in ${e.target.value}.`, "info");
          }}
        >
          {SUPPORTED_CURRENCIES.map((code) => (
            <option key={code} value={code}>
              {code} — {CURRENCY_LABELS[code]}
            </option>
          ))}
        </select>
        {currency !== "USD" && (
          <span className="hint" style={{ marginTop: "0.35rem" }}>
            Prices will show as, e.g., <strong>€1,240 (≈ $1,350 USD)</strong>.
          </span>
        )}
      </div>

      <hr className="detail-divider" />

      <div className="input-group">
        <label>Font Size</label>
        <p style={{ fontSize: "0.78rem", color: "#666", marginBottom: "0.6rem" }}>Applies immediately across the entire app.</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.45rem" }}>
          {FONT_SIZES.map((f) => {
            const active = fontSize === f.key || (!fontSize && f.key === "medium");
            return (
              <button
                key={f.key}
                className="font-size-btn"
                data-size={f.key}
                onClick={() => handleFontSizeChange(f.key)}
                style={{
                  padding: "0.75rem 0.5rem",
                  borderRadius: "0.7rem",
                  border: `1.5px solid ${active ? "#8b9cf7" : "#222"}`,
                  background: active ? "rgba(139,156,247,0.12)" : "#0d0d0d",
                  color: active ? "#8b9cf7" : "#888",
                  fontFamily: "inherit",
                  cursor: "pointer",
                  fontSize: "0.78rem",
                  fontWeight: 700,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "0.3rem",
                  transition: "all .15s",
                }}
              >
                <span style={{ fontSize: f.glyphSize }}>Aa</span>
                <span>{f.label}</span>
              </button>
            );
          })}
        </div>
        <span className="hint" style={{ marginTop: "0.35rem" }}>
          Currently: <strong>{fontSize || "medium"}</strong>
        </span>
      </div>

      <div className="toggle-item">
        <div className="toggle-label-wrap">
          <span className="toggle-label">Compact Mode</span>
          <span className="toggle-sublabel">Reduce spacing to fit more content on screen.</span>
        </div>
        <label className="toggle-switch">
          <input type="checkbox" checked={compactMode} onChange={(e) => handleCompactModeChange(e.target.checked)} />
          <span className="slider" />
        </label>
      </div>

      <button className="save-btn" onClick={handleSave} disabled={saving}>
        <SaveIcon />
        {saving ? "Saving…" : "Save Appearance"}
      </button>

    </>
  );
}
