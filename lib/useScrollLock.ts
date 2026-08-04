"use client";

import { useEffect } from "react";

// Shared scroll lock for every modal/overlay in the app. Replaces the
// copy-pasted "save body.style.overflow, set to hidden, restore on
// unmount" effect that used to be duplicated (slightly differently) in
// EditListingModal, BoostModal, AuthModal, TransferDealModal,
// AiSupportChatPanel, SearchOverlay, NavDrawerProvider, and
// LogoutModalProvider — and was missing entirely from every other
// modal/overlay (Wallet, Agent, Plans, Theme, DisputePicker, the seller
// overlays, dashboard/onboarding/system overlays, etc.), which is what let
// the page underneath keep scrolling while one of those was open.
//
// Reference-counted via a module-level counter rather than a plain
// boolean: several of these can legitimately be open at once (e.g.
// AuthModal's sign-in tour opening ThemeModal, or EditListingModal opening
// while MyProfileHub/WalletModal is already up). With a plain boolean,
// closing the second-opened modal would restore scroll while the first
// one is still open. Counting locks means scroll only actually restores
// once every open modal has released its lock.
let lockCount = 0;
let previousBodyOverflow = "";
let previousHtmlOverflow = "";

function lock() {
  if (lockCount === 0) {
    previousBodyOverflow = document.body.style.overflow;
    previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    // body-only overflow:hidden stops the body element's own scrollbox,
    // but on many pages the actual scrollable box is the <html> root
    // (whichever one has the taller content ends up being the one that
    // scrolls) — so a mouse-wheel scroll over the page could still move
    // html underneath a "locked" body. Lock both, same as the existing
    // html.mnt-mode / html.mnt-mode body pairing in base.css.
    document.documentElement.style.overflow = "hidden";
  }
  lockCount += 1;
}

function unlock() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.body.style.overflow = previousBodyOverflow;
    document.documentElement.style.overflow = previousHtmlOverflow;
  }
}

// `overflow:hidden` on body stops wheel/keyboard scroll but does NOT stop
// iOS Safari from rubber-band scrolling the page behind a fixed-position
// overlay via touch drag. AuthModal and OnboardingWizard each hand-rolled
// a document-level touchmove blocker for this; every other modal (Rate,
// Donate, seller details/report, PlansModal/Upgrade, ThemeModal, etc.)
// never got one, which is why body scroll looked "locked" on desktop but
// the page behind the modal still dragged/rubber-banded on a phone.
// Reference-counted the same way as the overflow lock above, so several
// stacked modals share one listener instead of each registering its own.
let touchLockCount = 0;
function blockTouch(e: TouchEvent) {
  const target = e.target as HTMLElement | null;
  // Exempt anything inside a designated scrollable content area so a
  // modal whose own body is taller than the viewport can still scroll
  // internally (mirrors AuthModal's [data-sr-modal-scroll] / 
  // OnboardingWizard's .ob-content-wrapper exemption).
  if (target && target.closest("[data-scroll-lock-exempt]")) return;
  e.preventDefault();
}

function lockTouch() {
  if (touchLockCount === 0) {
    document.addEventListener("touchmove", blockTouch, { passive: false });
  }
  touchLockCount += 1;
}

function unlockTouch() {
  touchLockCount = Math.max(0, touchLockCount - 1);
  if (touchLockCount === 0) {
    document.removeEventListener("touchmove", blockTouch);
  }
}

/**
 * Locks page scroll (wheel/keyboard via html + body overflow, and iOS
 * touch drag via a document-level touchmove blocker) while `active` is
 * true.
 * Safe to use in many components at once — scroll is only restored once
 * every component that locked it has released (unmounted or flipped
 * `active` to false).
 *
 * If the modal has its own internal scrollable area that needs to keep
 * working (e.g. step content taller than the viewport), add
 * `data-scroll-lock-exempt` to that element.
 */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    lock();
    lockTouch();
    return () => {
      unlock();
      unlockTouch();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
