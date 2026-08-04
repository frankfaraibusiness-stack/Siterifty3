/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // This app's own ScrollToTop component (app/layout.tsx) takes full
    // manual control of scroll-on-navigate instead — most pages here
    // scroll an inner overflow-y:auto panel rather than the window, so
    // Next's built-in browser-scroll-restoration heuristics (tuned for
    // plain window-scrolled pages) were fighting with that and causing
    // a freshly-navigated-to page to sometimes mount already scrolled
    // partway down (e.g. landing on the footer after a footer-link
    // navigation).
    scrollRestoration: false,
  },
};

export default nextConfig;
