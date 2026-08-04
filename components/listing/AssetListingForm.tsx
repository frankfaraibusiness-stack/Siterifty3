"use client";

// 3D Asset listings are their own type — not a flavor of Website/App/Game.
// Structurally lighter than the other forms in two specific ways the seller
// asked for directly:
//   1. No image upload step at all. A 3D asset's "preview" is a live,
//      interactive embed (Sketchfab or any other platform that offers one)
//      — sellers provide either the embed link or a pasted <iframe> snippet,
//      and we resolve it down to one validated URL (see lib/embedUrl.ts).
//      We never store/render the raw pasted HTML — only the extracted src,
//      rendered through AssetIframe.tsx with our own fixed safe attributes.
//   2. No delivery/transfer-method verification step. A 3D asset changes
//      hands as a file/link handoff after purchase, not a domain transfer
//      or account handover — there's nothing here for TransferMethodPicker
//      (built for domains/hosting/social accounts) to meaningfully offer.
//
// Category, Format, and License below are 3D-specific option sets — not
// reused from any other form — same "each type owns its own options"
// convention as Website/App/Game/Template.
//
// 2-step flow (lighter than the other forms' 3, since there's no tech
// stack / delivery step to speak of): Basics (title, description, embed
// preview) → Details & Price (category, format, license, price).
//
// Draft save/restore uses localStorage (key: srf_draft_3d), same pattern
// as every other listing form.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { createListing } from "@/lib/listings";
import { resolveEmbedUrl } from "@/lib/embedUrl";
import { aiStudioCall, aiPlanCap } from "@/lib/aiStudio";
import { useAiLengthPicker } from "@/lib/useAiLengthPicker";
import { useConfirm } from "@/lib/useConfirm";
import { useLimits } from "@/lib/useLimits";
import Select from "./shared/Select";
import AssetIframe from "./AssetIframe";

const ACCENT = "#2dd4bf"; // teal — matches the 3D Assets card on /sell (--sr-3d)
const DRAFT_KEY = "srf_draft_3d";

const FALLBACK_TITLE_MIN = 3;
const FALLBACK_TITLE_MAX = 99;
const FALLBACK_DESC_MIN = 100;
const FALLBACK_DESC_MAX = 5000;

// 3D-specific option sets — own to this form, not shared with any other
// listing type (mirrors how Website/App/Game/Template each define their own).
const CATEGORY_OPTIONS = ["Character", "Environment", "Prop / Object", "Vehicle", "Architecture", "Weapon", "Animal / Creature", "Rigged / Animated", "VFX Asset", "Other"];
const FORMAT_OPTIONS = [".fbx", ".obj", ".gltf / .glb", ".blend", ".max", ".c4d", ".usd / .usdz", ".stl", "Multiple formats", "Other"];
const LICENSE_OPTIONS = ["Personal use only", "Commercial use", "Royalty-free", "Extended / Resale rights", "Exclusive (one buyer only)", "Other"];

interface Draft {
  step?: number;
  title?: string;
  desc?: string;
  embedMode?: "link" | "code";
  embedValue?: string;
  category?: string;
  format?: string;
  license?: string;
  price?: string;
}

