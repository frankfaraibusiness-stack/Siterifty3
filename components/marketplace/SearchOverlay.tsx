"use client";

// Reuses the server's match-scoring (startsWith=100 / includes=80 /
// type=60 / desc=40 — see _handler.js's _searchScore) and highlight-first-
// match logic, so results here are identical to what handleSearch returns
// — this only changes the *presentation* (full-screen takeover,
// YouTube-style recent-searches list) and *persistence* (localStorage
// history), not the matching behavior.
//
// Previously this scored the `listings` prop (whatever page of the feed
// MarketplaceGrid had already loaded into memory) synchronously in render.
// That meant a listing the infinite-scroll feed hadn't reached yet was
// invisible to search no matter how well it matched. Now it debounces the
// typed query and calls fetchSearchResults (action: 'listing.search'),
// which searches the FULL cached catalog pool server-side at zero extra
// Firestore cost (see _handler.js's handleSearch) — same shape of fix as
// handleFeed's own cached pool, just applied to search instead of browse.
// The empty-query "Recommended for you" list still uses the `listings`
// prop (a handful of already-loaded feed items is a fine source for that,
// and it needs no server round-trip at all).
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Listing } from "@/lib/listings";
import { isBoosted, fetchSearchResults } from "@/lib/listings";
import { useRecentSearches } from "@/lib/useRecentSearches";
import { useCurrency } from "@/lib/CurrencyContext";
import { useScrollLock } from "@/lib/useScrollLock";

interface Suggestion {
  listing: Listing;
  title: string;
  type: string;
  score: number;
}

function highlight(text: string, q: string) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i === -1) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

const TYPE_COLOR: Record<string, string> = {
  website: "#60a5fa",
  app: "#a78bfa",
  game: "#f59e0b",
};

// Mirrors the same per-type image precedence SiteCard/AppCard/GameCard
// already use for their thumbnails (see those components), so a search
// result shows the same picture the listing's own card would — just a
// small square crop instead of the full card image.
const PLACEHOLDER_THUMB = "https://placehold.co/120x120/0d0d14/444?text=%20";
function resultThumb(listing: Listing): string {
  const type = listing.type || "website";
  if (type === "app") {
    return listing.appIcon || listing.images?.[0] || listing.imageCover || PLACEHOLDER_THUMB;
  }
  if (type === "game") {
    return listing.images?.[2] || listing.imageCover || listing.images?.[0] || PLACEHOLDER_THUMB;
  }
  return listing.images?.[2] || listing.imageCover || listing.images?.[0] || PLACEHOLDER_THUMB;
}

// Mirrors the same Timestamp-or-number normalization isBoosted() already
// uses for boostedUntil, applied to createdAt so recency sorting works
// regardless of whether the field came back as a Firestore Timestamp or
// a plain number (server vs. any client-side mock data).
function createdAtMs(listing: Listing): number {
  const c = listing.createdAt as number | { toMillis?: () => number; seconds?: number } | undefined;
  if (!c) return 0;
  if (typeof c === "number") return c;
  if (typeof c.toMillis === "function") return c.toMillis();
  if (typeof c.seconds === "number") return c.seconds * 1000;
  return 0;
}

// Empty-state recommendations shown before the user has typed anything
// (and has no recent searches either) — boosted listings first (sellers
// paid for that placement, same priority BoostedRow gives them elsewhere),
// then the most recently listed, so the panel is never just a blank
// magnifying-glass icon with nothing to act on.
function recommended(listings: Listing[], limit: number): Listing[] {
  return [...listings]
    .filter((l) => l.status !== "sold" && l.status !== "removed")
    .sort((a, b) => {
      const boostDiff = Number(isBoosted(b)) - Number(isBoosted(a));
      if (boostDiff !== 0) return boostDiff;
      return createdAtMs(b) - createdAtMs(a);
    })
    .slice(0, limit);
}

