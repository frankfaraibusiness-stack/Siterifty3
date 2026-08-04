"use client";

import { useState } from "react";
import { useLimits } from "@/lib/useLimits";

// Ports mpOpenModal's descHtml + the read-more click handler. WORD_LIMIT
// now comes from useLimits() (GET /api/limits, LIMITS.listing.descPreviewWords)
// — FALLBACK_WORD_LIMIT is used only until that resolves, same 50-word value
// the original itself falls back to when window.__limits hasn't loaded yet.
const FALLBACK_WORD_LIMIT = 50;

export default function DescriptionBlock({ description }: { description?: string }) {
  const { limits } = useLimits();
  const WORD_LIMIT = limits.listing.descPreviewWords ?? FALLBACK_WORD_LIMIT;

  const desc = description || "No description provided.";
  const [expanded, setExpanded] = useState(false);

  const words = desc.trim().split(/\s+/);
  const needsReadMore = words.length > WORD_LIMIT;
  const short = needsReadMore ? words.slice(0, WORD_LIMIT).join(" ") + "…" : desc;

  if (!needsReadMore) {
    return <p className="modal-desc">{desc}</p>;
  }

  return (
    <>
      <p className="modal-desc">{expanded ? desc : short}</p>
      <button className="mp-read-more-btn" onClick={() => setExpanded((e) => !e)}>
        {expanded ? "Show less" : "Read more"}
      </button>
    </>
  );
}
