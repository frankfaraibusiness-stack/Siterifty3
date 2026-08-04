"use client";

// Share button for listing detail pages — a round icon button that sits
// next to the price badge in each listing body's hero top row (see
// WebsiteListingBody/AppListingBody/GameListingBody). Tapping it:
//   - on a device with the Web Share API (most mobile browsers): opens
//     the native OS share sheet directly, no extra UI of our own.
//   - otherwise (most desktop browsers): opens a small popover with the
//     curated destination grid from lib/share.ts plus a "Copy link"
//     action, closing on an outside click or Escape.
// Either path shows a toast confirmation via useSrToast so the person
// gets feedback even when the native share sheet doesn't (e.g. after a
// plain clipboard copy).
import { useEffect, useRef, useState } from "react";
import { SHARE_DESTINATIONS, copyShareLink, nativeShare } from "@/lib/share";
import { useSrToast } from "@/components/system/SrToastProvider";

export default function ShareButton({
  url,
  title,
  accentColor = "#a3e635",
}: {
  url: string;
  title: string;
  accentColor?: string;
}) {
  const [open, setOpen] = useState(false);
  const [hasNativeShare, setHasNativeShare] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const { show: showToast } = useSrToast();

  useEffect(() => {
    setHasNativeShare(typeof navigator !== "undefined" && "share" in navigator);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (hasNativeShare) {
      const shared = await nativeShare(url, title);
      if (shared) showToast("Shared", "success");
      return;
    }
    setOpen((v) => !v);
  }

  async function handleCopy() {
    await copyShareLink(url);
    setOpen(false);
    showToast("Link copied", "success");
  }

  return (
    <div style={{ position: "relative" }} ref={popoverRef}>
      <button
        type="button"
        aria-label="Share listing"
        onClick={handleClick}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 34,
          height: 34,
          borderRadius: "50%",
          background: "rgba(10,10,12,0.86)",
          border: "1px solid rgba(255,255,255,0.18)",
          boxShadow: "0 2px 10px rgba(0,0,0,0.4)",
          cursor: "pointer",
          color: "#fff",
          flexShrink: 0,
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
        </svg>
      </button>

      {open && !hasNativeShare ? (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            zIndex: 40,
            width: 220,
            background: "rgba(16,16,20,0.98)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 14,
            padding: 10,
            boxShadow: "0 16px 40px rgba(0,0,0,0.5)",
            backdropFilter: "blur(16px) saturate(160%)",
            WebkitBackdropFilter: "blur(16px) saturate(160%)",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 6,
              marginBottom: 8,
            }}
          >
            {SHARE_DESTINATIONS.map((dest) => (
              <a
                key={dest.id}
                href={dest.buildHref(url, title)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 4,
                  padding: "8px 4px",
                  borderRadius: 10,
                  fontSize: 10.5,
                  fontWeight: 600,
                  color: "rgba(255,255,255,0.75)",
                  textDecoration: "none",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                {dest.label}
              </a>
            ))}
          </div>
          <button
            type="button"
            onClick={handleCopy}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              fontSize: 12.5,
              fontWeight: 700,
              color: "#0b0f0a",
              background: accentColor,
              border: "none",
              borderRadius: 999,
              padding: "8px 12px",
              cursor: "pointer",
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="12" height="12" rx="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
            Copy link
          </button>
        </div>
      ) : null}
    </div>
  );
}
