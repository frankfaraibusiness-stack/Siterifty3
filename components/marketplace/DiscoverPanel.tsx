"use client";

// Full-screen "Discover" takeover — replaces the old small #mpAiSearchPanel
// popup 1:1 at its trigger point (MarketplaceFilterBar). Despite the old
// name ("AI Search"), this never called an AI model — it's a plain browse/
// discovery surface, now explicitly presented as one: a scrollable,
// YouTube-style full-screen feed of blog posts, listings, and sellers.
//
// Deliberately unranked — random slice per open, not sorted by engagement.
// See lib/discover.ts + _handler.js's handleDiscover for the full reasoning
// (maintaining extra engagement counters across every listing/blog/user
// doc for a ranking feature isn't worth the added read/write cost here).
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { fetchDiscover, type DiscoverBlog, type DiscoverListing, type DiscoverSeller } from "@/lib/discover";
import { buildBlogSlug, formatBlogDate } from "@/lib/blog";
import type { Listing } from "@/lib/listings";
import ListingCard from "@/components/marketplace/ListingCard";
import SellerBadges from "@/components/seller/SellerBadges";
import Stars from "@/components/marketplace/Stars";
import { useScrollLock } from "@/lib/useScrollLock";
import ChatLoadingState from "@/components/shared/ChatLoadingState";

function BlogCard({ post }: { post: DiscoverBlog }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="disc-blog-card"
      onClick={() => router.push(`/blog/${buildBlogSlug(post.title, post.id)}`)}
    >
      <div className="disc-blog-media">
        {post.coverImage ? (
          <img src={post.coverImage} alt={post.title} loading="lazy" />
        ) : (
          <div className="disc-blog-media-empty" />
        )}
      </div>
      <div className="disc-blog-body">
        <h3 className="disc-blog-title">{post.title}</h3>
        {post.description ? <p className="disc-blog-desc">{post.description}</p> : null}
        {post.createdAt ? (
          <time className="disc-blog-date">{formatBlogDate(new Date(post.createdAt).toISOString())}</time>
        ) : null}
      </div>
    </button>
  );
}

function SellerCard({ seller }: { seller: DiscoverSeller }) {
  const router = useRouter();
  const initial = (seller.username || "U").charAt(0).toUpperCase();
  return (
    <button
      type="button"
      className="disc-seller-card"
      onClick={() => router.push(`/seller/${encodeURIComponent(seller.username || seller.uid)}`)}
    >
      <div className="disc-seller-av">
        {seller.profilePic ? (
          <img
            src={seller.profilePic}
            alt={seller.username}
            onError={(e) => {
              const el = e.currentTarget;
              el.style.display = "none";
              if (el.parentElement) el.parentElement.textContent = initial;
            }}
          />
        ) : (
          initial
        )}
      </div>
      <div className="disc-seller-name">
        <span className="disc-seller-name-text">{seller.username}</span>
        <SellerBadges seller={{ plan: seller.plan }} />
      </div>
      <div className="disc-seller-stars">
        <Stars rating={seller.rating || 0} count={seller.ratingCount || 0} />
      </div>
    </button>
  );
}

