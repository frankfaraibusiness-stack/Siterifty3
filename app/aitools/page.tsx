"use client";

// Ports the standalone "AI Tools" static HTML page (formatted__25_.html)
// into a real routed page, following this app's conventions:
//   - Auth gating via useAuth() / useAuthModal() (see app/myprofile/page.tsx),
//     not the original's own onAuthStateChanged + inline signInWithGoogle
//     wiring — the app already has a full sign-in modal for that.
//   - No page-local header: components/layout/Header.tsx is already global
//     (rendered from app/layout.tsx), so the original's brand/back-link/
//     user-avatar header markup was dropped, not re-implemented here.
//   - Site ownership verification (VerifyOwnershipCard) was REBUILT, not
//     ported as-is. The original called an external, Siterifty-unowned
//     domain (dlsvalue.site/api/verify.js) for both minting AND checking
//     tokens, and was never wired into the listing flow at all — nothing
//     stopped anyone from listing a URL they didn't own. This version:
//       - calls our own /api/listings actions (listing.verify-generate /
//         listing.verify-check — see _handler.js), so verification is
//         actually backed by our own Admin SDK check of the live page,
//         not a third party we don't control;
//       - is scoped to a specific listing the signed-in user owns (picked
//         from a dropdown of their own listings via fetchMyListings), with
//         the token bound to BOTH that listing's domain AND its listingId
//         server-side, so one verified listing's tag can't be reused to
//         wave through a second, different listing on the same domain;
//       - is optional everywhere — publishing a listing never requires
//         this; completing it only earns the green "Verified" badge shown
//         on the listing (see WebsiteListingForm.tsx and the listing
//         detail page).
//   - All six cards are now real, working tools:
//       - auto-description, scam-check, deal-message-assist had backends
//         already in app/api/aistudio/_handler.js and are wired via
//         lib/aiStudio.ts's aiStudioCall, with real loading/error states.
//       - Valuation estimate, Traffic snapshot, and Listing health check
//         are NEW here, and deliberately NOT AI — each is a fixed,
//         documented formula run entirely client-side over the signed-in
//         user's own listing data (no external analytics API, no model
//         call). See computeValuation / computeTrafficSnapshot /
//         computeHealth below for the exact math each one runs.
//
// This route fills a link that already existed and 404'd:
// components/marketplace/AiPromoCard.tsx's "Start using AI tools" CTA
// points at /aitools.

import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/AuthContext";
import SignInRequired from "@/components/auth/SignInRequired";
import { aiStudioCall, aiPlanCap } from "@/lib/aiStudio";
import { useAiLengthPicker } from "@/lib/useAiLengthPicker";
import { fetchMyListings, generateVerification, checkVerification, type Listing } from "@/lib/listings";


// ── Icons (ported inline from the original page's inline SVGs) ──
const IconVerify = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.68-.947 3.42 3.42 0 014.97 0 3.42 3.42 0 001.68.947 3.42 3.42 0 012.416 2.416 3.42 3.42 0 00.948 1.68 3.42 3.42 0 010 4.97 3.42 3.42 0 00-.948 1.68 3.42 3.42 0 01-2.416 2.416 3.42 3.42 0 00-1.68.947 3.42 3.42 0 01-4.97 0 3.42 3.42 0 00-1.68-.947 3.42 3.42 0 01-2.416-2.416 3.42 3.42 0 00-.947-1.68 3.42 3.42 0 010-4.97 3.42 3.42 0 00.947-1.68 3.42 3.42 0 012.416-2.416z" />
  </svg>
);
const IconValuation = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
  </svg>
);
const IconTraffic = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M3 3v18h18M7 14l4-4 3 3 5-6" />
  </svg>
);
const IconAutoDesc = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
  </svg>
);
const IconMessage = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
  </svg>
);
const IconScam = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
  </svg>
);
const IconHealth = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v6l4 2" />
  </svg>
);
const IconCopy = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
  </svg>
);

