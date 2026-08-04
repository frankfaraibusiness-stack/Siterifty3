"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { useAuthModal } from "@/components/auth/AuthModalProvider";
import CreditsTicker from "./CreditsTicker";

// Ports the hero section. Only "Start Selling" is auth-gated
// (__requireAuth in the original auth-modal.js) — you need an account
// to list something. "Browse Marketplace" is intentionally NOT gated:
// browsing is meant to work for anonymous visitors (and crawlers) with
// zero friction — previously both buttons shared the same requireAuth
// wrapper, so a logged-out tap on "Browse Marketplace" opened the
// sign-in modal instead of ever reaching /marketplace.
//
// "Browse Marketplace" navigates to the real /marketplace route
// (previously opened a full-screen MarketplaceModal popup in place —
// removed so there's exactly one marketplace/search experience, with
// its own URL, back-button behavior, and page state, instead of a
// second popup copy of it living over the homepage).
export default function Hero() {
  const heroRef = useRef<HTMLElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);
  const { user } = useAuth();
  const { openAuthModal } = useAuthModal();
  const router = useRouter();

  function requireAuth(fn: () => void) {
    if (user) fn();
    else openAuthModal();
  }

  return (
    <section className="hero" ref={heroRef}>
      {/* Was a pure CSS background-image on this div — invisible to
          Google Images (no <img> tag = nothing to index, no alt text
          possible, no filename credit, regardless of hosting). Now a
          real <img> filling the same box with the same blur/scale
          styling applied directly to it via .hero-bg, so it's
          visually identical but actually crawlable. Self-hosted at a
          descriptive path instead of the external CDN/UUID filename —
          same-domain hosting is the biggest single lever for a brand-
          search image ranking. */}
      <div className="hero-bg">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/siterifty-hero-marketplace.jpg"
          alt="Siterifty marketplace — buy, sell, and discover apps, games, and websites"
        />
      </div>
      <div className="hero-overlay" />
      <CreditsTicker heroRef={heroRef} ctaRef={ctaRef} />
      <div className="hero-content">
        <span className="hero-eyebrow">The dev marketplace</span>
        <h1 className="hero-title">
          Sell your apps, games
          <br />
          &amp; <em>templates</em> — fast.
        </h1>
        <p className="hero-desc">
          A marketplace built for independent developers. List your digital products, reach real buyers, and keep
          more of what you earn.
        </p>
        <div className="hero-ctas" ref={ctaRef}>
          <button className="cta-primary" onClick={() => requireAuth(() => router.push("/sell"))}>
            Start Selling
          </button>
          <button className="cta-secondary" onClick={() => router.push("/marketplace")}>
            Browse Marketplace
          </button>
        </div>
      </div>
    </section>
  );
}
