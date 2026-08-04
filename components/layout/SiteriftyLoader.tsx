"use client";

import { useScrollLock } from "@/lib/useScrollLock";

// Shared full-screen skeleton loader — glass/blurred overlay with shimmer
// skeleton blocks mirroring the real layout (nav + search + avatar, hero
// banner, section title, listing grid). Two call sites:
//   1. app/loading.tsx — Next's route-level loading UI, shown
//      automatically during server-side navigation/data fetching for any
//      route that doesn't define its own more specific loading.tsx
//      (e.g. listing/[id] has its own ListingDetailSkeleton and takes
//      priority there).
//   2. MarketplaceGrid's own client-side feed loading state — the feed itself is
//      fetched client-side via useFeed(), which app/loading.tsx can't see,
//      so the grid renders this directly while its first page loads.
//
// Body scroll is locked for as long as this is mounted so the page behind
// it can't scroll/jump underneath the fixed overlay (this was the source
// of the "white sheet" flash at the bottom — the underlying page content
// peeking through while it scrolled independently of the loader).
export default function SiteriftyLoader() {
  // Shared reference-counted lock (see lib/useScrollLock.ts) instead of a
  // hand-rolled html/body position:fixed toggle — the previous version
  // saved/restored styles independently of every other modal's lock, so
  // whichever one unmounted first could rip out another modal's lock (or
  // jump the page's scroll position) if this loader and a modal were ever
  // mounted at the same time.
  useScrollLock(true);

  return (
    <div id="siterifty-loader">
      <div className="s-nav">
        <a href="/" className="brand">
          <img
            src="/images/siterifty-logo.png"
            alt="Siterifty.com — Buy, Sell, Build, Trust"
            style={{ height: "1.3rem", display: "block" }}
          />
        </a>
        <div className="skel s-search" />
        <div className="skel s-avatar" />
      </div>

      <div className="skel s-banner" />

      <div className="skel s-title" />

      <div className="s-grid">
        <div className="s-card">
          <div className="skel s-img" />
          <div className="skel s-text" />
          <div className="skel s-price" />
        </div>
        <div className="s-card">
          <div className="skel s-img" />
          <div className="skel s-text" />
          <div className="skel s-price" />
        </div>
        <div className="s-card">
          <div className="skel s-img" />
          <div className="skel s-text" />
          <div className="skel s-price" />
        </div>
        <div className="s-card">
          <div className="skel s-img" />
          <div className="skel s-text" />
          <div className="skel s-price" />
        </div>
      </div>
    </div>
  );
}
