import type { Metadata } from "next";
import Link from "next/link";
import { getPublicBaseUrl } from "@/lib/server/adminDb";

// Public showcase of Siterifty's own brand/product imagery — homepage
// design, marketplace layout, support hub, mascot — kept as real <img>
// elements (not CSS backgrounds) with keyword-rich alt text so Google
// Images has a real, indexable page to crawl. New entries just get
// appended to GALLERY_IMAGES below as the brand adds more artwork.
const TITLE = "Siterifty Gallery — Marketplace Design & Brand Showcase";
const DESCRIPTION =
  "Browse Siterifty's original marketplace designs, brand artwork, and product screenshots — the trusted platform to buy, sell, and discover websites, apps, and games.";

export function generateMetadata(): Metadata {
  const url = `${getPublicBaseUrl()}/gallery`;
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: url },
    openGraph: { title: TITLE, description: DESCRIPTION, url, type: "website" },
    twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
  };
}

interface GalleryImage {
  src: string;
  alt: string;
  caption: string;
}

// Every real image currently on the site. Add new entries here as more
// artwork is produced — each needs a real src and a distinct, keyword-
// rich alt (not the same phrase repeated) so pages don't read as
// keyword-stuffed to Google.
const GALLERY_IMAGES: GalleryImage[] = [
  {
    src: "/images/siterifty-logo.png",
    alt: "Siterifty logo — buy and sell websites, apps and games marketplace",
    caption: "Siterifty logo",
  },
  {
    src: "/images/siterifty-hero-marketplace.jpg",
    alt: "Siterifty marketplace homepage — buy, sell and discover websites, apps and games",
    caption: "Marketplace homepage design",
  },
  {
    src: "https://cdn.phototourl.com/member/2026-07-20-ac4fdc9a-270f-485c-8e67-990e9e8de1b6.jpg",
    alt: "Siterifty marketplace listings page — verified websites, apps and games for sale",
    caption: "Marketplace listings showcase",
  },
  {
    src: "https://cdn.phototourl.com/member/2026-07-20-efda558d-1cca-4278-a6c2-1d850da8299f.jpg",
    alt: "Siterifty support center — help buying and selling digital assets safely",
    caption: "Support center design",
  },
];

export default function GalleryPage() {
  return (
    <div style={{ marginTop: 92, padding: "48px 24px 100px", display: "flex", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 1100 }}>
        <Link
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            color: "var(--mp-text-sec)",
            fontSize: 13,
            fontWeight: 600,
            textDecoration: "none",
            marginBottom: 28,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}>
            <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to Siterifty
        </Link>

        <div
          style={{
            color: "var(--mp-accent)",
            fontSize: 12.5,
            fontWeight: 800,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            marginBottom: 10,
          }}
        >
          Gallery
        </div>

        <h1
          style={{
            color: "var(--mp-text)",
            fontSize: "clamp(28px, 4vw, 40px)",
            fontWeight: 800,
            lineHeight: 1.15,
            margin: 0,
          }}
        >
          Siterifty design &amp; brand showcase
        </h1>

        <p
          style={{
            color: "var(--mp-text-sec)",
            fontSize: 16,
            lineHeight: 1.6,
            marginTop: 16,
            maxWidth: 640,
          }}
        >
          Original marketplace designs, brand artwork, and product screenshots from Siterifty — the trusted
          marketplace to buy, sell, and discover websites, apps, and games.
        </p>

        <div
          style={{
            marginTop: 40,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 24,
          }}
        >
          {GALLERY_IMAGES.map((img) => (
            <figure
              key={img.src}
              style={{
                margin: 0,
                background: "var(--mp-surface)",
                border: "1px solid var(--mp-border)",
                borderRadius: "var(--mp-radius)",
                overflow: "hidden",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.src}
                alt={img.alt}
                loading="lazy"
                style={{
                  width: "100%",
                  height: 200,
                  objectFit: "cover",
                  display: "block",
                  background: "#000",
                }}
              />
              <figcaption
                style={{
                  padding: "12px 16px",
                  color: "var(--mp-text-sec)",
                  fontSize: 13.5,
                  fontWeight: 600,
                }}
              >
                {img.caption}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </div>
  );
}