export default function AssetListingForm({ onBack }: { onBack?: () => void } = {}) {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { limits } = useLimits();

  const TITLE_MIN = limits.listing.titleMinLength ?? FALLBACK_TITLE_MIN;
  const TITLE_MAX = limits.listing.titleMaxLength ?? FALLBACK_TITLE_MAX;
  const DESC_MIN = limits.listing.descMinLength ?? FALLBACK_DESC_MIN;
  const DESC_MAX = limits.listing.descMaxLength ?? FALLBACK_DESC_MAX;

  const [step, setStep] = useState(1);
  function changeStep(n: number) {
    setStep(n);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");

  // ── AI auto-description ──
  const { pick, AiLengthPickerHost } = useAiLengthPicker();
  const { confirm, ConfirmHost } = useConfirm();
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  async function handleAutoGenerate() {
    const t = title.trim();
    if (!t) {
      setErrors((prev) => ({ ...prev, title: `Title must be between ${TITLE_MIN} and ${TITLE_MAX} characters (currently 0).` }));
      return;
    }
    setAiError(null);
    const plan = profile?.plan || "free";
    const cap = aiPlanCap(plan);
    const targetLength = await pick(cap, plan);
    if (targetLength === null) return;

    setAiGenerating(true);
    try {
      const result = await aiStudioCall<{ description?: string }>("auto-description", { title: t, targetLength, plan });
      const generated = (result.description || "").trim();
      if (!generated) throw new Error("The AI returned an empty description.");
      setDesc(generated);
    } catch (e) {
      setAiError(e instanceof Error ? `Couldn't generate a description: ${e.message}` : "Could not generate a description right now — please try again or write your own.");
    } finally {
      setAiGenerating(false);
    }
  }

  // ── Live preview embed — seller picks link vs pasted iframe code ──
  const [embedMode, setEmbedMode] = useState<"link" | "code">("link");
  const [embedValue, setEmbedValue] = useState("");
  const resolvedEmbed = embedValue.trim() ? resolveEmbedUrl(embedMode, embedValue) : null;

  const [category, setCategory] = useState("");
  const [format, setFormat] = useState("");
  const [license, setLicense] = useState("");
  const [price, setPrice] = useState("");
  const [saleType, setSaleType] = useState<"fixed" | "auction">("fixed");
  const [auctionStartPrice, setAuctionStartPrice] = useState("");
  const [auctionStartTime, setAuctionStartTime] = useState("");
  const [auctionEndTime, setAuctionEndTime] = useState("");

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [success, setSuccess] = useState(false);

  // ── Draft restore on mount ──
  useEffect(() => {
    async function restoreDraft() {
      try {
        const raw = localStorage.getItem(DRAFT_KEY);
        if (!raw) return;
        const ok = await confirm({
          theme: "info",
          title: "Restore Draft?",
          msg: "You have a saved draft for a 3D asset listing. Restore it?",
          confirmText: "Restore",
          cancelText: "Discard",
        });
        if (!ok) {
          localStorage.removeItem(DRAFT_KEY);
          return;
        }
        const d: Draft = JSON.parse(raw);
        if (d.title) setTitle(d.title);
        if (d.desc) setDesc(d.desc);
        if (d.embedMode) setEmbedMode(d.embedMode);
        if (d.embedValue) setEmbedValue(d.embedValue);
        if (d.category) setCategory(d.category);
        if (d.format) setFormat(d.format);
        if (d.license) setLicense(d.license);
        if (d.price) setPrice(d.price);
        if (d.step && d.step > 1) setStep(d.step);
      } catch {
        // ignore corrupt draft
      }
    }
    restoreDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function saveDraft(nextStep = step) {
    try {
      const d: Draft = { step: nextStep, title, desc, embedMode, embedValue, category, format, license, price };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    } catch {
      // ignore
    }
  }
  function clearDraft() {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      // ignore
    }
  }

  function hasAnyData() {
    return [title, desc, embedValue, category, format, license, price].some((v) => v.trim().length > 0);
  }

  async function handleBack() {
    if (hasAnyData()) {
      const save = await confirm({
        theme: "warning",
        title: "Save as Draft?",
        msg: "You have unsaved listing info. Save as a draft so you can pick up where you left off?",
        confirmText: "Save Draft",
        cancelText: "Discard & Close",
      });
      if (save) saveDraft();
      else clearDraft();
    }
    if (onBack) onBack();
    else router.push("/marketplace");
  }

  function clearAllErrors() {
    setErrors({});
  }

  function validateStep1(): boolean {
    clearAllErrors();
    if (!embedValue.trim() || !resolvedEmbed) {
      setErrors({
        embed:
          embedMode === "link"
            ? "Please provide a valid preview link (starting with https://)."
            : "Please paste a valid <iframe> embed snippet — we couldn't find a usable link in it.",
      });
      return false;
    }
    const t = title.trim();
    if (t.length < TITLE_MIN || t.length > TITLE_MAX) {
      setErrors({ title: `Title must be between ${TITLE_MIN} and ${TITLE_MAX} characters (currently ${t.length}).` });
      return false;
    }
    const d = desc.trim();
    if (d.length < DESC_MIN || d.length > DESC_MAX) {
      setErrors({ desc: `Description must be between ${DESC_MIN} and ${DESC_MAX} characters (currently ${d.length}).` });
      return false;
    }
    return true;
  }

  function goToStep(n: number) {
    if (n > step) {
      if (step === 1 && !validateStep1()) return;
    }
    changeStep(n);
    saveDraft(n);
  }

  async function handleSubmit() {
    clearAllErrors();
    setSubmitError("");

    if (!validateStep1()) {
      changeStep(1);
      return;
    }
    if (!category || !format || !license) {
      setErrors({ settings: "Please select a Category, Format, and License." });
      return;
    }
    if (saleType === "auction") {
      if (!auctionStartPrice.trim() || !auctionStartTime || !auctionEndTime) {
        setErrors({ fin: "Please fill in Starting Price, Start Time, and End Time for your auction." });
        return;
      }
      const startMs = new Date(auctionStartTime).getTime();
      const endMs = new Date(auctionEndTime).getTime();
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        setErrors({ fin: "Auction end time must be after the start time." });
        return;
      }
      if (endMs - startMs < 60 * 60 * 1000) {
        setErrors({ fin: "Auctions must run for at least 1 hour." });
        return;
      }
    } else if (!price.trim()) {
      setErrors({ fin: "Please enter a price." });
      return;
    }
    if (!user) {
      setSubmitError("You must be logged in to list.");
      return;
    }

    setSubmitting(true);
    try {
      const idToken = await user.getIdToken();

      await createListing({
        idToken,
        type: "3d",
        title: title.trim(),
        description: desc.trim(),
        category,
        settings: { category, format, license },
        embedCode: embedValue.trim(),
        financials: {
          price: saleType === "auction" ? parseFloat(auctionStartPrice) : parseFloat(price),
          revenue: 0,
          expenses: 0,
        },
        saleType,
        auction: saleType === "auction"
          ? {
              startPrice: parseFloat(auctionStartPrice),
              startTime: new Date(auctionStartTime).toISOString(),
              endTime: new Date(auctionEndTime).toISOString(),
            }
          : undefined,
        attachedRepo: null,
      });

      setSuccess(true);
      clearDraft();
    } catch (err: any) {
      setSubmitError("Error: " + (err?.message || "Something went wrong. Please try again."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ marginTop: 92, background: "#000", color: "#fff", fontFamily: "'Segoe UI',system-ui,sans-serif" }}>
      <AiLengthPickerHost />
      <ConfirmHost />

      <header
        style={{
          position: "sticky", top: 0, zIndex: 10, height: 52,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 20px", background: "rgba(0,0,0,0.9)",
          backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={handleBack} style={backBtnStyle}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
              <path d="M19 12H5M12 5l-7 7 7 7" />
            </svg>
            Back
          </button>
          <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "-0.03em" }}>
            Siterifty<span style={{ color: "rgba(45,212,191,0.55)" }}>.com</span>
          </div>
        </div>
        <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: ACCENT }}>
          3D Asset Listing
        </span>
      </header>

      <div style={{ maxWidth: 820, margin: "0 auto", padding: "28px 16px 80px" }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 6 }}>
          List a <em style={{ fontStyle: "normal", color: "rgba(45,212,191,0.85)" }}>3D Asset</em>
        </h1>
        <p style={{ fontSize: 14, color: "rgba(255,255,255,0.4)", marginBottom: 28 }}>
          A live, embedded preview instead of screenshots — buyers can orbit and inspect the real model before they buy.
        </p>

        <div style={{ display: "flex", gap: 8, margin: "24px 0 20px", borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: 12 }}>
          {["1. Basics & Preview", "2. Details & Price"].map((label, i) => (
            <button
              key={label}
              onClick={() => goToStep(i + 1)}
              style={{
                background: step === i + 1 ? "rgba(45,212,191,0.1)" : "none",
                color: step === i + 1 ? ACCENT : "rgba(255,255,255,0.25)",
                border: "none", fontSize: 13, fontWeight: 700, padding: "8px 14px", borderRadius: 20, cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {step === 1 && (
          <div>
            <span style={sectionLabelStyle}>
              Live Preview <span style={{ color: "#f87171" }}>*</span>
            </span>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginBottom: 10 }}>
              No screenshots needed — paste a link or embed code from Sketchfab or any other platform that hosts an interactive 3D viewer. We'll embed it live on your listing.
            </div>

            <div style={{ display: "flex", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: 4, marginBottom: 14, gap: 4 }}>
              <button
                onClick={() => setEmbedMode("link")}
                style={{ ...typeBtnStyle, ...(embedMode === "link" ? { background: "rgba(45,212,191,0.12)", color: ACCENT, boxShadow: "0 0 0 1px rgba(45,212,191,0.15)" } : {}) }}
              >
                I have a link
              </button>
              <button
                onClick={() => setEmbedMode("code")}
                style={{ ...typeBtnStyle, ...(embedMode === "code" ? { background: "rgba(45,212,191,0.12)", color: ACCENT, boxShadow: "0 0 0 1px rgba(45,212,191,0.15)" } : {}) }}
              >
                I have embed code
              </button>
            </div>

            {embedMode === "link" ? (
              <input
                type="url"
                value={embedValue}
                onChange={(e) => setEmbedValue(e.target.value)}
                placeholder="https://sketchfab.com/models/xxxxx/embed"
                style={inputStyle}
              />
            ) : (
              <textarea
                value={embedValue}
                onChange={(e) => setEmbedValue(e.target.value)}
                placeholder='<iframe src="https://sketchfab.com/models/xxxxx/embed" ...></iframe>'
                rows={4}
                style={{ ...inputStyle, height: "auto", padding: 14, resize: "vertical", fontFamily: "monospace", fontSize: 12.5 }}
              />
            )}
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginTop: 6 }}>
              {embedMode === "code"
                ? "Paste the whole snippet — we'll pull out just the preview link and embed it safely ourselves."
                : "Any platform works, as long as it gives you a link you can embed."}
            </div>
            {errors.embed && <ErrorBox>{errors.embed}</ErrorBox>}

            {resolvedEmbed && (
              <div style={{ marginTop: 16 }}>
                <span style={sectionLabelStyle}>Preview</span>
                <div style={{ aspectRatio: "16/9", background: "#08080d", borderRadius: 14, overflow: "hidden", border: "1px solid rgba(45,212,191,0.25)" }}>
                  <AssetIframe src={resolvedEmbed} title={title || "3D asset preview"} interactive />
                </div>
              </div>
            )}

            <div style={{ marginTop: 24 }}>
              <Field label="Title" required error={errors.title}>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="A short, catchy name for your 3D asset"
                  style={inputStyle}
                />
                <CharCount value={title} min={TITLE_MIN} max={TITLE_MAX} />
              </Field>

              <Field label="Description" required error={errors.desc}>
                <textarea
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  placeholder="Describe the model, its poly count/rigging if relevant, what's included in the sale…"
                  rows={6}
                  style={{ ...inputStyle, height: "auto", padding: 14, resize: "vertical" }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                  <button type="button" className="ai-autogen-btn" onClick={handleAutoGenerate} disabled={aiGenerating}>
                    <span>{aiGenerating ? "✨ Generating…" : "✨ Auto Generate"}</span>
                  </button>
                  <CharCount value={desc} min={DESC_MIN} max={DESC_MAX} />
                </div>
                {aiError && <ErrorBox>{aiError}</ErrorBox>}
              </Field>
            </div>

            <NextButton onClick={() => goToStep(2)} />
          </div>
        )}

        {step === 2 && (
          <div>
            <span style={sectionLabelStyle}>Details</span>
            {errors.settings && <ErrorBox>{errors.settings}</ErrorBox>}
            <div className="sr-lf-row-3" style={{ marginBottom: 24 }}>
              <Field label="Category">
                <Select value={category} onChange={setCategory} options={CATEGORY_OPTIONS} accent={ACCENT} />
              </Field>
              <Field label="File Format">
                <Select value={format} onChange={setFormat} options={FORMAT_OPTIONS} accent={ACCENT} />
              </Field>
              <Field label="License">
                <Select value={license} onChange={setLicense} options={LICENSE_OPTIONS} accent={ACCENT} />
              </Field>
            </div>

            <span style={sectionLabelStyle}>Sale Type</span>
            {errors.fin && <ErrorBox>{errors.fin}</ErrorBox>}
            <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
              <button
                type="button"
                onClick={() => setSaleType("fixed")}
                style={{
                  flex: 1, padding: "12px 14px", borderRadius: 10, cursor: "pointer",
                  fontSize: 13, fontWeight: 700, fontFamily: "inherit",
                  border: `1px solid ${saleType === "fixed" ? ACCENT : "rgba(255,255,255,0.1)"}`,
                  background: saleType === "fixed" ? `${ACCENT}1a` : "rgba(255,255,255,0.03)",
                  color: saleType === "fixed" ? ACCENT : "rgba(255,255,255,0.6)",
                }}
              >
                Fixed Price
              </button>
              <button
                type="button"
                onClick={() => setSaleType("auction")}
                style={{
                  flex: 1, padding: "12px 14px", borderRadius: 10, cursor: "pointer",
                  fontSize: 13, fontWeight: 700, fontFamily: "inherit",
                  border: `1px solid ${saleType === "auction" ? ACCENT : "rgba(255,255,255,0.1)"}`,
                  background: saleType === "auction" ? `${ACCENT}1a` : "rgba(255,255,255,0.03)",
                  color: saleType === "auction" ? ACCENT : "rgba(255,255,255,0.6)",
                }}
              >
                Auction
              </button>
            </div>

            {saleType === "auction" ? (
              <>
                <span style={sectionLabelStyle}>Auction Details</span>
                <Field label="Starting Price (USD)">
                  <input type="number" min="0" value={auctionStartPrice} onChange={(e) => setAuctionStartPrice(e.target.value)} placeholder="49" style={inputStyle} />
                </Field>
                <div className="sr-lf-row-2">
                  <Field label="Start Time">
                    <input type="datetime-local" value={auctionStartTime} onChange={(e) => setAuctionStartTime(e.target.value)} style={inputStyle} />
                  </Field>
                  <Field label="End Time">
                    <input type="datetime-local" value={auctionEndTime} onChange={(e) => setAuctionEndTime(e.target.value)} style={inputStyle} />
                  </Field>
                </div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", margin: "-8px 0 20px" }}>
                  Buyers must bid at least 10% above the current highest bid (or starting price for the first bid). Runs 1 hour–30 days. Best paired with an Exclusive license.
                </div>
              </>
            ) : (
              <>
                <span style={sectionLabelStyle}>Price</span>
                <Field label="Asking Price (USD)">
                  <input type="number" min="0" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="49" style={inputStyle} />
                </Field>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", margin: "-8px 0 20px" }}>
                  A one-time price for the asset — no revenue/expenses to report, since this isn't a running business.
                </div>
              </>
            )}

            {submitError && <ErrorBox>{submitError}</ErrorBox>}

            {success && (
              <div style={{ padding: 16, background: "rgba(45,212,191,0.1)", border: "1px solid rgba(45,212,191,0.3)", borderRadius: 10, marginBottom: 16, textAlign: "center" }}>
                <div style={{ color: ACCENT, fontWeight: 700, marginBottom: 12 }}>✓ Published!</div>
                <button onClick={() => router.push("/marketplace")} style={{ ...nextBtnStyle, width: "auto", padding: "10px 20px" }}>
                  Go to marketplace
                </button>
              </div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <PrevButton onClick={() => changeStep(1)} disabled={submitting} />
              <button onClick={handleSubmit} disabled={submitting || success} style={{ ...nextBtnStyle, opacity: submitting || success ? 0.6 : 1 }}>
                {submitting ? "Publishing…" : "Publish Listing"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Shared subcomponents (mirrors TemplateListingForm.tsx's conventions) ──

function Field({ label, required, error, children }: { label: string; required?: boolean; error?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={fieldLabelStyle}>
        {label} {required && <span style={{ color: "#f87171" }}>*</span>}
      </label>
      {children}
      {error && <ErrorBox>{error}</ErrorBox>}
    </div>
  );
}

function CharCount({ value, min, max }: { value: string; min: number; max: number }) {
  const len = value.trim().length;
  const ok = len >= min && len <= max;
  return (
    <div style={{ fontSize: 11, color: ok ? "rgba(255,255,255,0.35)" : "#f87171", marginTop: 4 }}>
      {len} / {max} characters (min {min})
    </div>
  );
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 8, padding: "10px 14px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 8, color: "#fca5a5", fontSize: 13, fontWeight: 600 }}>
      {children}
    </div>
  );
}

function NextButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} style={nextBtnStyle}>
      Continue
    </button>
  );
}
function PrevButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} style={prevBtnStyle}>
      Back
    </button>
  );
}

// ── Styles ──
const backBtnStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.7)",
  padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
  display: "flex", alignItems: "center", gap: 6,
};
const typeBtnStyle: React.CSSProperties = {
  flex: 1, padding: "12px 10px", border: "none", background: "transparent", borderRadius: 10,
  fontSize: 15, fontWeight: 700, color: "rgba(255,255,255,0.3)", cursor: "pointer",
};
const sectionLabelStyle: React.CSSProperties = {
  display: "block", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em",
  color: "rgba(255,255,255,0.5)", marginBottom: 10,
};
const fieldLabelStyle: React.CSSProperties = {
  display: "block", fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.5)", marginBottom: 6,
  textTransform: "uppercase", letterSpacing: "0.04em",
};
const inputStyle: React.CSSProperties = {
  width: "100%", height: 44, padding: "0 14px", background: "#09090b", border: "1px solid rgba(255,255,255,0.28)",
  borderRadius: 8, fontSize: 14, color: "#fff", outline: "none", fontFamily: "inherit", boxSizing: "border-box",
};
const nextBtnStyle: React.CSSProperties = {
  flex: 1, width: "100%", height: 48, background: ACCENT, color: "#002420", border: "none", borderRadius: 10,
  fontSize: 14, fontWeight: 800, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.04em",
};
const prevBtnStyle: React.CSSProperties = {
  height: 48, padding: "0 24px", background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.7)",
  border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer",
};
