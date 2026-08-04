"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Problem this solves: tapping a button that does router.push(...) into a
// server-rendered route (a page, or a modal-as-route like TransferDealModal
// via TransferDealRoute) has a gap between the tap and anything appearing
// on screen. If the destination route has a loading.tsx, that gap is just
// "time to first paint of the skeleton" — usually fast, but on a slow
// connection or cold server function it can be a second or more of a
// button that looks like it did nothing. If the destination has no
// loading.tsx, the gap is "time to first paint of the fully-loaded page",
// which can be much longer. Either way, silence reads as "broken" and
// people tap again, navigate away, or bounce.
//
// Fix: every nav-triggering button sets a local isNavigating flag the
// instant it's tapped, swaps its icon for a spinner and disables itself,
// then calls router.push. The flag doesn't need to be cleared on success —
// this component is about to unmount as the route changes. It only needs
// clearing on failure, so a broken push doesn't leave the button stuck
// spinning forever.
//
// This is the client-side half of the fix. The other half is route-level
// loading.tsx files (see app/**/loading.tsx) so there's a real skeleton to
// hand off to once navigation completes. Neither half alone is enough:
// the spinner alone would just hang if the page has no loading.tsx, and a
// loading.tsx alone doesn't cover the tap-to-first-paint gap before Next
// even starts rendering it.
export function useNavigating() {
  const router = useRouter();
  const [isNavigating, setIsNavigating] = useState(false);
  // Guards against double-taps firing router.push twice while already
  // navigating (fast double-tap on mobile is common on "dead-feeling"
  // buttons, since people assume the first tap didn't register).
  const pendingRef = useRef(false);

  const navigate = useCallback(
    (href: string, opts?: { replace?: boolean }) => {
      if (pendingRef.current) return;
      pendingRef.current = true;
      setIsNavigating(true);
      try {
        if (opts?.replace) {
          router.replace(href);
        } else {
          router.push(href);
        }
      } catch (err) {
        // Synchronous push failures are rare but not impossible (e.g. a
        // malformed href thrown by the router before it even schedules
        // navigation) — without this catch the button would stay
        // disabled/spinning with no way out.
        pendingRef.current = false;
        setIsNavigating(false);
        throw err;
      }
    },
    [router]
  );

  // Exposed for the rare case a caller needs to bail out manually (e.g. a
  // confirm dialog that intercepts the click and sometimes doesn't
  // navigate at all).
  const reset = useCallback(() => {
    pendingRef.current = false;
    setIsNavigating(false);
  }, []);

  return { isNavigating, navigate, reset };
}
