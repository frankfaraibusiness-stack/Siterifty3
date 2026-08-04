import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getListingById } from "./getListing";
import { getPublicBaseUrl } from "@/lib/server/adminDb";
import { fmtPrice, type Listing } from "@/lib/listings";
import { buildListingSlug } from "@/lib/slug";
import { isRealPhoto } from "@/lib/og/ogCard";
import ListingViewBeacon from "./ListingViewBeacon";
import SimilarListingsStrip from "@/components/listing/SimilarListingsStrip";
import AppListingBody from "@/components/listing/AppListingBody";
import WebsiteListingBody from "@/components/listing/WebsiteListingBody";
import GameListingBody from "@/components/listing/GameListingBody";
import AssetListingBody from "@/components/listing/AssetListingBody";

// Only ACTIVE listings get real per-listing metadata / are servable at
// all here — mirrors the `status === 'active'` gate used everywhere else
// (feed query, isBoosted context, etc.). A sold/removed/pending listing
// was never publicly linked from the marketplace grid in the first
// place, so treating it as a 404 (rather than rendering stale data) is
// consistent with the rest of the app, not a new restriction.
function isPubliclyVisible(listing: Listing): boolean {
  return listing.status === "active";
}

// Short, crawler/link-preview-friendly description built from whatever
// fields the listing actually has — tagline first (author-written,
// usually the best summary), falling back to a truncated description,
// then a generic type+price line so metadata is never empty even for a
// bare-minimum listing doc.
function buildDescription(listing: Listing): string {
  if (listing.tagline) return listing.tagline;
  if (listing.description) {
    const trimmed = listing.description.trim();
    return trimmed.length > 160 ? trimmed.slice(0, 157) + "…" : trimmed;
  }
  const typeLabel = listing.type === "app" ? "App" : listing.type === "game" ? "Game" : "Website";
  return `${typeLabel} for sale on Siterifty — ${fmtPrice(listing.financials?.price)}.`;
}

// Same cover-photo resolution the old opengraph-image.tsx used: real
// listing photo first, app icon as fallback, never the placehold.co
// stand-in image. Used directly as the og:image/twitter:image URL now,
// instead of being fetched into a Satori-rendered card — next/og's
// renderer fetches external (Firebase Storage) images unreliably, which
// was silently breaking these cards.
function coverPhoto(listing: Listing): string | undefined {
  const candidate = listing.imageCover || listing.images?.[0] || listing.appIcon;
  return isRealPhoto(candidate) ? candidate : undefined;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const listing = await getListingById(id);

  if (!listing || !isPubliclyVisible(listing)) {
    return {
      title: "Listing not found — Siterifty",
      description: "This listing may have been removed or the link is incorrect.",
    };
  }

  const title = `${listing.title || "Listing"} — Siterifty`;
  const description = buildDescription(listing);
  const baseUrl = getPublicBaseUrl();
  const url = `${baseUrl}/listing/${buildListingSlug(listing.title, listing.id)}`;

  // og:image / twitter:image now point directly at the listing's own
  // Firebase-hosted photo — no more per-listing opengraph-image.tsx
  // Satori render, since that route unreliably fetched the same Firebase
  // Storage URL and silently produced a blank/broken card.
  const photo = coverPhoto(listing);

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      type: "website",
      images: photo ? [{ url: photo, width: 1200, height: 630, alt: listing.title || "Listing" }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: photo ? [photo] : undefined,
    },
  };
}

export default async function ListingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const listing = await getListingById(id);

  if (!listing || !isPubliclyVisible(listing)) {
    notFound();
  }

  // Canonicalize: a legacy bare-id link, or a link whose title-slug
  // prefix has gone stale after the listing was retitled, both still
  // resolve correctly (getListingById only ever trusts the id suffix —
  // see lib/slug.ts), but should permanently redirect to the current
  // canonical slug so there's exactly one indexable URL per listing and
  // shared links stay in sync with the listing's current title.
  const canonicalSlug = buildListingSlug(listing.title, listing.id);
  if (decodeURIComponent(id) !== canonicalSlug) {
    redirect(`/listing/${canonicalSlug}`);
  }

  const type = listing.type || "website";

  return (
    <>
      {/* Detail-view beacon — fires once per open, distinct from the
          card-impression counter. Mirrors _mpTrackListing('listing.view', ...)
          in mpOpenModal. Kept as a tiny client component since it's a
          fire-once-on-mount browser beacon, not something that belongs
          in a Server Component. */}
      <ListingViewBeacon listing={listing} />

      {/* Was an inline maxWidth:760/margin:auto single column repeated
          per type — widened on desktop but never split into columns
          (see listing-body.css's ".lst-body-wrap" comment for the
          ≥1024px two-column layout this class now enables). Swapped to
          a shared class, one edit point for all 4 listing types instead
          of 4 duplicated inline styles. */}
      {type === "app" && (
        <div className="lst-body-wrap" style={{ marginTop: 92, padding: "0 0 80px" }}>
          <AppListingBody listing={listing} />
        </div>
      )}

      {type === "website" && (
        <div className="lst-body-wrap" style={{ marginTop: 92, padding: "0 0 80px" }}>
          <WebsiteListingBody listing={listing} />
        </div>
      )}

      {type === "game" && (
        <div className="lst-body-wrap" style={{ marginTop: 92, padding: "0 0 80px" }}>
          <GameListingBody listing={listing} />
        </div>
      )}

      {type === "3d" && (
        <div className="lst-body-wrap" style={{ marginTop: 92, padding: "0 0 80px" }}>
          <AssetListingBody listing={listing} />
        </div>
      )}

      {(type === "app" || type === "website" || type === "game" || type === "3d") && (
        <SimilarListingsStrip listingId={listing.id} />
      )}

      {/* Every known listing type (website/app/game/3d) now has a real body —
          this only catches an unexpected/corrupt `type` value on the doc. */}
      {type !== "app" && type !== "website" && type !== "game" && type !== "3d" && (
        <div style={{ marginTop: 92, padding: "40px 24px 80px", textAlign: "center", color: "#fff" }}>
          <h1>{listing.title || "Listing"}</h1>
          <p style={{ opacity: 0.7 }}>
            This listing has an unrecognized type (&ldquo;{type}&rdquo;) and can&apos;t be displayed.
          </p>
        </div>
      )}
    </>
  );
}
