import Link from "next/link";

// Custom 404 — replaces Next.js's default "This page could not be found"
// screen. Matches the app's existing dark/lime theme tokens (--mp-bg,
// --mp-accent, etc. from globals.css) rather than introducing new colors.
// The character is an inline SVG (no external image dependency, no extra
// network request, instant paint) with a small CSS keyframe animation for
// a subtle "sad idle" feel — slow slumped breathing motion plus a
// drifting sigh mark — rather than anything jarring or cartoonish.

export default function NotFound() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "24px 20px",
        background: "#050508",
        color: "#f1f1f3",
      }}
    >
      <style>{`
        @keyframes nf-slump {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(4px) rotate(-1.2deg); }
        }
        @keyframes nf-sigh {
          0% { opacity: 0; transform: translate(0, 4px) scale(0.9); }
          25% { opacity: 0.6; }
          70% { opacity: 0.25; }
          100% { opacity: 0; transform: translate(6px, -22px) scale(1.15); }
        }
        @keyframes nf-shadow {
          0%, 100% { transform: scaleX(1); opacity: 0.35; }
          50% { transform: scaleX(0.88); opacity: 0.22; }
        }
        .nf-character {
          animation: nf-slump 3.6s ease-in-out infinite;
          transform-origin: 50% 90%;
        }
        .nf-sigh-mark {
          animation: nf-sigh 3.6s ease-in-out infinite;
        }
        .nf-shadow {
          animation: nf-shadow 3.6s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .nf-character, .nf-sigh-mark, .nf-shadow { animation: none; }
        }
      `}</style>

      <svg
        width="180"
        height="180"
        viewBox="0 0 200 200"
        fill="none"
        aria-hidden="true"
        style={{ marginBottom: 8 }}
      >
        <ellipse className="nf-shadow" cx="100" cy="168" rx="46" ry="8" fill="#000" />

        <g className="nf-character">
          {/* Body — knees-up slumped seated pose */}
          <path
            d="M62 150c-2-28 6-52 30-58 26-6 46 14 48 40 1 10-2 18-9 18H70c-5 0-7-.2-8 0Z"
            fill="#111116"
            stroke="rgba(255,255,255,0.1)"
            strokeWidth="1.5"
          />
          {/* Arms wrapped around knees */}
          <path
            d="M78 118c-8 6-12 16-10 30"
            stroke="rgba(255,255,255,0.18)"
            strokeWidth="6"
            strokeLinecap="round"
            fill="none"
          />
          <path
            d="M126 118c8 6 12 16 10 30"
            stroke="rgba(255,255,255,0.18)"
            strokeWidth="6"
            strokeLinecap="round"
            fill="none"
          />

          {/* Head, tilted down slightly */}
          <circle cx="101" cy="96" r="26" fill="#16161c" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" />

          {/* Sad closed eyes */}
          <path d="M89 98c2-3 6-3 8 0" stroke="rgba(255,255,255,0.55)" strokeWidth="2.4" strokeLinecap="round" fill="none" />
          <path d="M105 98c2-3 6-3 8 0" stroke="rgba(255,255,255,0.55)" strokeWidth="2.4" strokeLinecap="round" fill="none" />

          {/* Small frown */}
          <path d="M93 110c4-3 10-3 14 0" stroke="rgba(255,255,255,0.4)" strokeWidth="2" strokeLinecap="round" fill="none" />

          {/* One drooping antenna/hair tuft with lime accent tip, ties to brand color */}
          <path d="M101 70c0-6 2-10 0-14" stroke="rgba(255,255,255,0.25)" strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="101" cy="54" r="3.4" fill="#a3e635" opacity="0.85" />
        </g>

        {/* Drifting sigh mark above the head */}
        <text
          className="nf-sigh-mark"
          x="128"
          y="58"
          fontSize="16"
          fill="rgba(255,255,255,0.5)"
          fontFamily="inherit"
        >
          …
        </text>
      </svg>

      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "#a3e635",
          marginBottom: 10,
        }}
      >
        404 Error
      </div>

      <h1
        style={{
          fontSize: "clamp(22px, 5vw, 30px)",
          fontWeight: 800,
          margin: "0 0 10px",
          letterSpacing: "-0.01em",
        }}
      >
        This page could not be found
      </h1>

      <p
        style={{
          fontSize: 14.5,
          lineHeight: 1.6,
          color: "rgba(255,255,255,0.55)",
          maxWidth: 380,
          margin: "0 0 28px",
        }}
      >
        The listing, page, or link you&apos;re looking for may have been moved, sold, or no
        longer exists. Let&apos;s get you back on track.
      </p>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
        <Link
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "11px 22px",
            background: "#a3e635",
            color: "#0a0a0a",
            fontWeight: 700,
            fontSize: 14,
            borderRadius: 999,
            textDecoration: "none",
          }}
        >
          Back to Marketplace
        </Link>
        <Link
          href="/help"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "11px 22px",
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.12)",
            color: "rgba(255,255,255,0.85)",
            fontWeight: 600,
            fontSize: 14,
            borderRadius: 999,
            textDecoration: "none",
          }}
        >
          Get Help
        </Link>
      </div>
    </div>
  );
}
