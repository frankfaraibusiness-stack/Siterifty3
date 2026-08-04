"use client";

// Footer is a real, always-crawlable set of <Link>s (see Footer.tsx's own
// top comment) that belongs on every normal page. But a small number of
// routes are fixed-height, overflow:hidden app-shell layouts (Settings'
// sidebar+detail-panel, matching /dashboard's own modal-card pattern) —
// on those, the page never document-scrolls at all, so a footer mounted
// after <main> would just sit permanently off-screen and unreachable,
// wasted DOM weight for zero benefit. This is the inverse of
// HomeMarketplaceOnly (an allowlist for BottomNav/FeedbackWidget) — here
// Footer defaults to visible everywhere except this denylist.
import { usePathname } from "next/navigation";
import Footer from "@/components/layout/Footer";

const HIDDEN_PATH_PREFIXES = ["/settings"];

export default function ConditionalFooter() {
  const pathname = usePathname();
  const hidden = HIDDEN_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/")
  );

  if (hidden) return null;

  return <Footer />;
}
