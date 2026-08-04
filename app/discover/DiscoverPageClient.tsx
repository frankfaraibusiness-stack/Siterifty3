"use client";

// Standalone routed version of DiscoverPanel (components/marketplace/
// DiscoverPanel.tsx), for the new /discover route — see app/discover/
// page.tsx's top comment for why this needed a real URL. Reuses the
// exact same markup/classnames/data-fetch (lib/discover.ts) as the
// in-app takeover panel, so the two look identical; the only real
// differences: no createPortal/open-prop (this component *is* the page,
// always "active"), a Back button instead of a close button, and listing
// clicks navigate straight to /listing/[id] instead of opening the
// marketplace's in-page listing modal (there's no marketplace page
// underneath this route to hold that modal's state).
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchDiscover, type DiscoverBlog, type DiscoverListing, type DiscoverSeller } from "@/lib/discover";
import { buildBlogSlug, formatBlogDate } from "@/lib/blog";
import ListingCard from "@/components/marketplace/ListingCard";
import SellerBadges from "@/components/seller/SellerBadges";
import Stars from "@/components/marketplace/Stars";
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

export default function DiscoverPageClient() {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "loading" | "active" | "error">("idle");
  const [blogs, setBlogs] = useState<DiscoverBlog[]>([]);
  const [listings, setListings] = useState<DiscoverListing[]>([]);
  const [sellers, setSellers] = useState<DiscoverSeller[]>([]);
  const loadedOnce = useRef(false);

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

  useEffect(() => {
    if (!loadedOnce.current) {
      loadedOnce.current = true;
      load(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div id="discoverOverlay" className="active" style={{ position: "static", minHeight: "100dvh" }}>
      <div className="disc-header" style={{ marginTop: 92 }}>
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
          <button type="button" className="disc-close-btn" aria-label="Back" onClick={() => router.push("/marketplace")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        </div>
      </div>

      <div className="disc-scroll" style={{ position: "static", height: "auto", overflow: "visible" }}>
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
                  <button type="button" className="disc-view-all" onClick={() => router.push("/blog")}>
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
                  <button type="button" className="disc-view-all" onClick={() => router.push("/marketplace")}>
                    View more
                  </button>
                </div>
                <div className="disc-rail disc-rail-listings">
                  {listings.map((listing) => (
                    <div className="disc-rail-listing-item" key={listing.id}>
                      <ListingCard
                        listing={listing}
                        onOpen={(l) => router.push(`/listing/${l.id}`)}
                        onOpenSeller={(ownerId, l) =>
                          router.push(`/seller/${encodeURIComponent(ownerId || l.ownerId || "")}`)
                        }
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
                  <button type="button" className="disc-view-all" onClick={() => router.push("/sellers")}>
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
    </div>
  );
}
