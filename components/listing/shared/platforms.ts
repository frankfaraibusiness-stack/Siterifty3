// Shared platform metadata for App and Game listing forms. A "platform"
// here means anywhere the product is actually distributed — including a
// game that also ships as a Play Store / App Store app rather than only
// running in a browser, which the old game form didn't support (it only
// had a single Android/Desktop/Both dropdown with no store link or
// installs/MAU capture at all).
//
// Store-distributed platforms (ios/android) require Installs + Monthly
// Active Users when the listing is marked Live on that platform — those
// numbers are how a buyer sanity-checks a store listing's traction.
// Non-store platforms (web/steam/desktop) don't get that requirement since
// there's no single install-count source of truth for them.

export type PlatformKey = "ios" | "android" | "web" | "steam" | "desktop";

export interface PlatformMeta {
  key: PlatformKey;
  label: string;
  isStore: boolean; // store-distributed → installs/MAU apply when live
  urlLabel: string;
  urlPlaceholder: string;
  buildUrlLabel: string;
  buildUrlPlaceholder: string;
}

export const PLATFORM_META: Record<PlatformKey, PlatformMeta> = {
  ios: {
    key: "ios",
    label: "iOS (App Store)",
    isStore: true,
    urlLabel: "App Store URL",
    urlPlaceholder: "https://apps.apple.com/...",
    buildUrlLabel: "Link to your .ipa (any host)",
    buildUrlPlaceholder: "https://drive.google.com/... or any direct link",
  },
  android: {
    key: "android",
    label: "Android (Play Store)",
    isStore: true,
    urlLabel: "Play Store URL",
    urlPlaceholder: "https://play.google.com/...",
    buildUrlLabel: "Link to your .apk/.aab (any host)",
    buildUrlPlaceholder: "https://drive.google.com/... or any direct link",
  },
  web: {
    key: "web",
    label: "Web",
    isStore: false,
    urlLabel: "Site URL",
    urlPlaceholder: "https://example.com",
    buildUrlLabel: "",
    buildUrlPlaceholder: "",
  },
  steam: {
    key: "steam",
    label: "Steam",
    isStore: false,
    urlLabel: "Steam Store URL",
    urlPlaceholder: "https://store.steampowered.com/app/...",
    buildUrlLabel: "Link to your build (any host)",
    buildUrlPlaceholder: "https://drive.google.com/... or any direct link",
  },
  desktop: {
    key: "desktop",
    label: "Desktop (direct download)",
    isStore: false,
    urlLabel: "Download page URL (optional)",
    urlPlaceholder: "https://example.com/download",
    buildUrlLabel: "Link to your build (any host)",
    buildUrlPlaceholder: "https://drive.google.com/... or any direct link",
  },
};

export interface PlatformStats {
  installs?: string;
  mau?: string;
}

// Inline SVG path data for each platform's picker icon — kept as raw path
// `d` strings (rendered via a shared <PlatformIcon> in each form) rather
// than pulling in a logo font or icon-CDN dependency. Apple/Play
// Store/Steam are simplified single-path glyphs (viewBox 0 0 24 24);
// Web/Desktop use a generic outline since there's no single brand mark
// for "any website" or "any desktop app".
export const PLATFORM_ICON_PATH: Record<PlatformKey, string> = {
  ios: "M16.365 1.43c0 1.14-.416 2.06-1.25 2.78-.834.72-1.79 1.14-2.87 1.06-.14-1.1.32-2.14 1.14-2.85.84-.73 1.98-1.14 2.98-1.99zM20.3 17.24c-.5 1.16-1.1 2.28-1.83 3.36-1.02 1.5-1.83 2.53-2.44 3.1-.94.9-1.95.9-3 .3-.7-.4-1.42-.6-2.16-.6-.77 0-1.5.2-2.22.6-1 .58-1.9.6-2.87-.32-.65-.62-1.5-1.7-2.56-3.26-1.14-1.7-1.72-3.35-1.72-4.98 0-1.85.4-3.4 1.2-4.66.8-1.27 1.87-1.9 3.2-1.92.68-.02 1.5.24 2.5.78.98.53 1.65.79 2.02.79.28 0 1.04-.3 2.28-.9 1.17-.55 2.16-.78 2.97-.7 2.2.18 3.86 1.05 4.96 2.63-1.97 1.2-2.95 2.87-2.94 5.02.02 1.68.65 3.08 1.87 4.2z",
  android: "M6 18c0 .55.45 1 1 1h1v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h2v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h1c.55 0 1-.45 1-1V8H6v10zM3.5 8C2.67 8 2 8.67 2 9.5v7c0 .83.67 1.5 1.5 1.5S5 17.33 5 16.5v-7C5 8.67 4.33 8 3.5 8zM20.5 8c-.83 0-1.5.67-1.5 1.5v7c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5v-7c0-.83-.67-1.5-1.5-1.5zM15.53 2.16l1.06-1.06a.5.5 0 0 0-.7-.7l-1.22 1.2A5.94 5.94 0 0 0 12 1c-.98 0-1.9.23-2.67.6L8.11.4a.5.5 0 1 0-.7.7l1.06 1.06C7.06 3.06 6 4.86 6 7h12c0-2.14-1.06-3.94-2.47-4.84zM10 5H9V4h1v1zm5 0h-1V4h1v1z",
  web: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.93 6h-2.95a15.7 15.7 0 0 0-1.38-3.56A8.03 8.03 0 0 1 18.93 8zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14a7.97 7.97 0 0 1 0-4h3.38a16.6 16.6 0 0 0 0 4H4.26zm.81 2h2.95c.32 1.25.78 2.45 1.38 3.56A8.03 8.03 0 0 1 5.07 16zm2.95-8H5.07a8.03 8.03 0 0 1 4.33-3.56A15.7 15.7 0 0 0 8.02 8zM12 19.96a15.7 15.7 0 0 1-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66a14.6 14.6 0 0 1 0-4h4.68a14.6 14.6 0 0 1 0 4zm.3 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95a8.03 8.03 0 0 1-4.33 3.56zM16.36 14a16.6 16.6 0 0 0 0-4h3.38a7.97 7.97 0 0 1 0 4h-3.38z",
  steam: "M12 2C6.5 2 2 6.5 2 12c0 4.6 3.15 8.47 7.42 9.57l.03-.02a3.5 3.5 0 0 0 3.4-2.68l2.42-1.02a3.75 3.75 0 1 0-.4-1.55l-2.28.96a3.5 3.5 0 0 0-4.24-1.05L6.4 15.1a1.7 1.7 0 1 1-.1-1.9l1.83 1.15c.24-.5.6-.94 1.05-1.28L7.35 11a2.5 2.5 0 1 1 2.98-3.6l3.1 1.3a3.75 3.75 0 1 0 1.9-2.9l-3.1-1.3A2.5 2.5 0 0 1 12 4c1.03 0 1.94.55 2.44 1.37l.05-.02L12 2zm5.75 5.5a2.25 2.25 0 1 1 0 4.5 2.25 2.25 0 0 1 0-4.5z",
  desktop: "M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-6l1 3H9l1-3H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm0 2v9h16V6H4z",
};
