"use client";

// The original site was a single always-mounted page where the bottom
// nav (fnav) and floating feedback launcher sat underneath whatever
// overlay/modal was currently open (settings, listings, sellers, etc all
// opened as overlays on top of the same page) — so they were always
// visible everywhere, and that was fine since nothing else was ever a
// truly separate "page" competing for the same screen space.
//
// Now that Settings/Profile/Listing/Seller/etc are real routes, having
// BottomNav + FeedbackWidget mounted globally means they float on top of
// content on every page (e.g. covering the bottom of a settings panel or
// a listing detail page) instead of just the two places they actually
// belong: the Home feed and the Marketplace grid, which are the two
// "browse" surfaces these controls are meant for.
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import BottomNav from "@/components/layout/BottomNav";
import FeedbackWidget from "@/components/support/FeedbackWidget";

const VISIBLE_PATHS = new Set<string>(["/", "/marketplace"]);

// .fnav is a floating position:fixed pill nav (see globals.css) — it
// doesn't take up real document space, so it doesn't push page content
// up. But it does visually sit on top of whatever's at the very bottom
// of the page, which on Home/Marketplace is now the footer's last row.
// This class only pads the footer itself (see .srf-footer-nav-clear in
// globals.css) so that one row clears the floating bar — it is not the
// same mechanism as the old body-wide padding-bottom rule that was
// removed for reserving space no floating nav actually needs.
const BODY_CLASS = "srf-fnav-active";

export default function HomeMarketplaceOnly() {
  const pathname = usePathname();
  const visible = VISIBLE_PATHS.has(pathname);

  useEffect(() => {
    document.body.classList.toggle(BODY_CLASS, visible);
    return () => {
      document.body.classList.remove(BODY_CLASS);
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <>
      <BottomNav />
      <FeedbackWidget />
    </>
  );
}
