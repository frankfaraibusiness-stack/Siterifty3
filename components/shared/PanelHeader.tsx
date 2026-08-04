"use client";

import { useRouter } from "next/navigation";
import { useNavDrawer } from "@/components/layout/NavDrawerProvider";

// Shared header for full-screen overlay routes (Settings, My Profile, …).
// Mirrors the site header's left side exactly — hamburger button that
// opens the same NavDrawer, then the logo right next to it — but swaps
// the header's right-side login/profile button for a Back button, since
// these panels are themselves reached by navigating forward from
// somewhere and had no way to return without a hard reload.
//
// These overlays render at z-index 9995, above the real <header> (9990),
// which is why they need their own copy of the left side rather than
// just letting the real header show through underneath.
export default function PanelHeader({
  onBack,
}: {
  // Defaults to router.back(). Callers can override (e.g. to always land
  // on a specific route rather than wherever history happens to point).
  onBack?: () => void;
}) {
  const router = useRouter();
  const { isOpen, toggleNav } = useNavDrawer();

  return (
    <header className="panel-header">
      <div className="left">
        <button
          className={`hamburger${isOpen ? " open" : ""}`}
          aria-label="Menu"
          aria-expanded={isOpen}
          onClick={toggleNav}
        >
          <span />
          <span />
          <span />
        </button>
        <div className="brand">
          <img src="/images/siterifty-logo.png" alt="Siterifty.com — Buy, Sell, Build, Trust" />
        </div>
      </div>
      <button
        type="button"
        className="panel-back-btn"
        onClick={onBack ?? (() => router.back())}
        aria-label="Back"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Back
      </button>
    </header>
  );
}
