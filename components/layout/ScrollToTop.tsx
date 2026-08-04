"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

// Fixes: clicking a footer link (or any link near the bottom of a long
// window-scrolled page, e.g. Home) navigates to the new page but the
// window stays scrolled to wherever the click happened — so the new
// page mounts already scrolled down to roughly where the footer was,
// instead of at the top. Then hitting Back re-triggers the same thing
// in reverse, so it *looks* like "going back always lands on the
// footer" even though the real cause is the forward navigation never
// resetting scroll in the first place.
//
// Root cause: most of this app's pages (Settings, Marketplace, the
// listing/seller detail views, etc.) scroll an inner `overflow-y: auto`
// panel rather than the window, so the browser's own native "new page
// starts at the top" behavior and Next's scroll-restoration heuristics
// don't reliably apply — the ones that DO use plain window scroll
// (Home, the static pages, and by extension Footer, which lives at the
// bottom of window-scrolled flow on those pages) are the ones this
// bites, since nothing was ever forcing the window itself back to 0.
//
// Previous fix attempt just trusted the browser's native scroll
// restoration on Back/Forward (popstate) and only forced scrollTo(0,0)
// on forward navigations. That doesn't actually work for the footer
// case: native restoration remembers wherever the window was scrolled
// to at the moment you navigated away — which, if you clicked a footer
// link, IS the footer position. So Back "restores" you right back to
// the footer, reproducing the exact bug this was meant to fix.
//
// Real fix: track our own scroll memory per pathname in sessionStorage.
// Right before any forward navigation, save the current page's scroll
// position under its own pathname key. On Back/Forward (popstate),
// restore from OUR saved value for the page being returned to (which
// was captured back when the user was still reading that page, before
// they scrolled down to click a link) instead of the browser's native
// value (which reflects click-time position, not read-time position).
const SCROLL_KEY_PREFIX = "srf_scrollpos:";

function saveScrollPos(pathname: string) {
  try {
    sessionStorage.setItem(SCROLL_KEY_PREFIX + pathname, String(window.scrollY));
  } catch {
    // sessionStorage unavailable (private mode, etc.) — safe to no-op,
    // this is a UX nicety, not a hard dependency.
  }
}

function readScrollPos(pathname: string): number {
  try {
    const raw = sessionStorage.getItem(SCROLL_KEY_PREFIX + pathname);
    return raw ? parseInt(raw, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

export default function ScrollToTop() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isPopState = useRef(false);
  const prevPathname = useRef(pathname);

  useEffect(() => {
    const onPopState = () => {
      isPopState.current = true;
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Capture scroll position for the page we're LEAVING, the instant a
  // link is clicked — before the route actually changes. Click
  // (capture phase) fires on any <a>/<Link> press, well before the
  // pathname effect below runs, so this always records read-time
  // position rather than whatever scroll a later effect might see.
  useEffect(() => {
    const onClickCapture = () => {
      if (prevPathname.current === "/discover") return;
      saveScrollPos(prevPathname.current);
    };
    document.addEventListener("click", onClickCapture, true);
    return () => document.removeEventListener("click", onClickCapture, true);
  }, []);

  useEffect(() => {
    if (isPopState.current) {
      isPopState.current = false;
      // Discover always opens at the top on Back, regardless of where the
      // user had scrolled to (e.g. down in the sellers rail) before
      // tapping into a seller/listing/blog — never restores a saved
      // "near the footer" position for this route.
      if (pathname === "/discover") {
        window.scrollTo(0, 0);
        prevPathname.current = pathname;
        return;
      }
      // Browser back/forward — restore OUR remembered position for
      // the page being returned to, not the browser's native one.
      const saved = readScrollPos(pathname);
      window.scrollTo(0, saved);
      prevPathname.current = pathname;
      return;
    }
    // Any other navigation (Link click, router.push, router.replace):
    // always start the new page at the top, matching normal multi-page
    // site behavior, regardless of which scroll container (window or
    // an inner panel) the click originated in.
    window.scrollTo(0, 0);
    // Some pages also render their own inner overflow-y:auto scroll
    // container as the "real" scrollable surface (Settings' detail
    // panel, the marketplace grid's #mpBody, etc.) — resetting those
    // too so a stale scroll position from the previous mount of that
    // same DOM id/class can't bleed through.
    document.querySelectorAll<HTMLElement>("#mpBody, #detailPanel, #mpModalBody").forEach((el) => {
      el.scrollTop = 0;
    });
    prevPathname.current = pathname;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams]);

  return null;
}
