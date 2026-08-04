"use client";

import { useState, useRef, useEffect } from "react";
import type { PlatformKey } from "./platforms";
import { PLATFORM_ICON_PATH } from "./platforms";

// Renders one platform's brand/generic glyph from the shared path map in
// platforms.ts. `size` controls both the box and the glyph itself.
export function PlatformIcon({ platform, size = 18, color }: { platform: PlatformKey; size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color || "currentColor"} style={{ flexShrink: 0 }}>
      <path d={PLATFORM_ICON_PATH[platform]} />
    </svg>
  );
}

// Multi-select platform picker styled like a dropdown menu (closed pill
// showing the current selection + icons, opens into a checklist) rather
// than the old row of 3 plain text-only toggle buttons — makes each
// platform recognizable at a glance instead of reading as generic pills.
// Selection semantics are unchanged: still a multi-select (toggling one
// platform on/off), just presented as a dropdown instead of inline
// buttons since the option list itself doesn't need to always be visible.
//
// `meta` only needs a `label` per key — deliberately looser than the full
// PlatformMeta shape in platforms.ts, so both AppListingForm's local
// 3-platform meta and GameListingForm's full shared PLATFORM_META can be
// passed directly without an adapter.
export default function PlatformPicker({
  keys,
  meta,
  selected,
  onToggle,
  accent,
  disabled,
}: {
  keys: PlatformKey[];
  meta: Record<string, { label: string }>;
  selected: Set<string>;
  onToggle: (p: PlatformKey) => void;
  accent: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const selectedKeys = keys.filter((k) => selected.has(k));

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        style={{
          width: "100%",
          minHeight: 44,
          padding: "8px 14px",
          background: "#09090b",
          border: `1px solid ${open ? accent : "rgba(255,255,255,0.28)"}`,
          borderRadius: 8,
          color: "#fff",
          fontSize: 14,
          fontFamily: "inherit",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {selectedKeys.length === 0 ? (
          <span style={{ color: "rgba(255,255,255,0.4)" }}>Select platforms</span>
        ) : (
          <span style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {selectedKeys.map((k) => (
              <span key={k} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <PlatformIcon platform={k} size={16} color={accent} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>{meta[k].label}</span>
              </span>
            ))}
          </span>
        )}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2.5" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s ease", flexShrink: 0 }}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && !disabled && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            background: "#141416",
            border: "1px solid rgba(255,255,255,0.14)",
            borderRadius: 10,
            padding: 6,
            zIndex: 30,
            boxShadow: "0 12px 28px rgba(0,0,0,0.5)",
          }}
        >
          {keys.map((k) => {
            const isSelected = selected.has(k);
            return (
              <button
                key={k}
                type="button"
                onClick={() => onToggle(k)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 10px",
                  background: isSelected ? `${accent}14` : "transparent",
                  border: "none",
                  borderRadius: 7,
                  color: "#fff",
                  fontSize: 13.5,
                  fontFamily: "inherit",
                  fontWeight: isSelected ? 700 : 500,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <PlatformIcon platform={k} size={18} color={isSelected ? accent : "rgba(255,255,255,0.6)"} />
                <span style={{ flex: 1 }}>{meta[k].label}</span>
                {isSelected && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
