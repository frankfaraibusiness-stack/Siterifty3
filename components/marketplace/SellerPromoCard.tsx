"use client";

// Ports mpBuildSellerPromoCard from marketplace.js — promotes the
// platform itself (not a third-party ad), inserted into the feed at a
// fixed cadence (see promoCadence.ts). CTA goes through the same
// requireAuth -> /sell path used by every other "sell now" entry point
// (Hero's CTA, nav drawer, etc): signed-out visitors are prompted to
// sign in first rather than navigating straight to a route that expects
// auth.
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { useAuthModal } from "@/components/auth/AuthModalProvider";

export default function SellerPromoCard() {
  const { user } = useAuth();
  const { openAuthModal } = useAuthModal();
  const router = useRouter();

  const onClick = () => {
    if (user) router.push("/sell");
    else openAuthModal();
  };

  return (
    <div className="sr-seller-promo">
      <div className="sr-seller-promo-inner">
        <div
          className="sr-seller-promo-media"
          style={{
            backgroundImage:
              "url('https://www.image2url.com/r2/default/images/1783801925966-bc2baae0-9e6d-4a53-bf54-4227552b95e4.jpg')",
          }}
        >
          <div className="sr-seller-promo-badge">Marketplace</div>
        </div>
        <div className="sr-seller-promo-body">
          <h3 className="sr-seller-promo-title">Start selling now</h3>
          <div className="sr-seller-promo-accent" />
          <p className="sr-seller-promo-desc">
            Turn your digital creations into instant income. List your websites, apps, or games on the
            fastest-growing marketplace and connect with eager buyers worldwide. No hidden fees, no delays — just
            results.
          </p>
          <button type="button" className="sr-seller-promo-cta" onClick={onClick}>
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M12 2L13.8 8.6L20 10.4L15 15.6L16.2 22L12 18.6L7.8 22L9 15.6L4 10.4L10.2 8.6L12 2Z"
                fill="#ffffff"
                opacity={0.95}
              />
            </svg>
            Start selling now
          </button>
        </div>
      </div>
    </div>
  );
}
