"use client";

import { useEffect, useState } from "react";

// Shared desktop-viewport detector. Unlike most of this app's responsive
// behavior (which is pure CSS via media queries — see settings.css,
// profile.css), a few layouts need to know in JS whether they're on a
// wide viewport, because the *content that mounts* differs, not just its
// styling — e.g. InboxShell rendering a chat panel as an embedded pane
// next to the thread list on desktop, vs. navigating to a full-screen
// route on mobile. CSS alone can't express "mount a different component
// tree," so this exists for that handful of cases.
//
// SSR-safe: starts `false` (matches server render, avoids a hydration
// mismatch) and corrects itself on mount via a real matchMedia listener.
// Defaults to 1000px — a bit narrower than a typical laptop viewport, so
// small laptops/large tablets in landscape still get the desktop layout
// rather than being stuck with a mobile-only one that has room to spare.
export function useIsDesktop(minWidth = 1000): boolean {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${minWidth}px)`);
    setIsDesktop(mql.matches);
    function onChange(e: MediaQueryListEvent) {
      setIsDesktop(e.matches);
    }
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [minWidth]);

  return isDesktop;
}
