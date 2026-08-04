"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { useScrollLock } from "@/lib/useScrollLock";
import SiteriftyLoader from "@/components/layout/SiteriftyLoader";

// Ports the "BOOT OVERLAY — hidden once, after the first auth resolution
// + a 1.5s cooldown" block from firebase-init.js, plus the appBootOverlay
// markup from index.html. Same timing as the original:
//   - shown immediately on mount (nothing to wait on, matches the
//     original rendering it as the very first thing in <body>)
//   - AuthContext's `loading` flips false the instant onAuthStateChanged
//     fires once (with a user OR null) — this is the exact same
//     "__authReady resolves once" moment the original's onAuthStateChanged
//     callback used to trigger __dismissBootOverlay()
//   - a further 1.5s cooldown after that before the fade-out starts,
//     ported verbatim from the original's setTimeout(..., 1500)
//   - the overlay fades out via the .boot-hidden CSS class (opacity/
//     visibility transition, ~0.5s — see #appBootOverlay.boot-hidden in
//     globals.css), then unmounts after that transition completes
//   - an 8s absolute safety net in case auth never resolves (matches the
//     original's setTimeout(__dismissBootOverlay, 8000) belt-and-braces
//     call), so a stalled network/auth call can never leave this stuck up
//     forever
//
// NOT included here: the original's __dismissBootOverlay also kicks off
// the "Welcome Back" full-screen takeover for returning users
// (window.__welcomeBackPending / __openWelcomeBack) once the boot overlay
// itself finishes. That's now a separate component —
// components/system/WelcomeBackScreen.tsx, mounted alongside this one in
// app/layout.tsx — which mirrors the same BOOT_HOLD_MS timing off
// useAuth().loading directly rather than this component signaling it,
// since nothing else currently needs to know when the boot splash has
// fully faded.
//
// CONTENT: previously a bespoke monogram/wordmark + spinning progress
// ring, redesigned once already to drop an even earlier mascot glyph +
// glitter particle field. Swapped again here for the same skeleton
// loader (SiteriftyLoader — nav bar / banner / grid shimmer blocks)
// already used for route-level navigation (app/loading.tsx) and the
// marketplace feed's own first-page load (MarketplaceGrid.tsx). Same
// loading treatment everywhere in the app now, rather than a one-off
// splash screen that only ever appeared here. #appBootOverlay itself
// (this file's outer shell — fixed/inset:0, z-index:999999, the fade
// transition, the auth-timing/safety-net logic above) is unchanged;
// only what renders inside it changed.
const BOOT_HOLD_MS = 1500;
const BOOT_FADE_MS = 550;
const BOOT_SAFETY_NET_MS = 8000;

export default function BootOverlay() {
  const { loading } = useAuth();
  const [hidden, setHidden] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Locks body scroll (wheel/keyboard) for as long as the overlay is
  // still in the DOM. `hidden` only starts the fade-out transition —
  // the overlay is still visually on screen during that transition, so
  // the lock stays on until `removed` (fully unmounted), not `hidden`.
  // SiteriftyLoader below also calls useScrollLock(true) itself — both
  // calls share the same reference-counted lock (lib/useScrollLock.ts),
  // so having it locked from two places at once is safe by design.
  useScrollLock(!removed);

  // `overflow:hidden` on body stops wheel/keyboard scrolling, but iOS
  // Safari can still rubber-band the page underneath via touch drag even
  // behind a position:fixed full-screen overlay. Blocking touchmove at
  // the document level while the overlay is up closes that gap so the
  // page truly can't be scrolled or panned until boot finishes.
  useEffect(() => {
    if (removed) return;
    const blockTouch = (e: TouchEvent) => {
      e.preventDefault();
    };
    document.addEventListener("touchmove", blockTouch, { passive: false });
    return () => document.removeEventListener("touchmove", blockTouch);
  }, [removed]);

  // Dismiss once auth resolves (loading -> false), after the same 1.5s
  // cooldown the original applies so the splash doesn't flash away
  // instantly on a very fast cold load.
  useEffect(() => {
    if (loading || dismissed) return;
    setDismissed(true);
    const t = setTimeout(() => setHidden(true), BOOT_HOLD_MS);
    return () => clearTimeout(t);
  }, [loading, dismissed]);

  // Safety net: never let a stalled network/auth call leave the overlay
  // up forever, independent of whether `loading` ever resolves.
  useEffect(() => {
    const t = setTimeout(() => {
      setDismissed(true);
      setHidden(true);
    }, BOOT_SAFETY_NET_MS);
    return () => clearTimeout(t);
  }, []);

  // Unmount only after the fade-out transition has actually finished,
  // matching the original's setTimeout(() => el.remove(), 550).
  useEffect(() => {
    if (!hidden) return;
    const t = setTimeout(() => setRemoved(true), BOOT_FADE_MS);
    return () => clearTimeout(t);
  }, [hidden]);

  if (removed) return null;

  return (
    <div id="appBootOverlay" className={hidden ? "boot-hidden" : undefined}>
      <SiteriftyLoader />
    </div>
  );
}
