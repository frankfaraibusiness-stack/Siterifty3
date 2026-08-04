"use client";

import { useSellerReviews, formatReviewTime } from "@/lib/useSellerReviews";
import ReviewHelpfulVote from "@/components/listing/ReviewHelpfulVote";

// Ports the "modal-reveals-section" block from mpOpenModal's sellerHtml
// (index.html lines 1753-1762, populated by the reviews-loading block at
// ~2263-2345) — the "Seller Reveals" list of star ratings + written
// reviews other users left for this seller, shown just below the seller
// row on a listing's detail page. Renders under SellerBlock.
const StarIcon = ({ filled }: { filled: boolean }) => (
  <span className={`reveal-star${filled ? " filled" : ""}`}>
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  </span>
);

export default function SellerReveals({ sellerUid }: { sellerUid: string | undefined }) {
  const { reviews, loading, error } = useSellerReviews(sellerUid);

  return (
    <div className="modal-reveals-section" id="mpModalRevealsSection">
      <div className="modal-reveals-title-row">
        <div className="modal-reveals-title">Seller Reveals</div>
        {reviews && reviews.length > 0 ? (
          <span className="modal-reveals-count" id="mpModalRevealsCount">
            {reviews.length}
          </span>
        ) : null}
      </div>
      <div className="modal-reveals-list" id="mpModalRevealsList">
        {loading ? (
          <div className="reveals-empty">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
            Loading…
          </div>
        ) : error ? (
          <div className="reveals-empty">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
            {error.length > 60 || /https?:\/\//.test(error) ? "Could not load" : error}
          </div>
        ) : !reviews || reviews.length === 0 ? (
          <div className="reveals-empty">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            No reviews yet
          </div>
        ) : (
          reviews.map((rev) => {
            const initials = rev.reviewerName.slice(0, 2).toUpperCase();
            return (
              <div className="reveal-row" key={rev.id}>
                <div className="reveal-av">
                  {rev.reviewerPic ? (
                    <img
                      src={rev.reviewerPic}
                      alt={rev.reviewerName}
                      onError={(e) => {
                        (e.currentTarget.parentElement as HTMLElement).textContent = initials;
                      }}
                    />
                  ) : (
                    initials
                  )}
                </div>
                <div className="reveal-body">
                  <div className="reveal-meta">
                    <span className="reveal-name">{rev.reviewerName}</span>
                    <span className="reveal-time">{formatReviewTime(rev.updatedAt)}</span>
                  </div>
                  <div className="reveal-stars">
                    {Array.from({ length: 5 }, (_, i) => (
                      <StarIcon key={i} filled={i < rev.stars} />
                    ))}
                  </div>
                  {rev.review ? <div className="reveal-msg">{rev.review}</div> : null}
                  {sellerUid && (
                    <ReviewHelpfulVote
                      sellerUid={sellerUid}
                      reviewId={rev.id}
                      helpfulCount={rev.helpfulCount}
                      notHelpfulCount={rev.notHelpfulCount}
                    />
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
