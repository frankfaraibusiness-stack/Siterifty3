"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Hero from "@/components/home/Hero";
import MarketplaceGrid from "@/components/marketplace/MarketplaceGrid";
import RecentlyViewedStrip from "@/components/marketplace/RecentlyViewedStrip";
import SiteriftyLoader from "@/components/layout/SiteriftyLoader";
import { useAuthModal } from "@/components/auth/AuthModalProvider";

// The original site renders the hero and the marketplace grid on the same
// page — index.html has <section class="hero"> immediately followed by
// #marketplaceOverlay, both inline, not on separate routes. This page
// matches that: Hero on top, MarketplaceGrid directly below, no gap
// between them (the fixed-header top margin lives on Hero's own
// .hero-content, matching how the original's hero already accounts for
// the header without an extra margin on the section after it).
//
// The homepage grid runs in `preview` mode — a fixed dozen listings, no
// infinite scroll — ending in a "See full marketplace" CTA. That CTA is a
// real navigation to the standalone /marketplace route (not a modal, and
// not the search overlay) — it just eases into that navigation with a
// brief smooth-scroll-to-top first, so the shift reads as intentional
// rather than an abrupt jump straight into a page change mid-scroll.
//
// RecentlyViewedStrip sits between Hero and the preview grid — it's
// client-only (localStorage) and renders nothing at all when there's no
// history yet, so it never shifts layout for a first-time visitor.
//
// AutoOpenAuth reads ?auth=signup|login — set by the /r/[username]
// referral page's "Sign up now" / "Log in" links (see that page's
// comment) — and pops the auth modal straight to the matching tab on
// arrival, so a referred visitor doesn't have to notice and click the
// tab themselves. The ?r=username referral code alongside it isn't read
// here at all: authActions.ts's getReferralCode() reads it directly from
// window.location.search at the moment signup actually submits, same as
// it always has, so this effect only ever needs to care about ?auth.
// Needs its own Suspense boundary because useSearchParams requires one;
// kept as a tiny sibling component rather than wrapping the whole page
// so Hero/MarketplaceGrid don't move.
function AutoOpenAuth() {
  const searchParams = useSearchParams();
  const { openAuthModal } = useAuthModal();

  useEffect(() => {
    const auth = searchParams.get("auth");
    if (auth === "signup" || auth === "login") {
      openAuthModal(auth);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  return null;
}

export default function HomePage() {
  const router = useRouter();

  const handleSeeFullMarketplace = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    // Give the smooth-scroll a moment to actually play before the route
    // change swaps the page out from under it — long enough to read as
    // a deliberate transition, short enough not to feel like a delay.
    window.setTimeout(() => {
      router.push("/marketplace");
    }, 350);
  };

  return (
    <>
      <Suspense fallback={null}>
        <AutoOpenAuth />
      </Suspense>
      <Hero />
      <RecentlyViewedStrip />
      <Suspense fallback={<SiteriftyLoader />}>
        <MarketplaceGrid preview onSeeFullMarketplace={handleSeeFullMarketplace} />
      </Suspense>
    </>
  );
}
