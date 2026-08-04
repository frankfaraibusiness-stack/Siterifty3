"use client";

import { useEffect, useState, type ReactElement } from "react";

// SUPERSEDED — no longer rendered anywhere. AuthModalProvider now opens
// OnboardingWizard (components/onboarding/OnboardingWizard.tsx) at the
// same post-signup call site instead of this component. Left in the tree
// unwired rather than deleted, in case any of this copy/step data is
// wanted for reference.
//
// ── TOUR MANAGEMENT ──
// Ports the TOUR_ICONS + tourStepData + step-navigation logic from
// auth-modal.js exactly — same 5 steps, same copy, same personalized
// step-1 title ("Welcome, @username."), same banner-vs-icon split (step 1
// shows the mascot banner, steps 2-5 show a small lime line icon).
const TOUR_ICONS: Record<string, ReactElement> = {
  rocket: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </svg>
  ),
  coin: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 0 1 2.5-1.5c1.5 0 2.5.8 2.5 1.8 0 2.2-5 1.7-5 4.2 0 1.2 1.2 2 2.7 2 1.4 0 2.5-.6 2.8-1.6" />
      <path d="M12 6.5v1M12 16v1.5" />
    </svg>
  ),
  community: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
      <circle cx="10" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  target: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  ),
};

interface TourStep {
  showBanner: boolean;
  icon?: keyof typeof TOUR_ICONS;
  title: string;
  desc: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    showBanner: true,
    title: "Welcome to Siterifty.",
    desc: "You've just joined the marketplace built for developers who build real things — websites, apps, and games — and the buyers who know their worth.",
  },
  {
    showBanner: true,
    icon: "rocket",
    title: "Listing is free.",
    desc: "List your websites, apps, and games at zero cost. No hidden fees, no commission traps — reach real buyers the moment you go live.",
  },
  {
    showBanner: true,
    icon: "coin",
    title: "You set the price.",
    desc: "Every sale is on your terms. Get paid directly, with no complicated payout setup standing between you and what you've earned.",
  },
  {
    showBanner: true,
    icon: "community",
    title: "Built-in trust.",
    desc: "Every listing and seller is verifiable. Buyers browse with confidence, and serious sellers stand out from the noise.",
  },
  {
    showBanner: true,
    icon: "target",
    title: "You're ready.",
    desc: "Head to your dashboard and publish your first listing. This is where builders and buyers meet — welcome to the marketplace.",
  },
];

const TOUR_BANNER_IMG =
  "https://www.image2url.com/r2/default/images/1783877370971-e6365528-ed07-4b90-81c0-f54c80a83c72.jpg";

export interface TourModalProps {
  open: boolean;
  username: string;
  onFinish: () => void;
}

// Ports window.__startTour / __updateTourStep / __nextTourStep / __closeTour.
// Step 1's title is personalized with the signed-up username, exactly like
// the original ('Welcome, @' + _tourUsername + '.'). On the last step,
// "Next" becomes "Get started" and finishing calls onFinish() — which in
// the original opens the theme picker next (window.__openThemePicker()).
// onFinish is left to the parent (AuthModalProvider) to wire to
// useThemeModal().openThemePicker() rather than this component reaching
// into a feature it doesn't own.
export default function TourModal({ open, username, onFinish }: TourModalProps) {
  const [step, setStep] = useState(0);
  const [animKey, setAnimKey] = useState(0);

  // Reset to step 0 every time the tour is (re)opened, same as __startTour
  // resetting currentTourStep = 0.
  useEffect(() => {
    if (open) {
      setStep(0);
      setAnimKey((k) => k + 1);
    }
  }, [open]);

  if (!open) return null;

  const isLast = step === TOUR_STEPS.length - 1;
  const current = TOUR_STEPS[step];
  const title = step === 0 ? `Welcome, @${username || "Creator"}.` : current.title;

  function handleNext() {
    if (!isLast) {
      setStep((s) => s + 1);
      setAnimKey((k) => k + 1);
    } else {
      onFinish();
    }
  }

  return (
    <div id="tourModal" className="active">
      <div className="tour-orb" />
      <div className="tour-shell">
        <div className="tour-topbar">
          <span className="tour-step-count">
            <b>{step + 1}</b>&nbsp;/&nbsp;<span>{TOUR_STEPS.length}</span>
          </span>
          <div className="tour-topbar-actions">
            <button className="tour-cta" onClick={handleNext}>
              <span>{isLast ? "Get started" : "Next"}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
        <div className="tour-rail">
          {TOUR_STEPS.map((_, i) => (
            <div key={i} className={`tour-rail-seg${i < step ? " done" : ""}${i === step ? " active" : ""}`} />
          ))}
        </div>
        <div className="tour-body">
          {/* key={animKey} re-triggers the entrance animation on every step
              change, matching the original's remove/reflow/re-add of the
              tour-step class. */}
          <div className="tour-step" key={animKey}>
            {current.showBanner ? (
              <div className="tour-banner">
                <img src={TOUR_BANNER_IMG} alt="Siterifty mascot" />
              </div>
            ) : (
              <div className="tour-icon-wrap">
                <span>{current.icon ? TOUR_ICONS[current.icon] : null}</span>
              </div>
            )}
            <h2 className="tour-title">{title}</h2>
            <p className="tour-desc">{current.desc}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
