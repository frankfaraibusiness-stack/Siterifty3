// 3D Asset listings preview via an embedded iframe (Sketchfab or any other
// platform that offers an embed) instead of uploaded screenshots — see
// AssetListingForm.tsx. Sellers explicitly choose one of two input modes:
//   - "I have a link"        → paste the bare embed URL
//   - "I have embed code"    → paste the whole <iframe ...></iframe> snippet
// Both resolve down to a single validated URL. We NEVER store or render the
// raw pasted HTML itself (dangerouslySetInnerHTML on arbitrary user HTML is
// a stored-XSS vector, and this codebase has no HTML sanitizer) — only the
// extracted src, which we then build our own fixed-attribute <iframe> around
// (see AssetIframe.tsx). Mirrored server-side in _handler.js's
// extractEmbedSrc/isValidEmbedUrl for the same reason: never trust the
// client-side check alone.

// Pulls src="..." (or src='...') out of a pasted <iframe> tag. Deliberately
// dumb regex, not a full HTML parser — we only ever use the extracted URL,
// never anything else from the snippet, so partial/malformed markup around
// the src attribute doesn't matter.
export function extractIframeSrc(snippet: string): string | null {
  const match = snippet.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
  return match ? match[1].trim() : null;
}

// Deliberately conservative: only http(s) URLs, and rejects javascript:/
// data:/vbscript: and similar schemes a regex-only src extraction could
// otherwise let through disguised as a URL.
export function isValidEmbedUrl(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// Single entry point the form calls regardless of which mode the seller
// picked — returns a validated URL ready to send to createListing, or null
// if what they provided doesn't resolve to a usable embed URL.
export function resolveEmbedUrl(mode: "link" | "code", value: string): string | null {
  const raw = mode === "code" ? extractIframeSrc(value) : value.trim();
  if (!raw || !isValidEmbedUrl(raw)) return null;
  return raw;
}
