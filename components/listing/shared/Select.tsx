"use client";

// Custom-styled dropdown replacing native <select> across all listing
// forms (Website / App / Game). Native selects render with the OS/browser's
// own popup styling, which breaks the dark, branded look of the rest of
// the form on most platforms. This component keeps the same value/onChange
// contract as a native select so it's a drop-in swap.
//
// Fully keyboard operable: Enter/Space opens, Arrow Up/Down moves the
// highlighted option, Enter selects, Escape closes. Closes on outside
// click. Accent color is passed in per-form so Website (lime), App
// (amber), and Game (amber) each keep their own theme.

import { useEffect, useRef, useState } from "react";

export interface SelectOption {
  value: string;
  label: string;
  sub?: string;
}

export default function Select({
  value,
  onChange,
  options,
  placeholder = "Select",
  accent = "#a3e635",
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: (string | SelectOption)[];
  placeholder?: string;
  accent?: string;
  disabled?: boolean;
}) {
  const normalized: SelectOption[] = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = normalized.find((o) => o.value === value) || null;

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  useEffect(() => {
    if (open) {
      const idx = normalized.findIndex((o) => o.value === value);
      setHighlight(idx >= 0 ? idx : 0);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open && listRef.current) {
      const el = listRef.current.children[highlight] as HTMLElement | undefined;
      el?.scrollIntoView({ block: "nearest" });
    }
  }, [highlight, open]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, normalized.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const opt = normalized[highlight];
      if (opt) {
        onChange(opt.value);
        setOpen(false);
      }
    }
  }

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={handleKeyDown}
        style={{
          width: "100%",
          height: 44,
          padding: "0 14px",
          background: "#09090b",
          border: `1px solid ${open ? accent : "rgba(255,255,255,0.28)"}`,
          borderRadius: 8,
          fontSize: 14,
          color: selected ? "#fff" : "rgba(255,255,255,0.35)",
          outline: "none",
          fontFamily: "inherit",
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
          textAlign: "left",
          boxShadow: open ? `0 0 0 3px ${accent}22` : "none",
          transition: "border-color 120ms, box-shadow 120ms",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selected ? selected.label : placeholder}
        </span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          style={{
            width: 16,
            height: 16,
            flexShrink: 0,
            marginLeft: 8,
            opacity: 0.5,
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 150ms",
          }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && !disabled && (
        <div
          ref={listRef}
          role="listbox"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            zIndex: 40,
            maxHeight: 260,
            overflowY: "auto",
            background: "#0d0d10",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 10,
            boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
            padding: 6,
          }}
        >
          {normalized.map((opt, i) => {
            const isSelected = opt.value === value;
            const isHighlighted = i === highlight;
            return (
              <div
                key={opt.value}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(opt.value);
                  setOpen(false);
                }}
                style={{
                  padding: "9px 10px",
                  borderRadius: 6,
                  fontSize: 13.5,
                  cursor: "pointer",
                  color: isSelected ? accent : "rgba(255,255,255,0.85)",
                  fontWeight: isSelected ? 700 : 500,
                  background: isHighlighted ? "rgba(255,255,255,0.06)" : "transparent",
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                }}
              >
                <span>{opt.label}</span>
                {opt.sub && <span style={{ fontSize: 11, opacity: 0.5, fontWeight: 400 }}>{opt.sub}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
