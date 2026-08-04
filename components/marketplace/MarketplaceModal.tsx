"use client";

// Full-screen marketplace takeover, opened from Hero's search bar. Mounts
// the same MarketplaceGrid component the homepage already renders inline
// below the hero (self-contained: fetches its own listings via useFeed),
// so filters/search/infinite-scroll all work identically here — just in
// a modal instead of in the page flow. Passes autoOpenSearch so the
// full-screen SearchOverlay (see SearchOverlay.tsx's portal fix) opens
// immediately, landing the user straight in search rather than on the
// plain grid first.
//
// Portaled to document.body for the same reason SearchOverlay is: a
// position:fixed panel rendered in-place can get clipped to an ancestor
// that establishes its own containing block (transform/filter/etc).
// Nesting this modal (fixed, full-screen) around MarketplaceGrid, which
// itself renders MarketplaceSearchBar -> SearchOverlay (also portaled),
// is safe — two independent portals to document.body just stack by
// z-index, they don't nest as DOM containing blocks.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import MarketplaceGrid from "@/components/marketplace/MarketplaceGrid";
import { useScrollLock } from "@/lib/useScrollLock";

export default function MarketplaceModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  useScrollLock(open);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Marketplace"
      data-scroll-lock-exempt
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10100,
        background: "var(--mp-bg, #0a0a0d)",
        overflowY: "auto",
        animation: "mpModalIn 0.16s ease",
      }}
    >
      <button
        type="button"
        aria-label="Close marketplace"
        onClick={onClose}
        style={{
          position: "sticky",
          top: 12,
          left: "100%",
          transform: "translateX(-52px)",
          width: 36,
          height: 36,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(255,255,255,0.08)",
          border: "none",
          borderRadius: "50%",
          color: "#fff",
          cursor: "pointer",
          zIndex: 1,
        }}
      >
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}>
          <line x1={18} y1={6} x2={6} y2={18} />
          <line x1={6} y1={6} x2={18} y2={18} />
        </svg>
      </button>
      <div style={{ marginTop: -36, paddingTop: 24 }}>
        <MarketplaceGrid autoOpenSearch onExitTakeover={onClose} />
      </div>
    </div>,
    document.body
  );
}
