// Shared branded OG-card layout, used by every opengraph-image.tsx route
// (site root, per-listing, per-seller). One component, not three
// copy-pasted JSX trees — callers pass in what differs (eyebrow, title,
// stats, accent, avatar/photo).
//
// Design matches the app's own dark theme: body background is #000 (see
// app/globals.css's `body` rule), brand accent defaults to the site's lime
// (--mp-accent: #a3e635, same value hardcoded here since CSS custom
// properties aren't available inside next/og's isolated renderer), and the
// wordmark styling mirrors components/layout/Header.tsx's `.brand` /
// `.brand span` rule — plain white "Siterifty" + a dimmer lime ".com", not
// a gradient.

export const OG_SIZE = { width: 1200, height: 630 };

export const DEFAULT_ACCENT = "#a3e635"; // --mp-accent in app/globals.css

// A URL from the app's own placehold.co fallback (see WebsiteListingBody.tsx)
// is a "no real photo" placeholder, not real content — never render it as
// a real photo in a public-facing OG card.
export function isRealPhoto(url: string | undefined | null): url is string {
  return !!url && !url.includes("placehold.co");
}

export interface OgStat {
  label: string;
  value: string;
}

export interface OgCardProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  stats?: OgStat[];
  accent?: string;
  avatarUrl?: string; // circular — for seller cards
  photoUrl?: string; // rectangular — for listing cover photos
}

export function OgCard({
  eyebrow,
  title,
  subtitle,
  stats,
  accent = DEFAULT_ACCENT,
  avatarUrl,
  photoUrl,
}: OgCardProps) {
  const hasMedia = !!(avatarUrl || photoUrl);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: "#000",
        padding: "64px 72px",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {/* Wordmark — matches Header.tsx's .brand / .brand span: plain
          white "Siterifty" + dimmer lime ".com", no gradient. The glyph
          is an inline shape (not a fetched image) since Satori — the
          renderer next/og uses — unreliably fetches/renders external
          SVGs, which was silently breaking this card's render
          entirely. */}
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div
          style={{
            display: "flex",
            width: 40,
            height: 40,
            borderRadius: 10,
            background: accent,
          }}
        />
        <div style={{ display: "flex", fontSize: 26, fontWeight: 800, letterSpacing: "-0.04em" }}>
          <span style={{ color: "#fff" }}>Siterifty</span>
          <span style={{ color: "rgba(163,230,53,0.55)" }}>.com</span>
        </div>
      </div>

      {/* Body */}
      <div style={{ display: "flex", alignItems: "center", gap: 48 }}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
          {eyebrow && (
            <div
              style={{
                display: "flex",
                fontSize: 22,
                fontWeight: 700,
                color: accent,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                marginBottom: 18,
              }}
            >
              {eyebrow}
            </div>
          )}
          <div
            style={{
              display: "flex",
              fontSize: hasMedia ? 56 : 64,
              fontWeight: 800,
              color: "#fff",
              lineHeight: 1.12,
              letterSpacing: "-0.02em",
            }}
          >
            {title}
          </div>
          {subtitle && (
            <div
              style={{
                display: "flex",
                fontSize: 26,
                color: "rgba(255,255,255,0.65)",
                marginTop: 20,
                lineHeight: 1.4,
              }}
            >
              {subtitle}
            </div>
          )}
          {stats && stats.length > 0 && (
            <div style={{ display: "flex", gap: 14, marginTop: 32 }}>
              {stats.map((s) => (
                <div
                  key={s.label}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 8,
                    background: "rgba(163,230,53,0.12)",
                    border: `1px solid ${accent}55`,
                    borderRadius: 999,
                    padding: "10px 22px",
                  }}
                >
                  <span style={{ fontSize: 24, fontWeight: 800, color: accent }}>{s.value}</span>
                  <span style={{ fontSize: 18, color: "rgba(255,255,255,0.55)" }}>{s.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {avatarUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            width={220}
            height={220}
            alt=""
            style={{ borderRadius: "50%", objectFit: "cover", border: `4px solid ${accent}` }}
          />
        )}
        {!avatarUrl && photoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrl}
            width={420}
            height={320}
            alt=""
            style={{ borderRadius: 20, objectFit: "cover", border: `2px solid ${accent}55` }}
          />
        )}
      </div>
    </div>
  );
}
