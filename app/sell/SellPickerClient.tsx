"use client";

// Type picker for /sell. Each type now lives at its own route
// (/sell/website, /sell/app, /sell/game, /sell/template) instead of being a
// client-side state swap on this one page — that was the root cause of the
// broken in-app "Back" button: with everything living under a single /sell
// URL, there was only ever one browser history entry, so "Back" had nowhere
// real to go and fell through to a hard-coded /marketplace redirect instead
// of returning here. Real routes also mean each listing type gets its own
// indexable URL for SEO instead of hiding behind one client-rendered screen.
//
// The weekly-listing-limit bar + plan upgrade prompt (#lmLimitRow/lmPlansRow
// in the original auth-modal.js) is unchanged — a heads-up read of the same
// check-listing-cap action /api/limits already exposes (see
// app/api/_lib/limits.js's handleCheckListingCap). The server still enforces
// the real cap independently on submit either way.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { useAuthModal } from "@/components/auth/AuthModalProvider";
import { usePlansModal } from "@/components/billing/PlansModalProvider";

interface CapStatus {
  allowed: boolean;
  used: number;
  max: number | null;
  unlimited: boolean;
  plan: string;
  saleFeeDisplay?: string;
}

function WeeklyLimitBar() {
  const { user } = useAuth();
  const { openPlansModal } = usePlansModal();
  const [cap, setCap] = useState<CapStatus | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const idToken = await user.getIdToken();
        const res = await fetch("/api/limits", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "check-listing-cap", idToken }),
        });
        const json = await res.json().catch(() => null);
        if (!cancelled && res.ok && json) setCap(json);
      } catch {
        // silent — this is a heads-up, not a blocking check; the server
        // still enforces the real cap on submit regardless
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user || !cap) return null;

  const pct = cap.unlimited ? 0 : Math.min(100, Math.round((cap.used / (cap.max || 1)) * 100));
  const atCap = !cap.unlimited && !cap.allowed;

  return (
    <div className={`lm-limit-row${open ? " open" : ""}`} style={{ marginBottom: 24 }} onClick={() => setOpen((v) => !v)}>
      <div className="lm-limit-row-left" role="button" tabIndex={0}>
        <span className="lm-limit-label">Weekly limit</span>
        <div className="lm-limit-track">
          <div
            className="lm-limit-track-fill"
            style={{ width: `${pct}%`, background: atCap ? "#ef4444" : undefined }}
          />
        </div>
        <span className="lm-limit-numbers">{cap.unlimited ? `${cap.used} / ∞` : `${cap.used} / ${cap.max}`}</span>
        <span className="lm-limit-arrow">▼</span>
      </div>
      {cap.plan !== "pro" && (
        <button
          className="lm-btn-plan-upgrade"
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            openPlansModal();
          }}
        >
          <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="6 11 12 5 18 11" />
          </svg>
          Upgrade Plan for More Listings
        </button>
      )}
      <div className={`lm-limit-dropdown${open ? " open" : ""}`} onClick={(e) => e.stopPropagation()}>
        <span id="lmLimitSummary">{cap.unlimited ? `${cap.used} listed · unlimited` : `${cap.used} / ${cap.max} used`}</span> this week.{" "}
        {cap.saleFeeDisplay && <span>{cap.saleFeeDisplay} platform fee per sale{cap.unlimited ? " · unlimited listings" : ""}.</span>}
      </div>
    </div>
  );
}

