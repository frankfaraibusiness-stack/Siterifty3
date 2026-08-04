"use client";

// Shared empty-state for every screen/panel that requires the user to be
// signed in — dashboard, inbox, deal chat, AI tools, seller profile bio,
// etc. Before this, each of those spots had its own ad-hoc "Sign in to
// see X" line (some with a bare generic icon, most with no call to
// action at all — see the old SellerDashboard/DealChatPanel/
// SellerProfileClient copies). This is one persistent component instead,
// matching the same visual language as app/not-found.tsx (dark/lime
// theme tokens, inline SVG character with a subtle idle animation, no
// external image request) but with its own distinct illustration — a
// locked vault/door, not the 404 page's slumped character — so a
// logged-out gate reads as "sign in to unlock this" rather than
// "something's broken", which the 404 character would wrongly imply
// here.
//
// One component, reused everywhere: fixes the drift where some gates had
// a CTA and others didn't, and keeps any future visual tweaks to a
// single file instead of N near-duplicate copies.

import { useAuthModal } from "@/components/auth/AuthModalProvider";

interface SignInRequiredProps {
  /** Defaults to a generic heading; override for context ("Sign in to see your dashboard"). */
  title?: string;
  /** Optional supporting copy under the title. */
  description?: string;
  /** Renders full-viewport centered (for routed pages). Defaults to true.
   *  Set false to render inline within an existing panel/card instead. */
  fullScreen?: boolean;
  /** Extra top offset for routed pages that sit under the fixed header (92px). */
  withHeaderOffset?: boolean;
}

export default function SignInRequired({
  title = "Sign in to continue",
  description = "This section is only available once you're signed in.",
  fullScreen = true,
  withHeaderOffset = true,
}: SignInRequiredProps) {
  const { openAuthModal } = useAuthModal();

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        gap: 4,
        padding: "48px 20px",
        color: "#f1f1f3",
        ...(fullScreen
          ? { minHeight: withHeaderOffset ? "calc(100vh - 92px)" : "100vh", marginTop: withHeaderOffset ? 92 : 0 }
          : { minHeight: 340, width: "100%" }),
      }}
    >
      <style>{`
        @keyframes sir-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-5px); }
        }
        @keyframes sir-glow {
          0%, 100% { opacity: 0.55; }
          50% { opacity: 1; }
        }
        @keyframes sir-shadow {
          0%, 100% { transform: scaleX(1); opacity: 0.3; }
          50% { transform: scaleX(0.86); opacity: 0.18; }
        }
        .sir-character { animation: sir-float 3.4s ease-in-out infinite; transform-origin: 50% 90%; }
        .sir-keyhole-glow { animation: sir-glow 3.4s ease-in-out infinite; }
        .sir-shadow { animation: sir-shadow 3.4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .sir-character, .sir-keyhole-glow, .sir-shadow { animation: none; }
        }
      `}</style>

      <svg
        width="150"
        height="150"
        viewBox="0 0 200 200"
        fill="none"
        aria-hidden="true"
        style={{ marginBottom: 4 }}
      >
        <ellipse className="sir-shadow" cx="100" cy="168" rx="42" ry="8" fill="#000" />

        <g className="sir-character">
          {/* Rounded vault-door body */}
          <rect x="52" y="46" width="96" height="106" rx="18" fill="#111116" stroke="rgba(255,255,255,0.1)" strokeWidth="1.5" />
          {/* Inner ring / dial */}
          <circle cx="100" cy="88" r="30" fill="#16161c" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" />
          <circle cx="100" cy="88" r="30" stroke="rgba(163,230,53,0.18)" strokeWidth="1" />
          {/* Dial ticks */}
          <path d="M100 62v6M100 108v6M74 88h6M120 88h6M81 69l4 4M115 69l-4 4M81 107l4-4M115 107l-4 4" stroke="rgba(255,255,255,0.18)" strokeWidth="2" strokeLinecap="round" />

          {/* Padlock body sitting over the dial */}
          <rect x="84" y="82" width="32" height="26" rx="6" fill="#0b0b0f" stroke="rgba(255,255,255,0.16)" strokeWidth="1.5" />
          <path d="M90 82v-8a10 10 0 0120 0v8" stroke="rgba(255,255,255,0.28)" strokeWidth="4" strokeLinecap="round" fill="none" />
          {/* Keyhole, lime accent — ties to brand color like the 404 antenna tip */}
          <g className="sir-keyhole-glow">
            <circle cx="100" cy="93" r="3.4" fill="#a3e635" />
            <path d="M100 96l0 6" stroke="#a3e635" strokeWidth="3" strokeLinecap="round" />
          </g>

          {/* Small status LEDs along the bottom of the door, one lit lime */}
          <circle cx="66" cy="134" r="2.6" fill="rgba(255,255,255,0.18)" />
          <circle cx="76" cy="134" r="2.6" fill="rgba(255,255,255,0.18)" />
          <circle cx="86" cy="134" r="2.6" fill="#a3e635" opacity="0.85" />
        </g>
      </svg>

      <h2 style={{ fontSize: "clamp(19px, 4.5vw, 24px)", fontWeight: 800, margin: "6px 0 0", letterSpacing: "-0.01em" }}>
        {title}
      </h2>

      <p style={{ fontSize: 14, lineHeight: 1.6, color: "rgba(255,255,255,0.55)", maxWidth: 360, margin: "8px 0 22px" }}>
        {description}
      </p>

      <button
        onClick={openAuthModal}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "11px 26px",
          background: "#a3e635",
          color: "#0a0a0a",
          fontWeight: 700,
          fontSize: 14,
          border: "none",
          borderRadius: 999,
          cursor: "pointer",
        }}
      >
        Sign In / Sign Up
      </button>
    </div>
  );
}
