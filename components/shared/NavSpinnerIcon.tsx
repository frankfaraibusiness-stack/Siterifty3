"use client";

// Shared spinner swapped in for a button's normal icon the instant it's
// tapped to navigate to a server-rendered route/modal-route. Pairs with
// lib/useNavigating.ts. Uses the existing global .sr-nav-spinner class
// (app/globals.css) which reuses the dcpSpin keyframe already defined for
// the Messages & Deals button, so this doesn't introduce a second
// slightly-different spin animation elsewhere on the site.
export default function NavSpinnerIcon({ size = 19 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      className="sr-nav-spinner"
      width={size}
      height={size}
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-9-9" />
    </svg>
  );
}
