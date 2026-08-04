"use client";

// Ports marketplace.js's AI Search section: the sparkle mpAiSearchBtn,
// mpAiSearchPanel (mpAiSearchReply + mpAiSearchResults), mpRunAiSearch
// (POST /api/aistudio, action: 'recommendations'), and mpAppendAiResults
// (renders each returned "lite" listing as a real card, preferring the
// full listing object from the already-loaded feed when one matches by
// id — same fallback the original used via mpListings.find). No text
// input: this is a zero-input "Recommended for you" panel that runs the
// moment it's opened, exactly like the original. Typed keyword search
// stays in MarketplaceSearchBar, untouched.
import { useEffect, useRef, useState } from "react";
import { auth } from "@/lib/firebase";
import type { Listing } from "@/lib/listings";
import ListingCard from "@/components/marketplace/ListingCard";

interface LiteListing {
  id: string;
  title?: string;
  type?: Listing["type"];
  price?: number | null;
  saves?: number;
  boosted?: boolean;
}

interface RecommendationsResponse {
  reply?: string;
  listings?: LiteListing[];
}

function liteToListing(lite: LiteListing): Listing {
  return {
    id: lite.id,
    title: lite.title,
    type: lite.type || "website",
    financials: { price: lite.price ?? undefined },
    status: "active",
  };
}

export default function AiSearchPanel({
  listings,
  onOpen,
  onOpenSeller,
  open,
  onOpenChange,
}: {
  // The already-loaded feed pool (mpListings equivalent) — used to prefer
  // the full listing object over the AI response's lite one when the same
  // id is already in memory, exactly like mpAppendAiResults did.
  listings: Listing[];
  onOpen: (listing: Listing) => void;
  onOpenSeller: (ownerId: string | undefined, listing: Listing) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "active">("idle");
  const [reply, setReply] = useState("");
  const [results, setResults] = useState<LiteListing[]>([]);
  const loadedOnce = useRef(false); // mirrors _mpAiLoadedOnce — don't refetch every reopen in the same session

  async function runAiSearch() {
    setStatus("loading");
    setReply("Finding listings for you…");
    setResults([]);

    try {
      const user = auth.currentUser;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (user) {
        const token = await user.getIdToken();
        headers.Authorization = `Bearer ${token}`;
      }

      const resp = await fetch("/api/aistudio", {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "recommendations" }),
      });
      const data: RecommendationsResponse & { error?: string } = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Search failed");

      setStatus("active");
      setReply(data.reply || "");
      setResults(data.listings || []);
      loadedOnce.current = true;
    } catch (err) {
      console.error("[AI Search] failed", err);
      setStatus("active");
      setReply("Something went wrong with AI Search — please try again.");
    }
  }

  // Runs once, the first time the panel is opened in this session — mirrors
  // window.__openAiSearch's `if (!_mpAiLoadedOnce) mpRunAiSearch()`.
  useEffect(() => {
    if (open && !loadedOnce.current) {
      loadedOnce.current = true; // set synchronously so a fast double-open can't double-fire
      runAiSearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div id="mpAiSearchPanel" style={{ display: open ? "block" : "none" }}>
      <div id="mpAiSearchPanelInner">
        <span id="mpAiSearchTitle">Recommended for you</span>
        <button id="mpAiSearchClose" aria-label="Close" onClick={() => onOpenChange(false)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.8}>
            <line x1={18} y1={6} x2={6} y2={18} />
            <line x1={6} y1={6} x2={18} y2={18} />
          </svg>
        </button>
      </div>
      <div id="mpAiSearchReply" className={status === "active" ? "active" : status === "loading" ? "active is-loading" : ""}>
        {reply}
      </div>
      <div id="mpAiSearchResults">
        {results.map((lite) => {
          const full = listings.find((l) => l.id === lite.id);
          const listing = full || liteToListing(lite);
          return <ListingCard key={lite.id} listing={listing} onOpen={onOpen} onOpenSeller={onOpenSeller} />;
        })}
      </div>
    </div>
  );
}

export function AiSearchButton({ onClick }: { onClick: () => void }) {
  return (
    <button id="mpAiSearchBtn" onClick={onClick}>
      <svg className="mp-ai-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          className="mp-ai-spark mp-ai-spark-main"
          d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"
          fill="rgba(233,213,255,0.95)"
          stroke="rgba(196,181,253,0.6)"
          strokeWidth={0.5}
          strokeLinejoin="round"
        />
        <path
          className="mp-ai-spark mp-ai-spark-sm1"
          d="M18.5 14.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"
          fill="rgba(216,180,254,0.9)"
        />
        <path
          className="mp-ai-spark mp-ai-spark-sm2"
          d="M5.5 15.5l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5z"
          fill="rgba(196,181,253,0.85)"
        />
      </svg>
      <span>AI Search</span>
    </button>
  );
}