export default function DiscoverPanel({
  onOpen,
  onOpenSeller,
  open,
  onOpenChange,
}: {
  onOpen: (listing: Listing) => void;
  onOpenSeller: (ownerId: string | undefined, listing: Listing) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "active" | "error">("idle");
  const [blogs, setBlogs] = useState<DiscoverBlog[]>([]);
  const [listings, setListings] = useState<DiscoverListing[]>([]);
  const [sellers, setSellers] = useState<DiscoverSeller[]>([]);
  const loadedOnce = useRef(false);
  const router = useRouter();

  function goTo(path: string) {
    onOpenChange(false);
    router.push(path);
  }

  useEffect(() => {
    setMounted(true);
  }, []);

  async function load(freshSeed: boolean) {
    setStatus("loading");
    try {
      const res = await fetchDiscover(freshSeed ? null : undefined);
      setBlogs(res.blogs);
      setListings(res.listings);
      setSellers(res.sellers);
      setStatus("active");
    } catch (err) {
      console.error("[Discover] failed", err);
      setStatus("error");
    }
  }

  // Loads once per session the first time it's opened — reopening within
  // the same session just shows what's already loaded (matches the old
  // AiSearchPanel's _mpAiLoadedOnce behavior). Use the in-panel Shuffle
  // button for a fresh random slice on demand.
  useEffect(() => {
    if (open && !loadedOnce.current) {
      loadedOnce.current = true;
      load(false);
    }
  }, [open]);

  // Full-screen takeover: lock background scroll (via the shared
  // reference-counted hook — see lib/useScrollLock.ts; the previous
  // plain body.style.overflow toggle here could stomp another modal's
  // lock and restore scroll while that modal was still open) + close on
  // Escape, same pattern as SearchOverlay.
  useScrollLock(open);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  if (!open || !mounted) return null;

  return createPortal(
    <div id="discoverOverlay" className="active" role="dialog" aria-modal="true" aria-label="Discover">
      <div className="disc-header">
        <span className="disc-title">Discover</span>
        <div className="disc-header-actions">
          <button
            type="button"
            className="disc-shuffle-btn"
            onClick={() => load(true)}
            disabled={status === "loading"}
            aria-label="Shuffle"
          >
            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 3 21 3 21 8" />
              <line x1={4} y1={20} x2={21} y2={3} />
              <polyline points="21 16 21 21 16 21" />
              <line x1={15} y1={15} x2={21} y2={21} />
              <line x1={4} y1={4} x2={9} y2={9} />
            </svg>
          </button>
          <button type="button" className="disc-close-btn" aria-label="Close" onClick={() => onOpenChange(false)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6}>
              <line x1={18} y1={6} x2={6} y2={18} />
              <line x1={6} y1={6} x2={18} y2={18} />
            </svg>
          </button>
        </div>
      </div>

      <div className="disc-scroll" data-scroll-lock-exempt>
        {status === "loading" && !blogs.length && !listings.length && !sellers.length ? (
          <ChatLoadingState label="Finding things for you…" />
        ) : status === "error" ? (
          <div className="disc-error">
            Something went wrong loading Discover.
            <button type="button" className="disc-retry-btn" onClick={() => load(true)}>
              Try again
            </button>
          </div>
        ) : (
          <>
            {blogs.length > 0 && (
              <section className="disc-section">
                <div className="disc-section-head">
                  <h2 className="disc-section-title">From the blog</h2>
                  <button type="button" className="disc-view-all" onClick={() => goTo("/blog")}>
                    View all
                  </button>
                </div>
                <div className="disc-rail">
                  {blogs.map((post) => (
                    <BlogCard key={post.id} post={post} />
                  ))}
                </div>
              </section>
            )}

            {listings.length > 0 && (
              <section className="disc-section">
                <div className="disc-section-head">
                  <h2 className="disc-section-title">Listings you might like</h2>
                  <button type="button" className="disc-view-all" onClick={() => goTo("/marketplace")}>
                    View more
                  </button>
                </div>
                <div className="disc-rail disc-rail-listings">
                  {listings.map((listing) => (
                    <div className="disc-rail-listing-item" key={listing.id}>
                      <ListingCard
                        listing={listing}
                        onOpen={onOpen}
                        onOpenSeller={onOpenSeller}
                      />
                    </div>
                  ))}
                </div>
              </section>
            )}

            {sellers.length > 0 && (
              <section className="disc-section">
                <div className="disc-section-head">
                  <h2 className="disc-section-title">Sellers to check out</h2>
                  <button type="button" className="disc-view-all" onClick={() => goTo("/sellers")}>
                    View all
                  </button>
                </div>
                <div className="disc-rail">
                  {sellers.map((seller) => (
                    <SellerCard key={seller.uid} seller={seller} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

export function DiscoverButton({ onClick }: { onClick: () => void }) {
  return (
    <button id="mpDiscoverBtn" type="button" onClick={onClick}>
      <svg className="mp-disc-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx={12} cy={12} r={9} stroke="rgba(196,181,253,0.7)" strokeWidth={1.6} />
        <path
          d="M15.5 8.5l-2 5-5 2 2-5z"
          fill="rgba(216,180,254,0.95)"
          stroke="rgba(196,181,253,0.6)"
          strokeWidth={0.5}
          strokeLinejoin="round"
        />
      </svg>
      <span>Discover</span>
    </button>
  );
}
