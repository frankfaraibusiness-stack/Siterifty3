"use client";

// Shared shell for the standalone content pages linked from NavDrawer's
// "Support" section (About, Contact, Help, How It Works, Escrow &
// Payments, Buyer Protection, Terms & Privacy) — none of these existed
// as real pages in the original site (every one of those nav links was
// a dead href="#" there too, not just unbuilt here). Reuses the site's
// existing --mp-* CSS custom properties (defined once on :root in
// globals.css, so they're safe to read from any page) instead of
// introducing a second color system.
import Link from "next/link";
import type { ReactNode } from "react";

export default function StaticPage({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow?: string;
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        marginTop: 92,
        padding: "48px 24px 100px",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div style={{ width: "100%", maxWidth: 760 }}>
        <Link
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            color: "var(--mp-text-sec)",
            fontSize: 13,
            fontWeight: 600,
            textDecoration: "none",
            marginBottom: 28,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}>
            <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to Siterifty
        </Link>

        {eyebrow ? (
          <div
            style={{
              color: "var(--mp-accent)",
              fontSize: 12.5,
              fontWeight: 800,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            {eyebrow}
          </div>
        ) : null}

        <h1
          style={{
            color: "var(--mp-text)",
            fontSize: "clamp(28px, 4vw, 40px)",
            fontWeight: 800,
            lineHeight: 1.15,
            margin: 0,
          }}
        >
          {title}
        </h1>

        {intro ? (
          <p
            style={{
              color: "var(--mp-text-sec)",
              fontSize: 16,
              lineHeight: 1.6,
              marginTop: 16,
              maxWidth: 620,
            }}
          >
            {intro}
          </p>
        ) : null}

        <div style={{ marginTop: 36, display: "flex", flexDirection: "column", gap: 28 }}>{children}</div>
      </div>
    </div>
  );
}

// Section building block used by every content page below, so headings/
// spacing/body copy stay visually consistent without each page redefining
// its own typography.
export function StaticSection({ heading, children }: { heading?: string; children: ReactNode }) {
  return (
    <section>
      {heading ? (
        <h2
          style={{
            color: "var(--mp-text)",
            fontSize: 19,
            fontWeight: 750,
            margin: "0 0 10px",
          }}
        >
          {heading}
        </h2>
      ) : null}
      <div
        style={{
          color: "var(--mp-text-sec)",
          fontSize: 15,
          lineHeight: 1.75,
        }}
      >
        {children}
      </div>
    </section>
  );
}

// Native <details>/<summary> accordion — no JS state needed, keyboard-
// and screen-reader-accessible for free. Used by the Help Center FAQ.
export function FaqItem({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details
      style={{
        background: "var(--mp-surface)",
        border: "1px solid var(--mp-border)",
        borderRadius: "var(--mp-radius)",
        padding: "14px 18px",
      }}
    >
      <summary
        style={{
          color: "var(--mp-text)",
          fontSize: 15,
          fontWeight: 700,
          cursor: "pointer",
          listStyle: "none",
        }}
      >
        {q}
      </summary>
      <div
        style={{
          color: "var(--mp-text-sec)",
          fontSize: 14.5,
          lineHeight: 1.7,
          marginTop: 10,
        }}
      >
        {children}
      </div>
    </details>
  );
}
