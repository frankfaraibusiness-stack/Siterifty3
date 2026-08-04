"use client";

import { useRouter } from "next/navigation";

export default function BottomNav() {
  const router = useRouter();

  return (
    <nav className="fnav" id="fnav">
      <div className="fnav-pill">
        <button
          className="fnav-btn"
          id="fnavSell"
          aria-label="Sell Now"
          onClick={() => router.push("/sell")}
        >
          <svg
            className="fnav-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span className="fnav-label">Sell Now</span>
        </button>
        <button
          className="fnav-btn fnav-active"
          id="fnavMarket"
          aria-label="Marketplace"
          onClick={() => router.push("/marketplace")}
        >
          <svg
            className="fnav-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
            <path d="M3 6h18" />
            <path d="M16 10a4 4 0 01-8 0" />
          </svg>
          <span className="fnav-label">Marketplace</span>
        </button>
        <button
          className="fnav-btn"
          id="fnavSellers"
          aria-label="Sellers"
          onClick={() => router.push("/sellers")}
        >
          <svg
            className="fnav-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {/* 3 people: one left, one center (taller/front), one right */}
            <circle cx="6" cy="9" r="2.1" />
            <path d="M2.2 19c.3-2.6 1.9-4.2 3.8-4.2s3.5 1.6 3.8 4.2" />
            <circle cx="18" cy="9" r="2.1" />
            <path d="M14.2 19c.3-2.6 1.9-4.2 3.8-4.2s3.5 1.6 3.8 4.2" />
            <circle cx="12" cy="7" r="2.5" />
            <path d="M7.5 19.5c.4-3.2 2.2-5.1 4.5-5.1s4.1 1.9 4.5 5.1" />
          </svg>
          <span className="fnav-label">Sellers</span>
        </button>
      </div>
      <button
        className="fnav-search"
        id="fnavSearch"
        aria-label="Search"
        onClick={() => router.push("/marketplace?search=1")}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </button>
    </nav>
  );
}
