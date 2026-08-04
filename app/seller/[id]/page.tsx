import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSellerSeoProfile, getSellerFullProfile } from "./getSeller";
import { getPublicBaseUrl } from "@/lib/server/adminDb";
import { isRealPhoto } from "@/lib/og/ogCard";
import SellerProfileClient from "./SellerProfileClient";

// NOTE: this route intentionally never calls notFound() for a missing
// seller doc — the old client page rendered an inline "Seller not found"
// message instead of a real 404, and SellerProfileClient still owns that
// check for the not-found case. generateMetadata below independently
// handles the missing/private cases for crawlers so the two don't need
// to be kept in exact sync.
//
// SellerProfilePage now also does a full server-side fetch
// (getSellerFullProfile) so the page body — bio, listings, rating — is
// present in the initial server-rendered HTML for SEO/crawlers, passed
// into SellerProfileClient as `initialSeller`. SellerProfileClient still
// re-fetches fresh client-side on mount (via fetchFullSeller) for the
// same reason it always has — auth-aware fields like isOwnProfile and
// "members"-visibility access aren't knowable server-side — so
// `initialSeller` is only ever the signed-out-safe starting point, not
// the final source of truth.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const seller = await getSellerSeoProfile(id);

  if (!seller) {
    return {
      title: "Seller not found — Siterifty",
      description: "This seller profile may have been removed or the link is incorrect.",
    };
  }

  // PRIVACY GATE — mirrors the exact check SellerProfileClient applies
  // for human visitors (profileVisibility === "private" hides everything
  // but username; "members" also hides from signed-out visitors, but
  // metadata has no concept of a signed-in crawler, so it's treated the
  // same as signed-out here — the safer of the two). Crawlers/link-preview
  // bots never get the real bio, rating, or listing count for a
  // non-public profile — only a generic line, same as what a signed-out
  // stranger sees in the private-profile branch of the client component.
  const isPubliclyDiscoverable = seller.profileVisibility === "public";

  const baseUrl = getPublicBaseUrl();
  const url = `${baseUrl}/seller/${encodeURIComponent(seller.username)}`;

  if (!isPubliclyDiscoverable) {
    const title = `${seller.username} — Siterifty`;
    return {
      title,
      description: "This seller's profile is private.",
      alternates: { canonical: url },
      // No OG image/description beyond the generic line — nothing about
      // a private profile should be more discoverable via a link
      // preview than it is by visiting the page directly signed out.
      openGraph: { title, description: "This seller's profile is private.", url, type: "profile" },
      robots: { index: false, follow: false },
    };
  }

  const title = `${seller.username} — Seller on Siterifty`;

  // Stat line is always present — it's what actually differentiates one
  // seller from another in search results, where a bio alone doesn't. A
  // bio (if set and visible) is prepended before it rather than replacing
  // it.
  const bioLine = seller.showBio && seller.bio ? seller.bio.trim() : "";
  const truncatedBio = bioLine.length > 140 ? bioLine.slice(0, 137) + "…" : bioLine;

  const joinedLabel = seller.joinedAt
    ? seller.joinedAt.toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : null;

  let statLine = `${seller.username} has ${seller.activeListingCount} listing${
    seller.activeListingCount === 1 ? "" : "s"
  } and ${seller.followerCount} follower${seller.followerCount === 1 ? "" : "s"}`;
  statLine += joinedLabel
    ? `, and has been a Siterifty seller since ${joinedLabel}.`
    : ".";
  if (seller.ratingCount > 0) {
    statLine += ` Rated ${seller.rating.toFixed(1)}/5.`;
  }

  const description = truncatedBio ? `${truncatedBio} ${statLine}` : statLine;

  // og:image / twitter:image now point directly at the seller's own
  // Firebase-hosted avatar — no more per-seller opengraph-image.tsx
  // Satori render, since that route unreliably fetched the same Firebase
  // Storage URL and silently produced a blank/broken card. Never falls
  // back to the placehold.co stand-in avatar (see isRealPhoto).
  const avatar = isRealPhoto(seller.profilePic) ? seller.profilePic : undefined;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      type: "profile",
      images: avatar ? [{ url: avatar, width: 1200, height: 630, alt: seller.username }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: avatar ? [avatar] : undefined,
    },
  };
}

export default async function SellerProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const seller = await getSellerSeoProfile(id);

  // Canonicalize: a legacy /seller/{uid} link (or a stale username after
  // a rename) still resolves — getSellerSeoProfile falls back from a
  // doc-id lookup to a usernameLower query — but should permanently
  // redirect to /seller/{username} so there's exactly one indexable,
  // shareable URL per seller going forward. A missing seller falls
  // through to SellerProfileClient's own "not found" UI unchanged (see
  // the note at the top of this file).
  if (seller && decodeURIComponent(id) !== seller.username) {
    redirect(`/seller/${encodeURIComponent(seller.username)}`);
  }

  // Full profile (bio, listings, socials — already privacy-gated inside
  // getSellerFullProfile) for SSR content: passed into SellerProfileClient
  // as its initial state instead of that component starting from `null`
  // and only getting real content after its own client-side fetch
  // resolves. Reuses seller.uid (already resolved above) rather than
  // re-running the doc-id-or-username lookup a second time with a
  // possibly-different result.
  const initialSeller = seller ? await getSellerFullProfile(seller.uid) : null;

  return <SellerProfileClient uid={seller ? seller.uid : id} initialSeller={initialSeller} />;
}
