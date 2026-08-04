"use client";

// Replaces Next.js's default "Application error: a client-side exception
// has occurred..." plain-text crash screen with something that matches
// the app's actual dark/lime theme (same tokens as app/not-found.tsx —
// #050508 bg, #a3e635 lime accent, #f1f1f3 text).
//
// global-error.tsx is special in the App Router: it only fires for errors
// thrown above/outside the normal route tree (e.g. inside app/layout.tsx
// itself, or anything React can't recover from locally), which is exactly
// the case that used to fall through to Next's generic screen. Because it
// replaces the ENTIRE root layout when it fires, Next requires it to
// render its own <html>/<body> — the app's real layout (with Header,
// providers, etc.) is not mounted at this point, so this can't rely on
// anything from it (no CSS import, no context, no next/link — routing
// context may not exist either, hence a plain <a> for "reload").
//
// Deliberately renders as a fullscreen fixed overlay (position: fixed,
// inset: 0) rather than relying on normal document flow, so it always
// covers the entire viewport edge-to-edge with no possibility of the
// broken page peeking out from underneath or around it.
//
// Kept intentionally simple (no animation, no external deps) — if the
// app is crashing badly enough to reach this boundary, this screen itself
// needs to be as close to unbreakable as possible.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body style={{ margin: 0, padding: 0 }}>
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 999999,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            padding: "24px 20px",
            background: "#050508",
            color: "#f1f1f3",
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          }}
        >
          <svg
            width="72"
            height="72"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            style={{ marginBottom: 20 }}
          >
            <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
            <path
              d="M12 8v5"
              stroke="#a3e635"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <circle cx="12" cy="16.2" r="1.15" fill="#a3e635" />
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
            Something went wrong
          </div>

          <h1
            style={{
              fontSize: "clamp(20px, 5vw, 28px)",
              fontWeight: 800,
              margin: "0 0 10px",
              letterSpacing: "-0.01em",
            }}
          >
            This page hit an unexpected error
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
            Nothing on your end broke this — try reloading. If it keeps
            happening, let us know what you were doing when it happened.
          </p>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
            <button
              onClick={() => reset()}
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
                border: "none",
                cursor: "pointer",
              }}
            >
              Try Again
            </button>
            <a
              href="/"
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
              Back to Home
            </a>
          </div>

          {process.env.NODE_ENV !== "production" && (
            <pre
              style={{
                marginTop: 28,
                maxWidth: 520,
                maxHeight: 160,
                overflow: "auto",
                textAlign: "left",
                fontSize: 11.5,
                lineHeight: 1.5,
                color: "rgba(255,255,255,0.4)",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 10,
                padding: "12px 14px",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {error?.message}
              {error?.digest ? `\n\ndigest: ${error.digest}` : ""}
            </pre>
          )}
        </div>
      </body>
    </html>
  );
}
