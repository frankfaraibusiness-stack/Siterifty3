"use client";

// Ports mpBuildAdCard from marketplace.js. Each ad unit gets its own
// sandboxed same-origin-free iframe via srcdoc, with its own isolated
// `atOptions` + invoke.js — same reasoning as the original: two ad units
// loaded directly in the parent page would clobber each other's global
// atOptions, and this also keeps the ad network's own iframe styling
// from leaking into the page. These are the same live ad-network unit
// keys/URLs already embedded in the original production site — carried
// over unchanged, not new third-party embeds introduced by this port.
import { useEffect, useState } from "react";
import type { AdBreakpoint } from "@/lib/feedInterleave";

const AD_UNITS = {
  rect: {
    key: "1d7ef19e8780b451cfff300fe1ff0ff0",
    width: 300,
    height: 250,
    invokeSrc: "https://beavercolourfuldelinquent.com/1d7ef19e8780b451cfff300fe1ff0ff0/invoke.js",
  },
  banner: {
    key: "8a5b6bbea4b7fc182c78002d81437da5",
    width: 320,
    height: 50,
    invokeSrc: "https://beavercolourfuldelinquent.com/8a5b6bbea4b7fc182c78002d81437da5/invoke.js",
  },
  // Desktop-only 728x90 leaderboard unit — the 320x50 mobile banner
  // stretched across a wide desktop column looks thin/blurry, so desktop
  // gets its own properly-sized unit instead of the mobile one scaled up.
  leaderboard: {
    key: "6d213ffdfee222af5882958436920a49",
    width: 728,
    height: 90,
    invokeSrc: "https://beavercolourfuldelinquent.com/6d213ffdfee222af5882958436920a49/invoke.js",
  },
} as const;

// Matches the same column breakpoints .mp-grid actually renders at
// (see globals.css: 1 column ≤768px phone, 2 columns 768–1023px tablet,
// 3 columns ≥1024px desktop) — kept in sync with feedInterleave.ts's
// comment on the same breakpoints.
const TABLET_MIN = "(min-width: 768px)";
const DESKTOP_MIN = "(min-width: 1024px)";

type Breakpoint = AdBreakpoint;

// Client-only breakpoint check. Starts as null (renders nothing) so the
// server render and the first client render match exactly — it fills in
// synchronously right after mount, before the ad iframe would otherwise
// load, so there's no visible flash and no wasted request for an ad unit
// that isn't meant for this screen size.
function useBreakpoint(): Breakpoint | null {
  const [bp, setBp] = useState<Breakpoint | null>(null);
  useEffect(() => {
    const desktopMq = window.matchMedia(DESKTOP_MIN);
    const tabletMq = window.matchMedia(TABLET_MIN);
    function update() {
      setBp(desktopMq.matches ? "desktop" : tabletMq.matches ? "tablet" : "phone");
    }
    update();
    desktopMq.addEventListener("change", update);
    tabletMq.addEventListener("change", update);
    return () => {
      desktopMq.removeEventListener("change", update);
      tabletMq.removeEventListener("change", update);
    };
  }, []);
  return bp;
}

// Each ad slot in the feed is tagged with the one breakpoint it was
// placed for (see feedInterleave.ts's three independent row-aligned
// cadences). If the live breakpoint doesn't match, this renders nothing
// at all — not just visually hidden — so a tablet visitor never loads
// the desktop ad network's iframe (or vice versa) for a slot that isn't
// meant for them.
// Adsterra's invoke.js fires document.write into the iframe once the ad
// network actually has a creative to serve; until then (or if the
// network never fills) the iframe sits there blank, which reads as a
// broken empty box even though the slot itself is working correctly.
// A skeleton placeholder covers that gap: shown from mount, faded out
// the moment the iframe's own load event fires (script finished
// executing/writing into the frame), so there's never a bare empty
// rectangle — worst case on a true no-fill it just settles into a
// quiet placeholder instead of nothing.
function AdPlaceholder({ width, height }: { width: number; height: number }) {
  return (
    <div
      className="sr-ad-placeholder"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        maxWidth: width,
        maxHeight: height,
        margin: "0 auto",
        borderRadius: 10,
        background:
          "linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.09) 37%, rgba(255,255,255,0.04) 63%)",
        backgroundSize: "400% 100%",
        animation: "sr-ad-shimmer 1.4s ease infinite",
      }}
    />
  );
}

export default function AdSlot({ kind, targetBreakpoint }: { kind: "rect" | "banner" | "leaderboard"; targetBreakpoint: Breakpoint }) {
  const bp = useBreakpoint();
  const [loaded, setLoaded] = useState(false);

  // Reset the loaded flag whenever the slot's identity changes (kind or
  // breakpoint) so a recycled/keyed remount doesn't inherit a stale
  // "loaded" state from a different ad unit.
  useEffect(() => {
    setLoaded(false);
  }, [kind, targetBreakpoint]);

  if (bp === null || bp !== targetBreakpoint) return null;

  const unit = AD_UNITS[kind];
  const srcDoc =
    "<!doctype html><html><head><meta charset=\"utf-8\">" +
    "<style>html,body{margin:0;padding:0;overflow:hidden;background:transparent;}</style>" +
    "</head><body>" +
    "<script>atOptions = " +
    JSON.stringify({ key: unit.key, format: "iframe", height: unit.height, width: unit.width, params: {} }) +
    ";<" +
    "/script>" +
    '<script src="' +
    unit.invokeSrc +
    '"><' +
    "/script>" +
    "</body></html>";

  return (
    <div
      className={"sr-ad-slot" + (kind === "banner" ? " sr-ad-banner" : "") + (kind === "leaderboard" ? " sr-ad-leaderboard" : "")}
      style={{ position: "relative" }}
    >
      {!loaded && <AdPlaceholder width={unit.width} height={unit.height} />}
      <iframe
        width={unit.width}
        height={unit.height}
        scrolling="no"
        title="Advertisement"
        loading="lazy"
        srcDoc={srcDoc}
        onLoad={() => setLoaded(true)}
        style={{
          border: "none",
          maxWidth: "100%",
          position: "relative",
          opacity: loaded ? 1 : 0,
          transition: "opacity 0.25s ease",
        }}
      />
    </div>
  );
}
