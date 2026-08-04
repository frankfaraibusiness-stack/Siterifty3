import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import Script from "next/script";
import { getPublicBaseUrl } from "@/lib/server/adminDb";
import "./globals.css";
import Header from "@/components/layout/Header";
import NavDrawer from "@/components/layout/NavDrawer";
import NavDrawerOverlay from "@/components/layout/NavDrawerOverlay";
import { NavDrawerProvider } from "@/components/layout/NavDrawerProvider";
import HomeMarketplaceOnly from "@/components/layout/HomeMarketplaceOnly";
import ConditionalFooter from "@/components/layout/ConditionalFooter";
import ScrollToTop from "@/components/layout/ScrollToTop";
import AnnouncementBar from "@/components/layout/AnnouncementBar";
import BootOverlay from "@/components/layout/BootOverlay";
import PushServiceWorkerRegister from "@/components/layout/PushServiceWorkerRegister";
import { AuthProvider } from "@/lib/AuthContext";
import { CurrencyProvider } from "@/lib/CurrencyContext";
import { AuthModalProvider } from "@/components/auth/AuthModalProvider";
import { WalletModalProvider } from "@/components/wallet/WalletModalProvider";
import { BoostModalProvider } from "@/components/boost/BoostModalProvider";
import { AgentModalProvider } from "@/components/agent/AgentModalProvider";
import { EditListingModalProvider } from "@/components/listing/EditListingModalProvider";
import { PlansModalProvider } from "@/components/billing/PlansModalProvider";
import { ThemeModalProvider } from "@/components/theme/ThemeModalProvider";
import NotificationsProvider from "@/components/notifications/NotificationsProvider";
import SystemStatusProvider from "@/components/system/SystemStatusProvider";
import WelcomeBackScreen from "@/components/system/WelcomeBackScreen";
import { AiSupportChatModalProvider } from "@/components/support/AiSupportChatModalProvider";
import { DealPopupProvider } from "@/components/deal/DealPopupProvider";
import { DisputePickerProvider } from "@/components/dispute/DisputePickerProvider";
import { ImageLightboxProvider } from "@/components/listing/ImageLightboxProvider";
import { MarketplaceSearchProvider } from "@/components/marketplace/MarketplaceSearchProvider";
import { SrToastProvider } from "@/components/system/SrToastProvider";

const SITE_TITLE =
  "Siterifty — Buy & Sell Websites, Apps & Games";
const SITE_DESCRIPTION =
  "Siterifty is an escrow-protected marketplace for indie developers to buy and sell websites, apps, and games — safe, verified deals start to finish.";

