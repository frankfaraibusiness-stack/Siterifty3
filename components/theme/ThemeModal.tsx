"use client";

import { useEffect, useRef, useState } from "react";
import { applyTheme, persistTheme, type SiteTheme } from "@/components/theme/ThemeModalProvider";

// Theme picker grid contents.
// All themes are free solid-color swatches: Black, Dark Blue, Dark Purple.
// Black is also the app-wide default (see DEFAULT_THEME in
// ThemeModalProvider). No image/premium themes at this time.
const THEME_OPTIONS: Array<
  | { id: string; type: "image"; label: string; src: string; premium?: boolean }
  | { id: string; type: "color"; label: string; color: string; overlay: string; textmode: string; swatchBg: string; swatchLabelColor: string; premium?: boolean }
> = [
  {
    id: "color-black",
    type: "color",
    label: "Black",
    color: "#000000",
    overlay: "rgba(0,0,0,0)",
    textmode: "dark",
    swatchBg: "#000",
    swatchLabelColor: "rgba(255,255,255,0.8)",
  },
  {
    id: "color-navy",
    type: "color",
    label: "Dark Blue",
    // Darkened from #0a1128 — that was already a dark navy, but next to
    // the pure-black default it still read as noticeably "blue" rather
    // than "black with a hint of blue". Dropped further toward black
    // and paired with a light overlay tint (below) so cards/panels that
    // sit on rgba(0,0,0,X) surfaces still read as dark UI, not a
    // colored background.
    color: "#05070f",
    overlay: "rgba(4,8,20,0.35)",
    textmode: "dark",
    swatchBg: "#05070f",
    swatchLabelColor: "rgba(255,255,255,0.8)",
  },
  {
    id: "color-plum",
    type: "color",
    label: "Dark Purple",
    // Same treatment as Dark Blue — darkened from #1a0b2e toward black.
    color: "#0c0512",
    overlay: "rgba(16,4,24,0.35)",
    textmode: "dark",
    swatchBg: "#0c0512",
    swatchLabelColor: "rgba(255,255,255,0.8)",
  },
];

const STORAGE_KEY = "siterifty_theme";

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function CrownIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export default function ThemeModal({
  open,
  onClose,
  plan,
}: {
  open: boolean;
  onClose: () => void;
  plan: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());
  const [nudge, setNudge] = useState(false);
  const nudgeTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const isFree = plan === "free";

  // Ports __openThemePicker's pre-highlight of the currently active theme.
  useEffect(() => {
    if (!open) return;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.id) {
          setSelectedId(parsed.id);
          return;
        }
      }
    } catch {
      // ignore corrupted storage
    }
    setSelectedId("color-black");
  }, [open]);

  useEffect(() => {
    return () => {
      nudgeTimers.current.forEach(clearTimeout);
    };
  }, []);

  function showUpgradeNudge() {
    setNudge(true);
    nudgeTimers.current.forEach(clearTimeout);
    nudgeTimers.current = [
      setTimeout(() => setNudge(false), 2200),
    ];
  }

  // Ports the unified `#themeGrid` click listener — applies instantly,
  // no confirm button needed, same as the original.
  function handleSelect(opt: (typeof THEME_OPTIONS)[number]) {
    if (blockedIds.has(opt.id)) return;
    if ("premium" in opt && opt.premium && isFree) {
      showUpgradeNudge();
      return;
    }
    const theme: SiteTheme =
      opt.type === "color"
        ? { id: opt.id, type: "color", color: opt.color, overlay: opt.overlay, textmode: opt.textmode }
        : { id: opt.id, type: "image", src: opt.src, textmode: "dark" };
    setSelectedId(opt.id);
    applyTheme(theme);
    persistTheme(theme);
  }

  function handleImgError(id: string) {
    setBlockedIds((prev) => new Set(prev).add(id));
  }

  if (!open) return null;

  return (
    <div
      id="themeModal"
      style={{ display: "flex" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="theme-card">
        <div className="theme-card-sticky-header">
          <div className="theme-heading" style={{ marginBottom: 0 }}>
            Pick a theme
          </div>
          <button
            onClick={onClose}
            style={{
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: "50%",
              width: 30,
              height: 30,
              minWidth: 30,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              color: "#fff",
            }}
          >
            <CloseIcon />
          </button>
        </div>
        <div className="theme-card-scroll" data-scroll-lock-exempt>
        <div className="theme-sub">Tap any theme to apply it instantly. Syncs across all your devices.</div>
        <div className="theme-divider" />
        <div className="theme-grid" id="themeGrid">
          {THEME_OPTIONS.map((opt) => {
            const isPremium = "premium" in opt && !!opt.premium;
            const isBlocked = blockedIds.has(opt.id);
            const isSelected = selectedId === opt.id;
            const classes = [
              "theme-opt",
              opt.type === "color" ? "color-swatch" : "",
              isPremium ? "premium-locked" : "",
              isSelected ? "selected" : "",
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <div
                key={opt.id}
                className={classes}
                data-theme={opt.id}
                style={
                  opt.type === "color"
                    ? ({
                        "--swatch-bg": opt.swatchBg,
                        "--swatch-label-color": opt.swatchLabelColor,
                        opacity: isBlocked ? 0.45 : undefined,
                        cursor: isBlocked ? "not-allowed" : undefined,
                      } as React.CSSProperties)
                    : {
                        opacity: isBlocked ? 0.45 : undefined,
                        cursor: isBlocked ? "not-allowed" : undefined,
                      }
                }
                onClick={() => handleSelect(opt)}
              >
                {opt.type === "image" && (
                  <img src={opt.src} alt={`${opt.label} theme`} loading="lazy" onError={() => handleImgError(opt.id)} />
                )}
                {isPremium && (
                  <>
                    <div className="theme-opt-premium-badge">
                      <CrownIcon /> Pro
                    </div>
                    <div className="theme-opt-lock-icon">
                      <LockIcon />
                    </div>
                  </>
                )}
                {!isPremium && (
                  <div className="theme-opt-check">
                    <CheckIcon />
                  </div>
                )}
                {isBlocked && (
                  <div
                    className="lfm-blocked-badge"
                    style={{
                      position: "absolute",
                      inset: 0,
                      zIndex: 4,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "rgba(0,0,0,0.6)",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 900,
                        letterSpacing: "0.1em",
                        color: "#f87171",
                        textTransform: "uppercase",
                        background: "rgba(239,68,68,0.18)",
                        border: "1px solid rgba(239,68,68,0.4)",
                        borderRadius: 4,
                        padding: "3px 7px",
                      }}
                    >
                      Blocked
                    </span>
                  </div>
                )}
                <div className="theme-opt-label">{opt.label}</div>
              </div>
            );
          })}
        </div>
        </div>
      </div>

      {nudge && (
        <div
          style={{
            position: "fixed",
            bottom: "5rem",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 99999,
            background: "linear-gradient(135deg,#f59e0b,#d97706)",
            color: "#000",
            fontWeight: 800,
            fontSize: 12,
            padding: "10px 20px",
            borderRadius: 50,
            boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
            whiteSpace: "nowrap",
            animation: "fadeInUp .25s ease",
            pointerEvents: "none",
          }}
        >
          ✦ Pro themes — upgrade to unlock
        </div>
      )}
    </div>
  );
}
