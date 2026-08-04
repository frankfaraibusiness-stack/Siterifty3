"use client";

import { useEffect, useRef } from "react";

// Ported verbatim from announcement-settings.js's ITEMS array — the
// scrolling credits strip under the hero CTAs.
const ITEMS: { label: string; value: string; cls: string; sub?: string }[] = [
  { label: "Founder", value: "Frank Nkiwani", cls: "cr-name" },
  { label: "Founded", value: "2026", cls: "cr-year" },
  { label: "Built", value: "Solo — Every line alone.", cls: "cr-solo" },
  { label: "Listing", value: "Free to list.", cls: "cr-role", sub: "No upfront cost — ever." },
  { label: "Checkout", value: "Secured by PayPal.", cls: "cr-mission", sub: "Held until delivery is confirmed." },
  { label: "Payments", value: "PayPal handles it.", cls: "cr-tag", sub: "No card details stored on Siterifty." },
  { label: "Security", value: "Secure Escrow.", cls: "cr-year", sub: "Funds held until delivery." },
  { label: "Support", value: "24 / 7", cls: "cr-role", sub: "Always watching. Always safe." },
  { label: "Plans", value: "Upgrade for more.", cls: "cr-mission", sub: "Starter · Growth · Pro" },
  { label: "Mission", value: "To help small developers", cls: "cr-mission", sub: "ship, sell & grow their products" },
  { label: "Platform", value: "Siterifty.com", cls: "cr-role", sub: "Apps · Games · Websites · Templates" },
  { label: "Vision", value: "One developer. One vision.", cls: "cr-tag", sub: "For every indie dev who believed." },
  { label: "Community", value: "Where small devs go big.", cls: "cr-solo" },
  { label: "Culture", value: "The way of life.", cls: "cr-name" },
  { label: "For", value: "Indie hackers' best site.", cls: "cr-tag" },
  { label: "Dream", value: "Small developers' dreamland.", cls: "cr-mission" },
  { label: "Safe", value: "A safe environment.", cls: "cr-year", sub: "Verified sellers. Real buyers." },
  { label: "Trust", value: "Built on trust.", cls: "cr-role", sub: "Every transaction protected." },
  { label: "Growth", value: "Your product. Your price.", cls: "cr-solo", sub: "You keep what you earn." },
  { label: "Scale", value: "Start free. Scale up.", cls: "cr-mission", sub: "Plans that grow with you." },
  { label: "Reach", value: "Real buyers. Real money.", cls: "cr-tag" },
  { label: "Speed", value: "List in minutes.", cls: "cr-year", sub: "No waiting. No gatekeeping." },
  { label: "Ethos", value: "Built for the builder.", cls: "cr-name" },
  { label: "Promise", value: "No hidden fees.", cls: "cr-role", sub: "What you see is what you get." },
  { label: "Vibe", value: "Where code becomes cash.", cls: "cr-solo" },
  { label: "For", value: "The indie dev generation.", cls: "cr-mission" },
  { label: "Access", value: "Marketplace for everyone.", cls: "cr-tag", sub: "Not just the big studios." },
  { label: "Boosts", value: "Get seen faster.", cls: "cr-year", sub: "Boost any listing, any time." },
  { label: "Legacy", value: "Every line written alone.", cls: "cr-solo", sub: "One person. One platform." },
  { label: "Belief", value: "You can ship it.", cls: "cr-name", sub: "We built this so you could." },
];

// Rendered twice in a row so the track can loop seamlessly at the halfway
// point — same trick as populateTrack() in the original.
const DOUBLED = [...ITEMS, ...ITEMS];

export default function CreditsTicker({
  heroRef,
  ctaRef,
}: {
  heroRef: React.RefObject<HTMLElement | null>;
  ctaRef: React.RefObject<HTMLDivElement | null>;
}) {
  const windowRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const hero = heroRef.current;
    const ctaBox = ctaRef.current;
    const cwBot = windowRef.current;
    const ctBot = trackRef.current;
    if (!hero || !ctaBox || !cwBot || !ctBot) return;

    function measure() {
      const heroRect = hero!.getBoundingClientRect();
      const ctaRect = ctaBox!.getBoundingClientRect();
      const botTop = ctaRect.bottom - heroRect.top + 12;
      const botH = heroRect.height - botTop;
      cwBot!.style.top = botTop + "px";
      cwBot!.style.height = Math.max(botH, 0) + "px";
    }

    measure();
    window.addEventListener("resize", measure);

    const SPEED = 28; // px/sec
    let traveled = 0;
    let last: number | null = null;
    let raf: number;

    function step(ts: number) {
      if (last === null) last = ts;
      const dt = (ts - last) / 1000;
      last = ts;

      traveled += SPEED * dt;

      // Half the track = one full loop (second half is an exact clone).
      const halfTrack = ctBot!.scrollHeight / 2;
      const pos = traveled % halfTrack;
      // pos=0 → content starts just below window bottom (fully hidden);
      // pos increases → content scrolls up into view.
      ctBot!.style.transform = `translateY(${cwBot!.offsetHeight - pos}px)`;

      raf = requestAnimationFrame(step);
    }

    raf = requestAnimationFrame(step);

    return () => {
      window.removeEventListener("resize", measure);
      cancelAnimationFrame(raf);
    };
  }, [heroRef, ctaRef]);

  return (
    <div className="credits-window credits-window-bottom" id="cw-bottom" ref={windowRef}>
      <div className="credits-track" id="ct-bottom" ref={trackRef}>
        {DOUBLED.map((item, i) => (
          <div key={i} style={{ display: "contents" }}>
            <div className="cr-block">
              <span className="cr-label">{item.label}</span>
              <span className={`cr-value ${item.cls}`}>{item.value}</span>
              {item.sub ? <span className="cr-sub">{item.sub}</span> : null}
            </div>
            <div className="cr-divider" />
          </div>
        ))}
      </div>
    </div>
  );
}