// Original index.html sets this explicitly via <meta name="viewport"
// content="width=device-width, initial-scale=1.0">. Next.js doesn't
// reliably inject an equivalent default on its own — without this export
// some mobile browsers fall back to a desktop-width viewport (~980px)
// and scale the whole page down to fit, which looks like everything
// rendered correctly but narrower/zoomed-out than the original.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  metadataBase: new URL(getPublicBaseUrl()),
  title: {
    default: SITE_TITLE,
    // "%s" (not "%s | Siterifty") because every child page already sets
    // its own full explicit title ending in "— Siterifty" or "| Siterifty"
    // — a template suffix here would double-append it.
    template: "%s",
  },
  description: SITE_DESCRIPTION,
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    siteName: "Siterifty",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    type: "website",
    images: [
      {
        url: "https://cdn.phototourl.com/member/2026-07-20-ac4fdc9a-270f-485c-8e67-990e9e8de1b6.jpg",
        width: 1200,
        height: 630,
        alt: "Siterifty — Buy & Sell Websites, Apps & Games",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ["https://cdn.phototourl.com/member/2026-07-20-ac4fdc9a-270f-485c-8e67-990e9e8de1b6.jpg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {/* Ports the early FOUC-prevention IIFE from announcement-settings.js
            (index.html lines 162-175) — applies srf_fontSize / srf_compactMode
            from localStorage before paint, so there's no flash of default
            15px/non-compact layout while the rest of the app hydrates and
            useSettingsState's own (Firestore-backed, async, Settings-page-only)
            application catches up. beforeInteractive runs this before React
            hydrates, same timing guarantee the original got from being an
            inline <head> script. */}
        <Script id="srf-early-appearance" strategy="beforeInteractive">
          {`(function(){try{
            var fs=localStorage.getItem('srf_fontSize');
            if(fs){var px={small:'13px',medium:'15px',large:'17px'}[fs]||'15px';
              document.documentElement.style.setProperty('--app-font-size',px);
              document.body.style.fontSize=px;}
            var cm=localStorage.getItem('srf_compactMode');
            if(cm==='1')document.body.classList.add('compact-mode');
          }catch(e){}})();`}
        </Script>
        {/* Ports #appThemeBg from index.html — the full-viewport backdrop
            layer that __applyTheme's CSS custom properties
            (--app-theme-bg / --app-theme-color / --app-theme-overlay)
            paint into. Sits outside every provider since it's pure CSS,
            no state needed here. */}
        <div id="appThemeBg" aria-hidden="true" />
        {/* Resets window (and known inner overflow-y:auto panels) scroll
            to top on every real navigation — see ScrollToTop.tsx's own
            comment for the footer-link-leaves-page-scrolled bug this
            fixes. Mounted outside every provider since it has no
            dependency on auth/theme/etc, just route + search params;
            wrapped in Suspense because useSearchParams requires one in
            the App Router. */}
        <Suspense fallback={null}>
          <ScrollToTop />
        </Suspense>
        <PushServiceWorkerRegister />
        {/* Image lightbox — zoomable/pannable full-screen image viewer,
            opened by clicking any element carrying .srf-lightbox-trigger
            (listing cover/gallery images). Self-contained: no auth or
            other context dependency, just a document-level click
            delegation listener + its own state, so it sits outside
            AuthProvider and wraps everything so its trigger listener is
            live from first paint (including on BootOverlay/auth-gated
            screens, matching the original's always-present global DOM
            node behavior). */}
        <ImageLightboxProvider>
        <SrToastProvider>
        <AuthProvider>
          {/* Boot overlay — first thing rendered, removed only after auth
              resolves once + a cooldown, same comment/positioning as the
              original's index.html. */}
          <BootOverlay />
          {/* Maintenance-mode takeover + banned/suspended account
              overlay — both are full-screen, no-dismiss states that
              should render above everything else, same tier as
              BootOverlay. Must be inside AuthProvider (reads
              useAuth()) but works correctly for signed-out visitors
              too, since useAuth() resolves to null rather than
              throwing when nobody's signed in. */}
          <SystemStatusProvider />
          {/* Welcome Back — full-screen daily-objectives takeover shown
              once per sign-in to returning users (account created before
              today), right after the boot splash's own hold. Same tier
              as the overlays above; renders null until it decides to
              open, so it's safe to mount unconditionally here. */}
          <WelcomeBackScreen />
          {/* Global notification toasts + "missed while away" panel —
              needs to be inside AuthProvider (reads useAuth()) but has
              no particular nesting requirement relative to the other
              modal providers below, since it doesn't call any of their
              hooks. */}
          <NotificationsProvider />
          {/* Currency conversion context — display-only (see
              lib/CurrencyContext.tsx's own top comment: escrow/PayPal
              always settle in USD regardless of what's selected here).
              Needs useAuth() for the signed-in Firestore sync, so it must
              be inside AuthProvider; wraps everything below it since both
              Header (price displays, if/when added there) and the
              Settings → Appearance panel's currency picker need
              useCurrency(), and neither is nested inside any of the modal
              providers this wraps. */}
          <CurrencyProvider>
          {/* ThemeModalProvider wraps AuthModalProvider (rather than
              nesting inside it, like Wallet/Plans do) because
              AuthModalProvider's tour-finish handler calls
              useThemeModal() itself — it needs to be a descendant of
              ThemeModalProvider's context, not a sibling/ancestor. */}
          <ThemeModalProvider>
            <AuthModalProvider>
              <WalletModalProvider>
                <BoostModalProvider>
                <AgentModalProvider>
                <EditListingModalProvider>
                <PlansModalProvider>
                <AiSupportChatModalProvider>
                {/* DealPopupProvider needs useAuthModal() for its sign-in
                    gate (same reason WalletModalProvider/BoostModalProvider
                    live inside AuthModalProvider), and doesn't need to sit
                    above/below any of its siblings here — nested innermost
                    among the modal providers, same tier as
                    AiSupportChatModalProvider. */}
                <DealPopupProvider>
                <DisputePickerProvider>
                  <MarketplaceSearchProvider>
                  <NavDrawerProvider>
                    <Header />
                    <NavDrawerOverlay />
                    <NavDrawer />
                    <AnnouncementBar />
                    <main>{children}</main>
                    {/* Real, always-crawlable footer on every page except
                        the fixed-height app-shell routes (Settings) where
                        it's structurally unreachable — see
                        ConditionalFooter.tsx's own top comment. */}
                    <ConditionalFooter />
                    {/* BottomNav + the floating feedback launcher only
                        belong on the two "browse" surfaces (Home,
                        Marketplace) — see HomeMarketplaceOnly's own
                        top comment for why they can't just stay
                        globally mounted like in the original. */}
                    <HomeMarketplaceOnly />
                  </NavDrawerProvider>
                  </MarketplaceSearchProvider>
                </DisputePickerProvider>
                </DealPopupProvider>
                </AiSupportChatModalProvider>
                </PlansModalProvider>
                </EditListingModalProvider>
                </AgentModalProvider>
                </BoostModalProvider>
              </WalletModalProvider>
            </AuthModalProvider>
          </ThemeModalProvider>
          </CurrencyProvider>
        </AuthProvider>
        </SrToastProvider>
        </ImageLightboxProvider>
      </body>
    </html>
  );
}