export default function SearchOverlay({
  open,
  listings,
  initialQuery,
  onClose,
  onCancel,
  onSearchChange,
  onOpenListing,
}: {
  open: boolean;
  listings: Listing[];
  initialQuery: string;
  onClose: () => void;
  onCancel?: () => void;
  onSearchChange: (q: string) => void;
  onOpenListing: (listing: Listing) => void;
}) {
  const { formatPriceShort } = useCurrency();
  const [value, setValue] = useState(initialQuery);
  const [listening, setListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const { items: recent, add: addRecent, remove: removeRecent, clear: clearRecent } = useRecentSearches();

  // Web Speech API (SpeechRecognition) is only available in the browser
  // and only in some browsers (Chrome/Edge/Safari support it under
  // webkit-prefixed and unprefixed names; Firefox doesn't at all) — so
  // this is feature-detected on mount and the mic button simply isn't
  // rendered when it's unsupported, rather than rendering a button that
  // does nothing.
  useEffect(() => {
    const SpeechRecognitionCtor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setVoiceSupported(!!SpeechRecognitionCtor);
  }, []);

  function toggleVoiceSearch() {
    const SpeechRecognitionCtor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) return;

    if (listening) {
      recognitionRef.current?.stop();
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setValue(transcript);
    };
    recognition.onend = () => {
      setListening(false);
    };
    recognition.onerror = () => {
      setListening(false);
    };

    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }

  // Stop listening and release the recognizer if the overlay closes or
  // unmounts while a voice search is still active.
  useEffect(() => {
    if (!open && recognitionRef.current) {
      recognitionRef.current.stop();
    }
  }, [open]);
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  // Portal target: document.body isn't available during SSR, and even on
  // the client we only want to read it after mount. Without this, the
  // overlay renders in-place in the DOM tree (inside MarketplaceSearchBar's
  // .mp-search-wrap), and if any ancestor up the tree has a transform,
  // filter, backdrop-filter, or will-change set, that ancestor becomes the
  // containing block for position:fixed — which clips/shrinks the overlay
  // to that ancestor's box instead of the real viewport. That's the "search
  // overlay is cut off, not full screen" bug. Portaling straight to
  // document.body sidesteps the whole class of ancestor-stacking issues
  // instead of chasing down which ancestor is the culprit.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Autofocus the input the moment the overlay mounts, same as tapping
  // YouTube's search bar drops you straight into a focused, keyboard-up
  // input rather than a still-blurred one.
  useEffect(() => {
    if (open) {
      setValue(initialQuery);
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Lock background scroll while the overlay is up — a full-screen
  // takeover shouldn't let the marketplace grid scroll underneath it.
  // Uses the shared reference-counted hook (see lib/useScrollLock.ts);
  // the previous plain body.style.overflow toggle here could stomp
  // another modal's lock and restore scroll while that modal was still
  // open.
  useScrollLock(open);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") handleCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, value]);

  // Debounced server-side search (action: 'listing.search') — 200ms mirrors
  // a typical "search as you type" debounce and keeps rapid keystrokes
  // from firing a request per character; the server call itself costs
  // nothing extra beyond ordinary browsing (see handleSearch's cache
  // reuse), but debouncing still avoids piling up redundant in-flight
  // requests while someone is still typing.
  const [matches, setMatches] = useState<Suggestion[]>([]);
  useEffect(() => {
    const trimmed = value.trim();
    if (!trimmed) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const { listings: results } = await fetchSearchResults({ q: trimmed, limit: 20 });
        if (cancelled) return;
        setMatches(
          results.map((listing) => ({
            listing,
            title: listing.title || "Untitled",
            type: listing.type || "website",
            // Score itself isn't used for anything after the server has
            // already sorted results — kept on the Suggestion shape only
            // because `highlight()` and the render below don't need it,
            // but other callers of this type might; 0 is a harmless filler.
            score: 0,
          }))
        );
      } catch {
        // A failed search shouldn't crash the overlay — just show no
        // results, same as a genuine zero-match query.
        if (!cancelled) setMatches([]);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [value]);

  if (!open || !mounted) return null;

  const q = value.trim().toLowerCase();

  const recs: Listing[] = !q ? recommended(listings, 8) : [];

  function commitSearch(term: string) {
    const trimmed = term.trim();
    if (!trimmed) return;
    addRecent(trimmed);
    onSearchChange(trimmed.toLowerCase());
    handleClose();
  }

  function handleClose() {
    onClose();
  }

  function handleCancel() {
    onClose();
    onCancel?.();
  }

  function handleClear() {
    setValue("");
    inputRef.current?.focus();
  }

  return createPortal(
    <div id="mpSearchOverlay" className="active" role="dialog" aria-modal="true" aria-label="Search listings">
      <div className="mp-so-header">
        <button
          className="mp-so-back"
          aria-label="Close search"
          onClick={handleCancel}
        >
          <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}>
            <line x1={19} y1={12} x2={5} y2={12} />
            <polyline points="12 19 5 12 12 5" />
          </svg>
        </button>
        <div className="mp-so-input-wrap">
          <input
            ref={inputRef}
            type="text"
            id="mpSearchOverlayInput"
            placeholder="Search listings…"
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitSearch(value);
            }}
          />
          {value ? (
            <button className="mp-so-clear" aria-label="Clear" onClick={handleClear}>
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.8}>
                <line x1={18} y1={6} x2={6} y2={18} />
                <line x1={6} y1={6} x2={18} y2={18} />
              </svg>
            </button>
          ) : null}
          {voiceSupported ? (
            <button
              type="button"
              className={`mp-so-mic${listening ? " mp-so-mic-listening" : ""}`}
              aria-label={listening ? "Stop voice search" : "Search by voice"}
              aria-pressed={listening}
              onClick={toggleVoiceSearch}
            >
              <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
                <rect x={9} y={2} width={6} height={12} rx={3} />
                <path d="M5 10a7 7 0 0 0 14 0" strokeLinecap="round" />
                <line x1={12} y1={19} x2={12} y2={22} strokeLinecap="round" />
              </svg>
            </button>
          ) : null}
        </div>
      </div>

      <div className="mp-so-body" data-scroll-lock-exempt>
        {!q ? (
          <>
            {recent.length ? (
              <>
                <div className="mp-so-section-head">
                  <span>Recent searches</span>
                  <button className="mp-so-clear-all" onClick={clearRecent}>
                    Clear all
                  </button>
                </div>
                <div className="mp-so-list">
                  {recent.map((term) => (
                    <button key={term} className="mp-so-row" onClick={() => commitSearch(term)}>
                      <svg className="mp-so-row-icon" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <circle cx={12} cy={12} r={9} />
                        <polyline points="12 7 12 12 15 14" />
                      </svg>
                      <span className="mp-so-row-text">{term}</span>
                      <span
                        className="mp-so-row-remove"
                        role="button"
                        aria-label={`Remove ${term} from recent searches`}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeRecent(term);
                        }}
                      >
                        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}>
                          <line x1={18} y1={6} x2={6} y2={18} />
                          <line x1={6} y1={6} x2={18} y2={18} />
                        </svg>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            {recs.length ? (
              <>
                <div className="mp-so-section-head">
                  <span>Recommended for you</span>
                </div>
                <div className="mp-so-list">
                  {recs.map((listing) => {
                    const price = listing.financials?.price;
                    const priceStr = typeof price === "number" ? formatPriceShort(price) : "—";
                    const type = listing.type || "website";
                    const tc = TYPE_COLOR[type] || "#34d399";
                    const thumb = resultThumb(listing);
                    return (
                      <button
                        key={listing.id}
                        className="mp-so-row mp-so-result"
                        onClick={() => {
                          onOpenListing(listing);
                          handleClose();
                        }}
                      >
                        <span className="mp-so-result-thumb-wrap">
                          <img
                            className="mp-so-result-thumb"
                            src={thumb}
                            alt=""
                            loading="lazy"
                            onError={(e) => {
                              e.currentTarget.src = PLACEHOLDER_THUMB;
                            }}
                          />
                          <span className="mp-so-result-dot" style={{ background: tc }} />
                        </span>
                        <span className="mp-so-row-text">
                          <span className="mp-so-result-title">{listing.title || "Untitled"}</span>
                          <span className="mp-so-result-sub">{isBoosted(listing) ? "Boosted" : type}</span>
                        </span>
                        <span className="mp-so-result-price">{priceStr}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : null}

            {!recent.length && !recs.length ? (
              <div className="mp-so-empty">
                <svg width={40} height={40} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
                  <circle cx={11} cy={11} r={8} />
                  <line x1={21} y1={21} x2="16.65" y2="16.65" />
                </svg>
                <span>Search listings by title, type, or description</span>
              </div>
            ) : null}
          </>
        ) : matches.length ? (
          <div className="mp-so-list">
            {matches.map((m) => {
              const price = m.listing.financials?.price;
              const priceStr = typeof price === "number" ? formatPriceShort(price) : "—";
              const tc = TYPE_COLOR[m.type] || "#34d399";
              const thumb = resultThumb(m.listing);
              return (
                <button
                  key={m.listing.id}
                  className="mp-so-row mp-so-result"
                  onClick={() => {
                    addRecent(value);
                    onOpenListing(m.listing);
                    handleClose();
                  }}
                >
                  <span className="mp-so-result-thumb-wrap">
                    <img
                      className="mp-so-result-thumb"
                      src={thumb}
                      alt=""
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.src = PLACEHOLDER_THUMB;
                      }}
                    />
                    <span className="mp-so-result-dot" style={{ background: tc }} />
                  </span>
                  <span className="mp-so-row-text">
                    <span className="mp-so-result-title">{highlight(m.title, q)}</span>
                    <span className="mp-so-result-sub">{m.type}</span>
                  </span>
                  <span className="mp-so-result-price">{priceStr}</span>
                </button>
              );
            })}
            <button className="mp-so-see-all" onClick={() => commitSearch(value)}>
              See all results for &quot;{value}&quot;
            </button>
          </div>
        ) : (
          <div className="mp-so-empty">
            <svg width={40} height={40} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
              <line x1={18} y1={6} x2={6} y2={18} />
              <line x1={6} y1={6} x2={18} y2={18} />
            </svg>
            <span>No matches for &quot;{value}&quot;</span>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