// ══════════════════════════════════════════════════════════════════════
// Working tool: site ownership verification — rebuilt on our own backend
// (see /api/listings' listing.verify-generate / listing.verify-check).
// Scoped to one of the signed-in user's own listings at a time, since the
// verification token is bound to a domain+listingId pair server-side —
// there's no meaningful "verify a domain" independent of which listing
// it's for.
// ══════════════════════════════════════════════════════════════════════
function VerifyOwnershipCard({ user }: { user: NonNullable<ReturnType<typeof useAuth>["user"]> }) {
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [generating, setGenerating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snippet, setSnippet] = useState<{ domain: string; token: string; snippetText: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [checkResult, setCheckResult] = useState<{ verified: boolean; domain: string } | null>(null);

  // Only listings with a verifiable domain (a website listing's own `url`,
  // or an app/game listing's platforms.webUrl) can go through this — a
  // pure Play Store/App Store/itch.io link has nowhere to put a meta tag
  // (see the store-link plausibility check on the listing form instead).
  const verifiableListings = (listings || []).filter((l) => Boolean(l.url || l.platforms?.webUrl));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const idToken = await user.getIdToken();
        const { listings: mine } = await fetchMyListings({ idToken });
        if (!cancelled) setListings(mine);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Could not load your listings.");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = verifiableListings.find((l) => l.id === selectedId) || null;

  async function generateTag() {
    if (!selected) return;
    setGenerating(true);
    setError(null);
    setCheckResult(null);
    try {
      const idToken = await user.getIdToken();
      const result = await generateVerification({ idToken, listingId: selected.id });
      setSnippet({ domain: result.domain, token: result.token, snippetText: result.snippet });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate a snippet — please try again.");
      setSnippet(null);
    } finally {
      setGenerating(false);
    }
  }

  async function runCheck() {
    if (!selected) return;
    setChecking(true);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      const result = await checkVerification({ idToken, listingId: selected.id });
      setCheckResult(result);
      if (!result.verified) {
        setError("We couldn't find the verification tag on your site yet. Make sure it's saved and live, then try again.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not check verification right now — please try again.");
    } finally {
      setChecking(false);
    }
  }

  function copySnippet() {
    if (!snippet) return;
    navigator.clipboard.writeText(snippet.snippetText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="srf-tools-verify-card">
      <div className="srf-tools-verify-head">
        <div className="srf-tools-icon-badge">{IconVerify}</div>
        <h2>Verify site ownership</h2>
      </div>
      <p className="srf-tools-verify-desc">
        Pick one of your listings, then paste the generated snippet into that domain&apos;s{" "}
        <code className="mono">&lt;head&gt;</code>. This is optional — your listing stays published either
        way — but a verified domain gets a green &quot;Verified&quot; badge buyers can see.
      </p>

      {loadError && <div className="srf-tools-error">{loadError}</div>}

      {listings !== null && verifiableListings.length === 0 && !loadError && (
        <div className="srf-tools-result-box">
          None of your listings have a website URL to verify yet. Website listings verify their own URL;
          app/game listings can verify their &quot;Web&quot; platform URL if they have one.
        </div>
      )}

      {verifiableListings.length > 0 && (
        <>
          <div className="srf-tools-url-row">
            <select
              className="srf-tools-url-input"
              value={selectedId}
              onChange={(e) => {
                setSelectedId(e.target.value);
                setSnippet(null);
                setCheckResult(null);
                setError(null);
              }}
            >
              <option value="">Select a listing…</option>
              {verifiableListings.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title || "Untitled"} {l.verified ? "✓ Verified" : ""}
                </option>
              ))}
            </select>
            <button className="srf-tools-btn-lime" disabled={!selected || generating} onClick={generateTag}>
              {generating ? "Generating…" : "Generate snippet"}
            </button>
          </div>

          {selected?.verified && (
            <div className="srf-tools-result-box">✓ This listing is already verified for {selected.verifiedDomain}.</div>
          )}

          {error && <div className="srf-tools-error">{error}</div>}

          {snippet && (
            <div className="srf-tools-result">
              <div className="srf-tools-result-label">Copy everything below into your site&apos;s &lt;head&gt;</div>
              <div className="srf-tools-code-block">
                <code>{snippet.snippetText}</code>
                <button className={`srf-tools-copy-btn${copied ? " copied" : ""}`} onClick={copySnippet}>
                  {IconCopy}
                </button>
              </div>
              <div className="srf-tools-verify-steps">
                <b>1.</b> Paste the snippet into {snippet.domain}&apos;s homepage <code className="mono">&lt;head&gt;</code>{" "}
                &nbsp;•&nbsp; <b>2.</b> Save and publish &nbsp;•&nbsp; <b>3.</b> Come back and click &quot;Check now&quot;
              </div>
              <button className="srf-tools-btn-lime" disabled={checking} onClick={runCheck} style={{ marginTop: 10 }}>
                {checking ? "Checking…" : "Check now"}
              </button>
              {checkResult?.verified && (
                <div className="srf-tools-result-box" style={{ marginTop: 10 }}>
                  ✓ Verified! {checkResult.domain} now shows the green Verified badge on this listing.
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// Wired tool: Auto-description (existing backend: action 'auto-description')
// ══════════════════════════════════════════════════════════════════════
function AutoDescriptionCard({ plan }: { plan: string }) {
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ charCount: number; cap: number } | null>(null);
  const { pick, AiLengthPickerHost } = useAiLengthPicker();

  async function handleGenerate() {
    const t = title.trim();
    if (!t) {
      setError("Enter a listing title first so the AI knows what it's describing.");
      return;
    }
    setError(null);
    const cap = aiPlanCap(plan);
    const targetLength = await pick(cap, plan);
    if (targetLength === null) return; // cancelled

    setGenerating(true);
    try {
      const result = await aiStudioCall<{ description?: string; charCount?: number; cap?: number }>(
        "auto-description",
        { title: t, targetLength, plan }
      );
      const generated = (result.description || "").trim();
      if (!generated) throw new Error("The AI returned an empty description.");
      setDescription(generated);
      setMeta({ charCount: result.charCount ?? generated.length, cap: result.cap ?? cap });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate a description right now — please try again.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <ToolCard
      icon={IconAutoDesc}
      name="Auto-description"
      desc="Turn your site's details into a clear, sellable listing description."
      live
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
    >
      <div className="srf-tools-field">
        <label htmlFor="srf-tools-autodesc-title">Listing title</label>
        <input
          id="srf-tools-autodesc-title"
          className="srf-tools-input"
          placeholder="e.g. Established SaaS tool for freelance invoicing"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <button className="srf-tools-btn-lime" disabled={generating} onClick={handleGenerate}>
        {generating && <span className="srf-tools-spinner" />}
        {generating ? "Generating…" : "Generate description"}
      </button>
      {error && <div className="srf-tools-error">{error}</div>}
      {description && (
        <>
          <div className="srf-tools-result-box">{description}</div>
          {meta && (
            <div className="srf-tools-result-meta">
              {meta.charCount} / {meta.cap} characters — your {plan} plan&apos;s cap
            </div>
          )}
        </>
      )}
      <AiLengthPickerHost />
    </ToolCard>
  );
}

// ══════════════════════════════════════════════════════════════════════
// Wired tool: Buyer message assist (existing backend: action 'deal-message-assist')
// ══════════════════════════════════════════════════════════════════════
function BuyerMessageAssistCard() {
  const [expanded, setExpanded] = useState(false);
  const [listingTitle, setListingTitle] = useState("");
  const [listingSummary, setListingSummary] = useState("");
  const [buyerQuestion, setBuyerQuestion] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleGenerate() {
    if (!listingTitle.trim()) {
      setError("Enter the listing title so the reply stays on-topic.");
      return;
    }
    setError(null);
    setGenerating(true);
    try {
      const result = await aiStudioCall<{ message?: string }>("deal-message-assist", {
        listingTitle: listingTitle.trim(),
        listingSummary: listingSummary.trim(),
        userDraft: buyerQuestion.trim(),
      });
      const generated = (result.message || "").trim();
      if (!generated) throw new Error("The AI returned an empty reply.");
      setMessage(generated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not draft a reply right now — please try again.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <ToolCard
      icon={IconMessage}
      name="Buyer message assist"
      desc="Draft clear, professional replies to buyer questions in one tap."
      live
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
    >
      <div className="srf-tools-field">
        <label htmlFor="srf-tools-bma-title">Listing title</label>
        <input
          id="srf-tools-bma-title"
          className="srf-tools-input"
          placeholder="e.g. Niche Shopify theme with 40 sales/mo"
          value={listingTitle}
          onChange={(e) => setListingTitle(e.target.value)}
        />
      </div>
      <div className="srf-tools-field">
        <label htmlFor="srf-tools-bma-summary">Listing summary (optional)</label>
        <textarea
          id="srf-tools-bma-summary"
          className="srf-tools-textarea"
          placeholder="A sentence or two about what you're selling"
          value={listingSummary}
          onChange={(e) => setListingSummary(e.target.value)}
        />
      </div>
      <div className="srf-tools-field">
        <label htmlFor="srf-tools-bma-question">Buyer&apos;s question / message</label>
        <textarea
          id="srf-tools-bma-question"
          className="srf-tools-textarea"
          placeholder="Paste what the buyer asked, or leave blank to draft an opening reply"
          value={buyerQuestion}
          onChange={(e) => setBuyerQuestion(e.target.value)}
        />
      </div>
      <button className="srf-tools-btn-lime" disabled={generating} onClick={handleGenerate}>
        {generating && <span className="srf-tools-spinner" />}
        {generating ? "Drafting…" : "Draft reply"}
      </button>
      {error && <div className="srf-tools-error">{error}</div>}
      {message && <div className="srf-tools-result-box">{message}</div>}
    </ToolCard>
  );
}

// ══════════════════════════════════════════════════════════════════════
// Working tool: Valuation estimate — pure algorithm, no AI/LLM call.
//
// Uses the same "profit multiple" logic real marketplaces (Flippa,
// Acquire, Empire Flippers) quote for quick ballpark estimates: a base
// monthly-profit multiple, adjusted up/down by category, traffic, age,
// and monetization signals actually present on the listing. Falls back
// to a revenue-based multiple when there's no profit figure, and to a
// traffic-based floor when there are no financials at all — every branch
// is a fixed, documented formula over the listing's own fields, nothing
// generated or inferred by a model.
// ══════════════════════════════════════════════════════════════════════
const CATEGORY_MULTIPLIER: Record<string, number> = {
  saas: 3.6,
  ecommerce: 2.6,
  content: 2.2,
  marketplace: 3.0,
  agency: 1.8,
  newsletter: 2.4,
  game: 2.0,
  app: 2.8,
  other: 2.2,
};

function monthsSince(createdAt: unknown): number | null {
  if (!createdAt) return null;
  let ms: number | null = null;
  if (typeof createdAt === "number") ms = createdAt;
  else if (
    typeof createdAt === "object" &&
    createdAt !== null &&
    "toMillis" in createdAt &&
    typeof (createdAt as { toMillis?: () => number }).toMillis === "function"
  ) {
    ms = (createdAt as { toMillis: () => number }).toMillis();
  } else if (
    typeof createdAt === "object" &&
    createdAt !== null &&
    "seconds" in createdAt &&
    typeof (createdAt as { seconds?: number }).seconds === "number"
  ) {
    ms = (createdAt as { seconds: number }).seconds * 1000;
  }
  if (!ms) return null;
  const months = (Date.now() - ms) / (1000 * 60 * 60 * 24 * 30.44);
  return months > 0 ? months : 0;
}

function formatMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1000)}K`;
  return `$${Math.round(n)}`;
}

interface ValuationResult {
  low: number;
  mid: number;
  high: number;
  basis: string;
  lines: { label: string; value: string }[];
}

function computeValuation(l: Listing): ValuationResult | null {
  const profit = l.financials?.profit;
  const revenue = l.financials?.revenue;
  const visits = l.traffic?.monthlyVisits;
  const category = (l.settings?.category || l.category || "other").toLowerCase();
  const catMult = CATEGORY_MULTIPLIER[category] ?? CATEGORY_MULTIPLIER.other;

  const ageMonths = monthsSince(l.createdAt);
  // Older, established listings carry a small trust premium; brand-new
  // ones (<3mo) get a small discount — capped at ±12% either way.
  let ageAdj = 1;
  if (ageMonths !== null) {
    if (ageMonths >= 24) ageAdj = 1.12;
    else if (ageMonths >= 12) ageAdj = 1.06;
    else if (ageMonths < 3) ageAdj = 0.9;
  }

  // Traffic adds a small bonus on top of a financials-based estimate —
  // it's supporting evidence of demand, not the primary driver when real
  // profit/revenue numbers exist.
  let trafficAdj = 1;
  if (visits) {
    if (visits >= 100_000) trafficAdj = 1.15;
    else if (visits >= 20_000) trafficAdj = 1.08;
    else if (visits >= 2_000) trafficAdj = 1.03;
  }

  const lines: { label: string; value: string }[] = [];

  if (profit && profit > 0) {
    const monthlyProfit = profit;
    const mid = monthlyProfit * catMult * ageAdj * trafficAdj;
    lines.push({ label: "Monthly profit", value: formatMoney(monthlyProfit) + "/mo" });
    lines.push({ label: "Category multiple", value: `${catMult.toFixed(1)}×` });
    if (ageAdj !== 1) lines.push({ label: "Age adjustment", value: `${ageAdj > 1 ? "+" : ""}${Math.round((ageAdj - 1) * 100)}%` });
    if (trafficAdj !== 1) lines.push({ label: "Traffic bonus", value: `+${Math.round((trafficAdj - 1) * 100)}%` });
    return { low: mid * 0.75, mid, high: mid * 1.3, basis: "monthly profit × category multiple", lines };
  }

  if (revenue && revenue > 0) {
    // No confirmed profit — fall back to a revenue multiple at roughly
    // half the profit multiple's weight, reflecting the extra risk of
    // unknown margins.
    const revMult = catMult * 0.45;
    const mid = revenue * revMult * ageAdj * trafficAdj;
    lines.push({ label: "Monthly revenue", value: formatMoney(revenue) + "/mo" });
    lines.push({ label: "Revenue multiple", value: `${revMult.toFixed(1)}×` });
    lines.push({ label: "Basis", value: "no confirmed profit — revenue-based" });
    return { low: mid * 0.7, mid, high: mid * 1.35, basis: "monthly revenue × discounted multiple (no profit on file)", lines };
  }

  if (visits && visits > 0) {
    // No financials at all — floor estimate purely off traffic, using a
    // conservative $ per monthly visit that scales down for content sites
    // and up for higher-intent categories (saas/marketplace/app).
    const perVisit = category === "saas" || category === "marketplace" || category === "app" ? 0.35 : 0.12;
    const mid = visits * perVisit * ageAdj;
    lines.push({ label: "Monthly visits", value: visits.toLocaleString() });
    lines.push({ label: "Value per visit", value: `$${perVisit.toFixed(2)}` });
    lines.push({ label: "Basis", value: "no financials on file — traffic-based floor" });
    return { low: mid * 0.5, mid, high: mid * 1.5, basis: "monthly traffic × category rate (no financials on file)", lines };
  }

  return null;
}

function ValuationEstimateCard({ user }: { user: NonNullable<ReturnType<typeof useAuth>["user"]> }) {
  const [expanded, setExpanded] = useState(false);
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");

  useEffect(() => {
    if (!expanded || listings !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const idToken = await user.getIdToken();
        const { listings: mine } = await fetchMyListings({ idToken });
        if (!cancelled) setListings(mine);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Could not load your listings.");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  const selected = (listings || []).find((l) => l.id === selectedId) || null;
  const result = selected ? computeValuation(selected) : null;

  return (
    <ToolCard
      icon={IconValuation}
      name="Valuation estimate"
      desc="Get an estimated price range based on profit, revenue, or traffic — calculated instantly, no AI involved."
      live
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
    >
      {loadError && <div className="srf-tools-error">{loadError}</div>}
      {listings === null && !loadError && <div className="srf-tools-empty-hint">Loading your listings…</div>}
      {listings !== null && listings.length === 0 && (
        <div className="srf-tools-empty-hint">You don&apos;t have any listings yet — create one first to get an estimate.</div>
      )}
      {listings !== null && listings.length > 0 && (
        <>
          <div className="srf-tools-field">
            <label htmlFor="srf-tools-val-select">Choose a listing</label>
            <select
              id="srf-tools-val-select"
              className="srf-tools-listing-select"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              <option value="">Select a listing…</option>
              {listings.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title || "Untitled"}
                </option>
              ))}
            </select>
          </div>

          {selected && !result && (
            <div className="srf-tools-empty-hint">
              Add a profit, revenue, or monthly traffic figure to this listing to get an estimate.
            </div>
          )}

          {result && (
            <>
              <div className="srf-tools-val-figure">
                <div className="srf-tools-val-amount">{formatMoney(result.mid)}</div>
                <div className="srf-tools-val-caption">Estimated value — based on {result.basis}</div>
              </div>
              <div className="srf-tools-val-range">
                <div className="srf-tools-val-range-track">
                  <div className="srf-tools-val-range-marker" style={{ left: "50%" }} />
                </div>
                <div className="srf-tools-val-range-labels">
                  <span>{formatMoney(result.low)} low</span>
                  <span>{formatMoney(result.high)} high</span>
                </div>
              </div>
              <div className="srf-tools-val-breakdown">
                {result.lines.map((line, i) => (
                  <div className="srf-tools-val-line" key={i}>
                    <span>{line.label}</span>
                    <b>{line.value}</b>
                  </div>
                ))}
              </div>
              <div className="srf-tools-result-meta">
                Ballpark only — a fixed formula based on your listing&apos;s own numbers, not an appraisal.
              </div>
            </>
          )}
        </>
      )}
    </ToolCard>
  );
}


function ScamGuardCard() {
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<{
    action: "blocked" | "warned" | "allowed";
    reason?: string;
    warningText?: string | null;
  } | null>(null);

  async function handleCheck() {
    if (!text.trim()) {
      setError("Paste a message to check first.");
      return;
    }
    setError(null);
    setChecking(true);
    try {
      const result = await aiStudioCall<{
        action: "blocked" | "warned" | "allowed";
        reason?: string;
        warningText?: string | null;
      }>("scam-check", { text: text.trim() });
      setVerdict(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not check this message right now — please try again.");
      setVerdict(null);
    } finally {
      setChecking(false);
    }
  }

  return (
    <ToolCard
      icon={IconScam}
      name="Scam guard"
      desc="Flags risky language in buyer messages before you get pulled into a bad deal."
      live
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
    >
      <div className="srf-tools-field">
        <label htmlFor="srf-tools-scam-text">Message to check</label>
        <textarea
          id="srf-tools-scam-text"
          className="srf-tools-textarea"
          placeholder="Paste a buyer's message here"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <button className="srf-tools-btn-lime" disabled={checking} onClick={handleCheck}>
        {checking && <span className="srf-tools-spinner" />}
        {checking ? "Checking…" : "Check message"}
      </button>
      {error && <div className="srf-tools-error">{error}</div>}
      {verdict && (
        <>
          <span className={`srf-tools-verdict ${verdict.action}`}>{verdict.action}</span>
          {verdict.warningText && <div className="srf-tools-result-box">{verdict.warningText}</div>}
          {!verdict.warningText && verdict.reason && <div className="srf-tools-result-box">{verdict.reason}</div>}
        </>
      )}
    </ToolCard>
  );
}

// ══════════════════════════════════════════════════════════════════════
// Working tool: Listing health check — pure rule-based rubric, no AI.
//
// Scores completeness/trust signals that are already known to correlate
// with buyer confidence: media, description quality, pricing clarity,
// traffic proof, ownership verification, tech/monetization detail. Each
// check is a fixed weight; nothing here is inferred or generated by a
// model — it's the same kind of checklist a marketplace's own QA team
// would run by hand.
// ══════════════════════════════════════════════════════════════════════
interface HealthCheck {
  id: string;
  title: string;
  text: string;
  status: "pass" | "warn" | "fail";
  weight: number;
}

function computeHealth(l: Listing): { score: number; checks: HealthCheck[] } {
  const checks: HealthCheck[] = [];

  // Media — first thing a buyer sees.
  const imageCount = (l.images || []).length + (l.imageCover ? 1 : 0) + (l.appIcon ? 1 : 0);
  if (imageCount >= 3) {
    checks.push({ id: "media", title: "Media", text: `${imageCount} images attached — good visual coverage.`, status: "pass", weight: 15 });
  } else if (imageCount >= 1) {
    checks.push({ id: "media", title: "Media", text: "Only 1–2 images. Add more screenshots to build buyer trust.", status: "warn", weight: 8 });
  } else {
    checks.push({ id: "media", title: "Media", text: "No images at all. Listings without visuals get far fewer offers.", status: "fail", weight: 0 });
  }

  // Description — length + presence of a tagline.
  const descLen = (l.description || "").trim().length;
  if (descLen >= 250) {
    checks.push({ id: "desc", title: "Description", text: `${descLen} characters — detailed and thorough.`, status: "pass", weight: 15 });
  } else if (descLen >= 80) {
    checks.push({ id: "desc", title: "Description", text: `${descLen} characters — a bit short. Add more detail on what makes it valuable.`, status: "warn", weight: 8 });
  } else {
    checks.push({ id: "desc", title: "Description", text: "Missing or very short description — buyers need context to make an offer.", status: "fail", weight: 0 });
  }

  if (l.tagline && l.tagline.trim().length > 0) {
    checks.push({ id: "tagline", title: "Tagline", text: "One-line pitch is set — helps your listing stand out in search.", status: "pass", weight: 5 });
  } else {
    checks.push({ id: "tagline", title: "Tagline", text: "No tagline set. A short pitch line improves click-through in listings.", status: "warn", weight: 2 });
  }

  // Pricing clarity.
  const price = l.financials?.price;
  if (price && price > 0) {
    checks.push({ id: "price", title: "Asking price", text: `Priced at ${formatMoney(price)} — clear and set.`, status: "pass", weight: 15 });
  } else {
    checks.push({ id: "price", title: "Asking price", text: "No asking price set — buyers can't gauge fit without one.", status: "fail", weight: 0 });
  }

  // Financial transparency — revenue/profit disclosed.
  const hasFinancials = Boolean(l.financials?.revenue || l.financials?.profit);
  if (hasFinancials) {
    checks.push({ id: "financials", title: "Financials", text: "Revenue/profit figures are on file — builds serious-buyer confidence.", status: "pass", weight: 15 });
  } else {
    checks.push({ id: "financials", title: "Financials", text: "No revenue or profit figures. Adding them (even $0) reduces buyer hesitation.", status: "warn", weight: 6 });
  }

  // Traffic proof.
  const visits = l.traffic?.monthlyVisits;
  const hasProof = (l.traffic?.proofUrls || []).length > 0;
  if (visits && hasProof) {
    checks.push({ id: "traffic", title: "Traffic proof", text: `${visits.toLocaleString()} monthly visits with supporting proof attached.`, status: "pass", weight: 12 });
  } else if (visits) {
    checks.push({ id: "traffic", title: "Traffic proof", text: "Traffic claimed but no proof screenshot attached — add one for credibility.", status: "warn", weight: 5 });
  } else {
    checks.push({ id: "traffic", title: "Traffic proof", text: "No traffic figures provided. Optional, but strengthens the listing.", status: "warn", weight: 4 });
  }

  // Ownership verification (feeds off the Verify ownership tool above).
  if (l.verified) {
    checks.push({ id: "verified", title: "Ownership verification", text: `Verified for ${l.verifiedDomain || "this domain"} — shows the green badge.`, status: "pass", weight: 13 });
  } else if (l.url || l.platforms?.webUrl) {
    checks.push({ id: "verified", title: "Ownership verification", text: "Not verified yet. Use the Verify ownership tool above to earn the badge.", status: "warn", weight: 5 });
  } else {
    checks.push({ id: "verified", title: "Ownership verification", text: "No verifiable domain on this listing.", status: "warn", weight: 5 });
  }

  // Tech/monetization detail (website listings mainly, but harmless elsewhere).
  const hasTech = Boolean(l.tech?.frontend || l.tech?.backend || l.tech?.monetization);
  if (hasTech) {
    checks.push({ id: "tech", title: "Tech & monetization", text: "Stack and/or monetization details provided.", status: "pass", weight: 10 });
  } else {
    checks.push({ id: "tech", title: "Tech & monetization", text: "No tech stack or monetization model listed.", status: "warn", weight: 4 });
  }

  const earned = checks.reduce((sum, c) => sum + c.weight, 0);
  const score = Math.round((earned / totalPossible(checks)) * 100);

  return { score: Math.max(0, Math.min(100, score)), checks };
}

// Each check's max possible weight (i.e. its "pass" weight) — used as the
// denominator so the score is always out of a consistent 100, regardless
// of which branch each check landed in.
const HEALTH_MAX_WEIGHTS: Record<string, number> = {
  media: 15,
  desc: 15,
  tagline: 5,
  price: 15,
  financials: 15,
  traffic: 12,
  verified: 13,
  tech: 10,
};

function totalPossible(checks: HealthCheck[]): number {
  return checks.reduce((sum, c) => sum + (HEALTH_MAX_WEIGHTS[c.id] ?? c.weight), 0);
}

function healthColor(score: number): string {
  if (score >= 75) return "#a3e635";
  if (score >= 45) return "#fbbf24";
  return "#ff4d4d";
}

function healthVerdict(score: number): { title: string; sub: string } {
  if (score >= 85) return { title: "Excellent — buyer-ready", sub: "This listing hits nearly every trust signal buyers look for." };
  if (score >= 65) return { title: "Good, with room to improve", sub: "Solid listing. Fixing the warnings below will raise buyer confidence further." };
  if (score >= 40) return { title: "Needs work", sub: "Several important details are missing — buyers may hesitate to make offers." };
  return { title: "Incomplete", sub: "This listing is missing most of what buyers look for before offering." };
}

const CHECK_ICON_PASS = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
);
const CHECK_ICON_WARN = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4M12 17h.01" /></svg>
);
const CHECK_ICON_FAIL = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
);

function ListingHealthCheckCard({ user }: { user: NonNullable<ReturnType<typeof useAuth>["user"]> }) {
  const [expanded, setExpanded] = useState(false);
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");

  useEffect(() => {
    if (!expanded || listings !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const idToken = await user.getIdToken();
        const { listings: mine } = await fetchMyListings({ idToken });
        if (!cancelled) setListings(mine);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Could not load your listings.");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  const selected = (listings || []).find((l) => l.id === selectedId) || null;
  const health = selected ? computeHealth(selected) : null;
  const color = health ? healthColor(health.score) : "#a3e635";
  const verdict = health ? healthVerdict(health.score) : null;

  // Ring geometry: r=34 → circumference ≈ 213.6
  const r = 34;
  const circumference = 2 * Math.PI * r;
  const dashOffset = health ? circumference - (health.score / 100) * circumference : circumference;

  return (
    <ToolCard
      icon={IconHealth}
      name="Listing health check"
      desc="A weighted completeness score covering media, pricing, financials, and verification — no AI, just a checklist."
      live
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
    >
      {loadError && <div className="srf-tools-error">{loadError}</div>}
      {listings === null && !loadError && <div className="srf-tools-empty-hint">Loading your listings…</div>}
      {listings !== null && listings.length === 0 && (
        <div className="srf-tools-empty-hint">You don&apos;t have any listings yet — create one first to run a health check.</div>
      )}
      {listings !== null && listings.length > 0 && (
        <>
          <div className="srf-tools-field">
            <label htmlFor="srf-tools-health-select">Choose a listing</label>
            <select
              id="srf-tools-health-select"
              className="srf-tools-listing-select"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              <option value="">Select a listing…</option>
              {listings.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title || "Untitled"}
                </option>
              ))}
            </select>
          </div>

          {health && verdict && (
            <>
              <div className="srf-tools-health-top">
                <div className="srf-tools-health-ring">
                  <svg viewBox="0 0 84 84">
                    <circle className="srf-tools-health-ring-bg" cx="42" cy="42" r={r} />
                    <circle
                      className="srf-tools-health-ring-fill"
                      cx="42"
                      cy="42"
                      r={r}
                      stroke={color}
                      strokeDasharray={circumference}
                      strokeDashoffset={dashOffset}
                    />
                  </svg>
                  <div className="srf-tools-health-ring-score">{health.score}</div>
                </div>
                <div>
                  <div className="srf-tools-health-verdict-text">{verdict.title}</div>
                  <div className="srf-tools-health-verdict-sub">{verdict.sub}</div>
                </div>
              </div>

              <div className="srf-tools-health-checklist">
                {health.checks.map((c) => (
                  <div className={`srf-tools-health-row ${c.status}`} key={c.id}>
                    <span className="srf-tools-health-row-icon">
                      {c.status === "pass" ? CHECK_ICON_PASS : c.status === "warn" ? CHECK_ICON_WARN : CHECK_ICON_FAIL}
                    </span>
                    <div className="srf-tools-health-row-body">
                      <div className="srf-tools-health-row-title">{c.title}</div>
                      <div className="srf-tools-health-row-text">{c.text}</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </ToolCard>
  );
}


// ══════════════════════════════════════════════════════════════════════
// Working tool: Traffic snapshot — pure algorithm, no AI/LLM call.
//
// This app has no analytics API (GA4/Search Console/etc) behind it, so
// this can't pull real traffic — it works with what a listing actually
// has: a claimed monthlyVisits figure and optional proof screenshots.
// Rather than fake a "growth chart" from nothing, it does the one honest
// thing possible with that data: turn the raw number into a normalized
// snapshot (daily/yearly derived figures, a percentile against fixed
// category benchmark bands) and a credibility read based on whether the
// claim is backed by proof. All bands/weights below are fixed constants,
// not generated per-request.
// ══════════════════════════════════════════════════════════════════════

// Rough monthly-visit bands per category, used only to place a claimed
// number on a relative scale (small / growing / established / large) —
// not a prediction, just a fixed yardstick so "40,000 visits" means
// something in context instead of floating alone.
const TRAFFIC_BANDS: Record<string, number[]> = {
  // [small→growing, growing→established, established→large]
  saas: [1_000, 15_000, 100_000],
  ecommerce: [2_000, 25_000, 150_000],
  content: [5_000, 50_000, 300_000],
  marketplace: [1_500, 20_000, 120_000],
  agency: [500, 5_000, 30_000],
  newsletter: [1_000, 10_000, 80_000],
  game: [2_000, 30_000, 200_000],
  app: [1_000, 20_000, 150_000],
  other: [1_500, 15_000, 100_000],
};

function trafficTier(visits: number, bands: number[]): { label: string; percentile: number } {
  const [b1, b2, b3] = bands;
  if (visits < b1) {
    return { label: "Small", percentile: Math.round((visits / b1) * 25) };
  }
  if (visits < b2) {
    return { label: "Growing", percentile: 25 + Math.round(((visits - b1) / (b2 - b1)) * 35) };
  }
  if (visits < b3) {
    return { label: "Established", percentile: 60 + Math.round(((visits - b2) / (b3 - b2)) * 30) };
  }
  return { label: "Large", percentile: Math.min(99, 90 + Math.round(((visits - b3) / b3) * 9)) };
}

interface TrafficResult {
  visits: number;
  daily: number;
  yearly: number;
  tier: string;
  percentile: number;
  categoryLabel: string;
  hasProof: boolean;
  proofCount: number;
  credibility: "verified" | "claimed" | "unproven";
}

const CATEGORY_LABELS: Record<string, string> = {
  saas: "SaaS",
  ecommerce: "E-commerce",
  content: "Content site",
  marketplace: "Marketplace",
  agency: "Agency",
  newsletter: "Newsletter",
  game: "Game",
  app: "App",
  other: "General",
};

function computeTrafficSnapshot(l: Listing): TrafficResult | null {
  const visits = l.traffic?.monthlyVisits;
  if (!visits || visits <= 0) return null;

  const category = (l.settings?.category || l.category || "other").toLowerCase();
  const bands = TRAFFIC_BANDS[category] ?? TRAFFIC_BANDS.other;
  const { label, percentile } = trafficTier(visits, bands);
  const proofCount = (l.traffic?.proofUrls || []).length;

  return {
    visits,
    daily: Math.round(visits / 30.44),
    yearly: Math.round(visits * 12),
    tier: label,
    percentile: Math.max(1, Math.min(99, percentile)),
    categoryLabel: CATEGORY_LABELS[category] ?? CATEGORY_LABELS.other,
    hasProof: proofCount > 0,
    proofCount,
    credibility: proofCount >= 2 ? "verified" : proofCount === 1 ? "claimed" : "unproven",
  };
}

function credibilityMeta(c: TrafficResult["credibility"]): { label: string; hint: string; cls: "pass" | "warn" | "fail" } {
  if (c === "verified") {
    return { label: "Verified", hint: "Backed by 2+ proof screenshots — the strongest credibility level.", cls: "pass" };
  }
  if (c === "claimed") {
    return { label: "Claimed", hint: "One proof screenshot attached. Add a second (e.g. Search Console + host panel) for full credibility.", cls: "warn" };
  }
  return { label: "Unproven", hint: "No proof attached. Buyers heavily discount unverified traffic claims — add a screenshot.", cls: "fail" };
}

function TrafficSnapshotCard({ user }: { user: NonNullable<ReturnType<typeof useAuth>["user"]> }) {
  const [expanded, setExpanded] = useState(false);
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");

  useEffect(() => {
    if (!expanded || listings !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const idToken = await user.getIdToken();
        const { listings: mine } = await fetchMyListings({ idToken });
        if (!cancelled) setListings(mine);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Could not load your listings.");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  const selected = (listings || []).find((l) => l.id === selectedId) || null;
  const snap = selected ? computeTrafficSnapshot(selected) : null;
  const cred = snap ? credibilityMeta(snap.credibility) : null;

  return (
    <ToolCard
      icon={IconTraffic}
      name="Traffic snapshot"
      desc="Turns your claimed monthly visits into a category-relative snapshot and credibility read — no AI involved."
      live
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
    >
      {loadError && <div className="srf-tools-error">{loadError}</div>}
      {listings === null && !loadError && <div className="srf-tools-empty-hint">Loading your listings…</div>}
      {listings !== null && listings.length === 0 && (
        <div className="srf-tools-empty-hint">You don&apos;t have any listings yet — create one first to run a snapshot.</div>
      )}
      {listings !== null && listings.length > 0 && (
        <>
          <div className="srf-tools-field">
            <label htmlFor="srf-tools-traffic-select">Choose a listing</label>
            <select
              id="srf-tools-traffic-select"
              className="srf-tools-listing-select"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              <option value="">Select a listing…</option>
              {listings.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title || "Untitled"}
                </option>
              ))}
            </select>
          </div>

          {selected && !snap && (
            <div className="srf-tools-empty-hint">
              Add a monthly visits figure to this listing&apos;s Traffic section to get a snapshot.
            </div>
          )}

          {snap && cred && (
            <>
              <div className="srf-tools-val-figure">
                <div className="srf-tools-val-amount">{snap.visits.toLocaleString()}</div>
                <div className="srf-tools-val-caption">Monthly visits — {snap.tier} for a {snap.categoryLabel} listing</div>
              </div>

              <div className="srf-tools-val-range">
                <div className="srf-tools-val-range-track">
                  <div className="srf-tools-val-range-marker" style={{ left: `${snap.percentile}%` }} />
                </div>
                <div className="srf-tools-val-range-labels">
                  <span>Small</span>
                  <span>Large</span>
                </div>
              </div>

              <div className="srf-tools-val-breakdown">
                <div className="srf-tools-val-line">
                  <span>Daily average</span>
                  <b>{snap.daily.toLocaleString()}</b>
                </div>
                <div className="srf-tools-val-line">
                  <span>Yearly projected</span>
                  <b>{snap.yearly.toLocaleString()}</b>
                </div>
                <div className="srf-tools-val-line">
                  <span>Category percentile</span>
                  <b>~{snap.percentile}th</b>
                </div>
              </div>

              <span className={`srf-tools-verdict ${cred.cls === "pass" ? "allowed" : cred.cls === "warn" ? "warned" : "blocked"}`}>
                {cred.label}
              </span>
              <div className="srf-tools-result-box">{cred.hint}</div>

              <div className="srf-tools-result-meta">
                Percentile is relative to fixed benchmark bands for {snap.categoryLabel} listings, not live market data.
              </div>
            </>
          )}
        </>
      )}
    </ToolCard>
  );
}

function ToolCard({
  icon,
  name,
  desc,
  live,
  expanded,
  onToggle,
  children,
}: {
  icon: ReactNode;
  name: string;
  desc: string;
  live: boolean;
  expanded: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  return (
    <div className={`srf-tools-card${live ? " srf-tools-live" : " srf-tools-locked"}${expanded ? " srf-tools-expanded" : ""}`}>
      <div className="srf-tools-tool-icon">{icon}</div>
      <div className="srf-tools-name">{name}</div>
      <div className="srf-tools-desc">{desc}</div>
      {live ? (
        <span className="srf-tools-badge srf-tools-live-badge" onClick={onToggle} role="button" tabIndex={0}>
          {expanded ? "Close" : "Try it"}
        </span>
      ) : (
        <span className="srf-tools-badge srf-tools-soon">Coming soon</span>
      )}
      {live && expanded && <div className="srf-tools-panel">{children}</div>}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// Page
// ══════════════════════════════════════════════════════════════════════
export default function AiToolsPage() {
  const { user, profile, loading } = useAuth();

  return (
    <div className="srf-tools">
      <div className="srf-tools-bg-glow" />
      <div className="srf-tools-hero">
        <div className="srf-tools-eyebrow">
          <span className="srf-tools-dot" /> AI Tools
        </div>
        <h1 className="srf-tools-h1">
          Everything you need
          <br />
          before you <em>list it</em>.
        </h1>
        <p className="srf-tools-sub">
          Free tools for sellers — verify ownership, price it right, and get ready to sell with confidence.
        </p>
      </div>

      {loading || user === undefined ? (
        <div style={{ textAlign: "center", padding: "40px 0", color: "var(--st-text-faint, rgba(255,255,255,0.32))" }}>
          Loading…
        </div>
      ) : !user ? (
        <SignInRequired
          fullScreen={false}
          title="Sign in to use tools"
          description="You need to be signed in to generate verification snippets and use seller tools."
        />
      ) : (
        <>
          <VerifyOwnershipCard user={user} />

          <div className="srf-tools-section-head">
            <h3>More tools</h3>
            <p>Everything below is live — pick a listing and run any of them</p>
          </div>
          <div className="srf-tools-grid">
            <ValuationEstimateCard user={user} />
            <TrafficSnapshotCard user={user} />
            <AutoDescriptionCard plan={profile?.plan || "free"} />
            <BuyerMessageAssistCard />
            <ScamGuardCard />
            <ListingHealthCheckCard user={user} />
          </div>
        </>
      )}

      <div className="srf-tools-foot-note">
        Have a tool idea? <a href="/feedback">Tell us what would help you sell.</a>
      </div>
    </div>
  );
}
