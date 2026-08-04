"use client";

// The single place a 3D Asset's embedUrl ever becomes a real <iframe> in the
// DOM. We never accept or render raw HTML from sellers (no
// dangerouslySetInnerHTML) — embedUrl is always a plain, server-validated
// http(s) URL (see lib/embedUrl.ts + _handler.js's resolveEmbedUrl), and
// this component owns every attribute on the resulting iframe. `sandbox`
// intentionally omits allow-same-origin + allow-top-navigation so an
// embedded page can render its 3D viewer (which needs scripts) but can't
// read/write Siterifty's own cookies/storage or navigate the parent tab.
interface AssetIframeProps {
  src: string;
  title: string;
  interactive?: boolean; // false = decorative preview (grid cards); true = the real viewer (listing detail page)
  className?: string;
}

export default function AssetIframe({ src, title, interactive = true, className }: AssetIframeProps) {
  return (
    <iframe
      src={src}
      title={title}
      loading="lazy"
      allow="autoplay; fullscreen; xr-spatial-tracking"
      allowFullScreen
      sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      style={{
        width: "100%",
        height: "100%",
        border: 0,
        display: "block",
        pointerEvents: interactive ? "auto" : "none",
      }}
      className={className}
    />
  );
}
