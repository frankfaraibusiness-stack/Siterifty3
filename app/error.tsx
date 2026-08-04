"use client";

import Link from "next/link";

// Catches errors thrown anywhere inside the normal route tree (i.e. inside
// a page/component, NOT inside app/layout.tsx itself — that case is
// app/global-error.tsx instead, which has to replace the whole document).
// This is the boundary that fires for the vast majority of real crashes,
// since layout.tsx itself rarely throws.
//
// Root layout (Header, NavDrawer, providers, etc.) stays mounted behind
// this — only the failed route's content is replaced — but it's rendered
// as a fixed fullscreen overlay (position: fixed, inset: 0, high z-index)
// so it still fully covers the viewport rather than just filling the
// space where the crashed page's content would have been, same intent as
// global-error.tsx's fullscreen treatment.
//
// Can use next/link and hooks here (unlike global-error.tsx) since the
// root layout — and therefore routing context — is still alive.

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
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
        <path d="M12 8v5" stroke="#a3e635" strokeWidth="2" strokeLinecap="round" />
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
        <Link
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
        </Link>
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
  );
}