export default function SellPickerClient() {
  const router = useRouter();
  const { user } = useAuth();
  const { openAuthModal } = useAuthModal();

  // Gate every type-card click behind auth. Previously all five cards
  // called router.push() unconditionally, so a guest could freely
  // browse into any listing-creation form. Now: if not signed in,
  // open the auth modal right from the picker instead of letting them
  // start filling out a form they can't submit.
  function guardedPush(href: string) {
    if (!user) {
      openAuthModal();
      return;
    }
    router.push(href);
  }

  return (
    <div style={{ minHeight: "100vh", background: "#000", color: "#fff", paddingTop: 92, paddingBottom: 80 }}>
      <div style={{ maxWidth: 1160, margin: "0 auto", padding: "0 20px", textAlign: "center" }}>
        <div style={{ textAlign: "left", marginBottom: 24 }}>
          <WeeklyLimitBar />
        </div>

        <h1 style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 8 }}>
          What are you listing?
        </h1>
        <p style={{ fontSize: 15, color: "rgba(255,255,255,0.4)", marginBottom: 32 }}>
          Choose a type to get started.
        </p>

        <div className="sell-type-grid">
          <TypeCard
            label="Website"
            desc="A live site, SaaS, or online business."
            accent="#a3e635"
            icon={<GlobeIcon />}
            bannerSrc="https://cdn.phototourl.com/member/2026-07-23-94028826-7b73-44cb-aa8e-784df56bc085.jpg"
            onClick={() => guardedPush("/sell/website")}
          />
          <TypeCard
            label="App"
            desc="A mobile or web app."
            accent="#fbbf24"
            icon={<AppIcon />}
            bannerSrc="https://cdn.phototourl.com/member/2026-07-23-a4b0ee23-15a4-44b5-8ea7-b86414ea3e1f.jpg"
            onClick={() => guardedPush("/sell/app")}
          />
          <TypeCard
            label="Game"
            desc="A browser game or downloadable build."
            accent="#f59e0b"
            icon={<GameIcon />}
            bannerSrc="https://cdn.phototourl.com/member/2026-07-23-43f253a3-d3dd-411a-970e-066ae0e3b477.jpg"
            onClick={() => guardedPush("/sell/game")}
          />
          <TypeCard
            label="Template"
            desc="A design or code template, not a live site."
            accent="#c084fc"
            icon={<TemplateIcon />}
            bannerSrc="https://cdn.phototourl.com/member/2026-07-23-510375af-9619-486a-b1cd-da57626b1755.jpg"
            onClick={() => guardedPush("/sell/template")}
          />
          <TypeCard
            label="3D Assets"
            desc="A 3D model with a live, embedded preview — no screenshots needed."
            accent="#2dd4bf"
            icon={<AssetsIcon />}
            bannerSrc="https://cdn.phototourl.com/member/2026-07-23-44fc3828-068f-4bfc-82e3-10e2be1c0df7.jpg"
            onClick={() => guardedPush("/sell/3d-assets")}
          />
        </div>
      </div>
    </div>
  );
}

function TypeCard({
  label,
  desc,
  accent,
  icon,
  onClick,
  comingSoon,
  bannerSrc,
}: {
  label: string;
  desc: string;
  accent: string;
  icon: React.ReactNode;
  onClick?: () => void;
  comingSoon?: boolean;
  bannerSrc?: string | null;
}) {
  return (
    <button
      onClick={onClick}
      disabled={comingSoon}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        width: "100%",
        background: "rgba(255,255,255,0.03)",
        border: "1.5px solid rgba(255,255,255,0.85)",
        borderRadius: 20,
        cursor: comingSoon ? "not-allowed" : "pointer",
        textAlign: "left",
        fontFamily: "inherit",
        opacity: comingSoon ? 0.55 : 1,
        overflow: "hidden",
        transition: "border-color 0.2s, transform 0.2s",
      }}
    >
      {/* 16:9 promo banner — placeholder for now, drop a real image into
          bannerSrc later and this swaps in automatically. */}
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "16 / 9",
          background: bannerSrc
            ? `#000 center / cover no-repeat url(${bannerSrc})`
            : `linear-gradient(135deg, ${accent}33, rgba(255,255,255,0.02) 60%)`,
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {!bannerSrc && (
          <span style={{ width: 56, height: 56, color: accent, opacity: 0.5, display: "flex" }}>{icon}</span>
        )}
        {comingSoon && (
          <span
            style={{
              position: "absolute",
              top: 14,
              right: 14,
              fontSize: 10,
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "rgba(255,255,255,0.7)",
              background: "rgba(0,0,0,0.55)",
              padding: "4px 10px",
              borderRadius: 20,
              backdropFilter: "blur(6px)",
            }}
          >
            Coming soon
          </span>
        )}
      </div>

      {/* Label + description */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 20px" }}>
        <span style={{ width: 30, height: 30, flexShrink: 0, color: accent, display: "flex" }}>{icon}</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: "#fff" }}>{label}</span>
          <span style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>{desc}</span>
        </div>
      </div>
    </button>
  );
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ width: "100%", height: "100%" }}>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20" />
    </svg>
  );
}
function AppIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ width: "100%", height: "100%" }}>
      <rect x="5" y="2" width="14" height="20" rx="2" />
      <line x1="12" y1="18" x2="12.01" y2="18" />
    </svg>
  );
}
function GameIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ width: "100%", height: "100%" }}>
      <rect x="2" y="6" width="20" height="12" rx="6" />
      <line x1="7" y1="12" x2="9" y2="12" />
      <line x1="8" y1="11" x2="8" y2="13" />
      <circle cx="16" cy="10.5" r="0.8" fill="currentColor" />
      <circle cx="18" cy="13" r="0.8" fill="currentColor" />
    </svg>
  );
}
function TemplateIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ width: "100%", height: "100%" }}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="9" y1="9" x2="9" y2="21" />
    </svg>
  );
}
function AssetsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ width: "100%", height: "100%" }}>
      <path d="M12 2 21 7 12 12 3 7z" />
      <path d="M3 12l9 5 9-5" />
      <path d="M3 17l9 5 9-5" />
    </svg>
  );
}
