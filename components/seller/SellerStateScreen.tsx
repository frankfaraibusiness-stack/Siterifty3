"use client";

import Link from "next/link";

// Shared full-screen states used by both /seller/[id] and /donate/[id]
// when a seller can't be shown to the current viewer. Previously each
// route improvised its own tiny inline fallback:
//   - SellerProfileClient: a bare "This profile has been made private"
//     card that also fabricated an "Anonymous" seller (see useSeller.ts)
//     for a genuinely-deleted account instead of ever reaching a real
//     not-found state.
//   - DonatePageClient: a single line of grey text ("Seller not found.")
//   - The private-profile card had no way to report a bad actor at all —
//     the Report button lives in SellerProfileHeader, which the private
//     branch never renders.
// Both states below are full-bleed, on-brand (lime accent, matches the
// rest of the app instead of introducing new colors), and each gets its
// own small looping SVG illustration rather than a static icon, so the
// page reads as designed rather than as an error condition.

function NotFoundIllustration() {
  return (
    <svg
      className="sps-illo"
      width="150"
      height="150"
      viewBox="0 0 150 150"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="75" cy="75" r="62" className="sps-illo-ring" />
      <g className="sps-illo-float">
        {/* Rounded "ghost" card standing in for the missing profile */}
        <path
          d="M45 96V64a30 30 0 0160 0v32l-8-6-7 6-7-6-7 6-7-6-8 6z"
          className="sps-illo-body"
        />
        <circle cx="61" cy="66" r="4.2" className="sps-illo-eye" />
        <circle cx="89" cy="66" r="4.2" className="sps-illo-eye" />
        {/* sad mouth */}
        <path d="M64 82q11-8 22 0" className="sps-illo-mouth" />
      </g>
      {/* small floating "?" shard, drifts independently */}
      <g className="sps-illo-shard">
        <circle cx="112" cy="42" r="11" className="sps-illo-shard-bg" />
        <text x="112" y="47" textAnchor="middle" className="sps-illo-shard-txt">
          ?
        </text>
      </g>
    </svg>
  );
}

function PrivateIllustration() {
  return (
    <svg
      className="sps-illo"
      width="150"
      height="150"
      viewBox="0 0 150 150"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="75" cy="75" r="62" className="sps-illo-ring sps-illo-ring-locked" />
      <g className="sps-illo-float">
        <rect x="52" y="72" width="46" height="36" rx="9" className="sps-illo-lockbody" />
        <path
          d="M60 72v-9a15 15 0 0130 0v9"
          className="sps-illo-lockshackle"
        />
        <circle cx="75" cy="88" r="5" className="sps-illo-lockhole" />
        <rect x="72.5" y="90" width="5" height="10" rx="2.5" className="sps-illo-lockhole" />
      </g>
      <g className="sps-illo-shard">
        <circle cx="108" cy="100" r="10" className="sps-illo-shard-bg sps-illo-shard-bg-lock" />
        <path
          d="M104 100l3 3 6-6"
          className="sps-illo-shard-check"
          fill="none"
        />
      </g>
    </svg>
  );
}

// Deleted account / bad link / never existed. Used by both the profile
// page and the donate page so a dead link reads the same everywhere.
export function SellerNotFoundScreen({ context = "profile" }: { context?: "profile" | "donate" }) {
  return (
    <div className="sps-screen">
      <NotFoundIllustration />
      <div className="sps-eyebrow">Seller not found</div>
      <h1 className="sps-title">This seller doesn&apos;t exist</h1>
      <p className="sps-sub">
        {context === "donate"
          ? "The seller you're trying to support may have deleted their account, or this link is out of date."
          : "This profile may have been deleted, or the link you followed is out of date."}
      </p>
      <div className="sps-actions">
        <Link href="/marketplace" className="sps-btn sps-btn-primary">
          Browse Marketplace
        </Link>
        <Link href="/" className="sps-btn sps-btn-ghost">
          Back to Home
        </Link>
      </div>
    </div>
  );
}

// Seller exists but has set their profile to private. Report stays
// available here — a private profile is exactly the kind of profile
// someone may need to flag (see comment above), so hiding the listings/
// stats/bio must not also hide the ability to report the seller.
export function SellerPrivateScreen({
  username,
  onReport,
  reportBusy,
  reportDone,
  showReport = true,
}: {
  username: string;
  onReport?: () => void;
  reportBusy?: boolean;
  reportDone?: boolean;
  showReport?: boolean;
}) {
  return (
    <div className="sps-screen">
      <PrivateIllustration />
      <div className="sps-eyebrow">Private profile</div>
      <h1 className="sps-title">{username}&apos;s profile has been made private</h1>
      <p className="sps-sub">
        The seller has hidden their listings, stats, and details from public view.
      </p>

      <div className="sps-safety-card">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <div>
          <b>Double-check before you buy.</b> Private profiles hide history and reviews, so
          it&apos;s harder to verify a seller. Prefer sellers with a visible track record, and
          always use Siterifty Escrow.
        </div>
      </div>

      <div className="sps-actions">
        {showReport && !reportDone && (
          <button
            type="button"
            className="sps-btn sps-btn-report"
            onClick={onReport}
            disabled={reportBusy}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
              <line x1="4" y1="22" x2="4" y2="15" />
            </svg>
            {reportBusy ? "Reporting…" : "Report seller"}
          </button>
        )}
        {reportDone && <div className="sps-report-done">✓ Report submitted — thank you</div>}
        <Link href="/" className="sps-btn sps-btn-ghost">
          Back to Home
        </Link>
      </div>
    </div>
  );
}
