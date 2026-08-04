"use client";

import { useEffect, useState } from "react";

interface PmHeaderBanner {
  src: string;
  alt: string;
  onClick: () => void;
}

const ROTATE_MS = 5000;

// Rotating CTA banner strip shown in place of the old static "My Profile"
// header text. Full-width, 50px tall images (already sized/cropped by the
// source), one visible at a time, auto-advancing every 5s. Each banner is
// its own button wired to the CTA it actually advertises (sell vs.
// upgrade-to-starter) rather than all banners sharing one generic link.
export default function PmHeaderBannerRotator({ banners }: { banners: PmHeaderBanner[] }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (banners.length <= 1) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % banners.length);
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, [banners.length]);

  if (banners.length === 0) return null;

  return (
    <div className="pm-banner-rotator">
      {banners.map((banner, i) => (
        <button
          key={banner.src}
          type="button"
          className="pm-banner-slide"
          data-active={i === index}
          onClick={banner.onClick}
          aria-hidden={i === index ? undefined : true}
          tabIndex={i === index ? 0 : -1}
        >
          <img src={banner.src} alt={banner.alt} loading={i === 0 ? "eager" : "lazy"} />
        </button>
      ))}
    </div>
  );
}
