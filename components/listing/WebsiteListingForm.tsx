"use client";

// Ports Js/listing-form.js (the "website" branch). Website listings are
// their own type — the old inline "It's a template" sub-flow has been
// removed; templates now get their own listing type/form (see
// TemplateListingForm.tsx) with its own tab on /sell.
//
// Field-for-field mirror of the original 3-step modal:
//   Step 1 (Basics): 4 screenshots (2 portrait 3:4, 2 landscape), URL, title,
//     description.
//   Step 2 (Tech & Settings): frontend/backend/database/monetization, category/age/structure,
//     location + reason (optional), transfer methods (checkboxes, at least 1 required)
//   Step 3 (Financials): price, monthly revenue, monthly expenses (profit auto-calculated)
//
// Draft save/restore uses localStorage exactly like the original (key:
// srf_draft_website), so closing mid-form and coming back offers to
// restore. GitHub repo attach (__srfMountRepoPicker) isn't ported yet
// elsewhere in this app, so attachedRepo is always sent as null — that
// field degrades gracefully server-side (handleCreate treats it as
// optional).

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { createListing, generateVerification, checkVerification } from "@/lib/listings";
import { aiStudioCall, aiPlanCap } from "@/lib/aiStudio";
import { useAiLengthPicker } from "@/lib/useAiLengthPicker";
import { useConfirm } from "@/lib/useConfirm";
import { useLimits } from "@/lib/useLimits";
import Select from "./shared/Select";
import TransferMethodPicker from "./shared/TransferMethodPicker";
import ProofUploader, { type ProofImage } from "./shared/ProofUploader";
import { WEBSITE_TRANSFER_METHODS } from "./shared/transferMethods";

const ACCENT = "#a3e635";
const DRAFT_KEY = "srf_draft_website";

// Fallback limits — used only until useLimits() resolves live values from
// GET /api/limits (app/api/_lib/limits.js's LIMITS.listing). Same numbers
// as that source (title 3-99 chars, desc 100-5000 chars), kept here as the
// initial/degrade-on-failure state rather than a permanent hardcode.
const FALLBACK_TITLE_MIN = 3;
const FALLBACK_TITLE_MAX = 99;
const FALLBACK_DESC_MIN = 100;
const FALLBACK_DESC_MAX = 5000;

const CATEGORY_OPTIONS = ["E-commerce", "Portfolio", "Blog", "SaaS", "Game", "Community", "Other"];
const AGE_OPTIONS = ["< 3 months", "3–5 months", "6–11 months", "1+ year", "2+ years", "3+ years", "5+ years", "10+ years"];
const STRUCTURE_OPTIONS = ["Sole Proprietorship", "LLC", "Corporation", "Partnership", "Other"];

// Tech Stack dropdown options — was free-text (users typing "Hi" as their
// frontend framework was a real thing that happened), converted to
// pick-from-list + "Other" so listings carry meaningful, comparable
// values instead of arbitrary strings. "Other" reveals a small text
// input beneath the dropdown (see TechField below) that becomes the
// actual saved value.
const FRONTEND_OPTIONS = ["React", "Next.js", "Vue", "Nuxt", "Angular", "Svelte", "HTML/CSS/JS", "WordPress", "Webflow", "Other"];
const BACKEND_OPTIONS = ["Node.js", "Express", "Django", "Flask", "Ruby on Rails", "Laravel", "PHP", "Firebase", "Supabase", "None / Static", "Other"];
const DATABASE_OPTIONS = ["PostgreSQL", "MySQL", "MongoDB", "Firestore", "Supabase", "SQLite", "Redis", "None", "Other"];
const WEBSITE_MONETIZATION_OPTIONS = ["Ads", "Subscriptions", "One-time purchases", "Affiliate", "Sponsorships", "Donations", "Not monetized", "Other"];

// Per-slot aspect ratio requirement — mirrors LFM_SLOT_RATIOS exactly.
type SlotSpec = {
  orientation: "portrait" | "landscape";
  w: number | null;
  h: number | null;
  label: string;
  role: string;
  caption: string;
  hint: string;
};

const SLOT_SPECS: SlotSpec[] = [
  { orientation: "portrait", w: 3, h: 4, label: "3:4 portrait", role: "portrait", caption: "Portrait 1 (shown on card)", hint: "3:4 ratio — e.g. 900×1200px" },
  { orientation: "portrait", w: 3, h: 4, label: "3:4 portrait", role: "portrait", caption: "Portrait 2 (gallery)", hint: "3:4 ratio — e.g. 900×1200px" },
  { orientation: "landscape", w: null, h: null, label: "landscape", role: "landscape", caption: "Landscape 1 (shown on card)", hint: "wider than tall" },
  { orientation: "landscape", w: null, h: null, label: "landscape", role: "landscape", caption: "Landscape 2 (gallery)", hint: "wider than tall" },
];
const RATIO_TOLERANCE = 0.06;

interface SlotImage {
  file: File;
  dataUrl: string;
}

interface Draft {
  step?: number;
  url?: string;
  title?: string;
  desc?: string;
  frontend?: string;
  backend?: string;
  database?: string;
  monetization?: string;
  location?: string;
  reason?: string;
  category?: string;
  age?: string;
  structure?: string;
  price?: string;
  revenue?: string;
  expenses?: string;
  transferMethods?: string[];
  monthlyVisits?: string;
  saleType?: "fixed" | "auction";
  auctionStartPrice?: string;
  auctionStartTime?: string;
  auctionEndTime?: string;
}

const IMGUR_CLIENT_ID = "891e5bb4aa94282";

async function uploadToImgur(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("image", file);
  const res = await fetch("https://api.imgur.com/3/image", {
    method: "POST",
    headers: { Authorization: "Client-ID " + IMGUR_CLIENT_ID },
    body: fd,
  });
  const json = await res.json();
  if (!json.success) throw new Error("Imgur upload failed: " + (json.data && json.data.error));
  return json.data.link;
}

export default function WebsiteListingForm({ onBack }: { onBack?: () => void } = {}) {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { limits } = useLimits();

  const TITLE_MIN = limits.listing.titleMinLength ?? FALLBACK_TITLE_MIN;
  const TITLE_MAX = limits.listing.titleMaxLength ?? FALLBACK_TITLE_MAX;
  const DESC_MIN = limits.listing.descMinLength ?? FALLBACK_DESC_MIN;
  const DESC_MAX = limits.listing.descMaxLength ?? FALLBACK_DESC_MAX;

  const [step, setStep] = useState(1);

  // See GameListingForm.tsx's changeStep for why this exists — without it
  // the newly-rendered step keeps whatever scroll position the previous
  // step was left at, instead of opening at its own top.
  function changeStep(n: number) {
    setStep(n);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  const [images, setImages] = useState<(SlotImage | null)[]>([null, null, null, null]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const targetIdxRef = useRef<number | null>(null);

  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");

  // ── AI auto-description (ports lfmAutoGenBtn from ai-support-chat.js) ──
  const { pick, AiLengthPickerHost } = useAiLengthPicker();
  const { confirm, alert, ConfirmHost } = useConfirm();
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
    if (targetLength === null) return; // cancelled

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

  const [frontend, setFrontend] = useState("");
  const [backend, setBackend] = useState("");
  const [database, setDatabase] = useState("");
  const [monetization, setMonetization] = useState("");
  const [category, setCategory] = useState("");
  const [age, setAge] = useState("");
  const [structure, setStructure] = useState("");
  const [location, setLocation] = useState("");
  const [reason, setReason] = useState("");
  const [transferMethods, setTransferMethods] = useState<string[]>([]);

  const [price, setPrice] = useState("");
  const [revenue, setRevenue] = useState("");
  const [expenses, setExpenses] = useState("");
  // Fixed-price vs auction — mirrors SaleType in lib/listings.ts. Auction
  // fields only matter/validate when saleType === "auction"; "price" above
  // remains the source of truth for fixed-price listings exactly as
  // before, untouched by any of this.
  const [saleType, setSaleType] = useState<"fixed" | "auction">("fixed");
  const [auctionStartPrice, setAuctionStartPrice] = useState("");
  const [auctionStartTime, setAuctionStartTime] = useState("");
  const [auctionEndTime, setAuctionEndTime] = useState("");
  // Proof of the claimed monthly revenue — required whenever revenue > 0.
  const [revenueProof, setRevenueProof] = useState<ProofImage[]>([]);
  // Optional traffic claim + its supporting analytics screenshots —
  // screenshots become required the moment a visits number is entered.
  const [monthlyVisits, setMonthlyVisits] = useState("");
  const [trafficProof, setTrafficProof] = useState<ProofImage[]>([]);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<{ pct: number; label: string } | null>(null);
  const [submitError, setSubmitError] = useState("");
  const [success, setSuccess] = useState(false);
  // Post-publish, optional domain verification (see /aitools's
  // VerifyOwnershipCard for the standalone version of this same flow).
  // Publishing itself never depends on any of this — see handleSubmit,
  // which sets `success` and reaches this UI regardless of whether the
  // user ever verifies. Verifying only adds the green "Verified" badge.
  const [createdListingId, setCreatedListingId] = useState<string | null>(null);
  const [verifyStep, setVerifyStep] = useState<"idle" | "generating" | "ready" | "checking" | "verified">("idle");
  const [verifySnippet, setVerifySnippet] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifyCopied, setVerifyCopied] = useState(false);

  // ── Draft restore on mount ──
  useEffect(() => {
    async function restoreDraft() {
      try {
        const raw = localStorage.getItem(DRAFT_KEY);
        if (!raw) return;
        const ok = await confirm({
          theme: "info",
          title: "Restore Draft?",
          msg: "You have a saved draft for a website listing. Restore it?",
          confirmText: "Restore",
          cancelText: "Discard",
        });
        if (!ok) {
          localStorage.removeItem(DRAFT_KEY);
          return;
        }
        const d: Draft = JSON.parse(raw);
        if (d.url) setUrl(d.url);
        if (d.title) setTitle(d.title);
        if (d.desc) setDesc(d.desc);
        if (d.frontend) setFrontend(d.frontend);
        if (d.backend) setBackend(d.backend);
        if (d.database) setDatabase(d.database);
        if (d.monetization) setMonetization(d.monetization);
        if (d.location) setLocation(d.location);
        if (d.reason) setReason(d.reason);
        if (d.category) setCategory(d.category);
        if (d.age) setAge(d.age);
        if (d.structure) setStructure(d.structure);
        if (d.price) setPrice(d.price);
        if (d.revenue) setRevenue(d.revenue);
        if (d.expenses) setExpenses(d.expenses);
        if (d.transferMethods?.length) setTransferMethods(d.transferMethods);
        if (d.monthlyVisits) setMonthlyVisits(d.monthlyVisits);
        if (d.saleType) setSaleType(d.saleType);
        if (d.auctionStartPrice) setAuctionStartPrice(d.auctionStartPrice);
        if (d.auctionStartTime) setAuctionStartTime(d.auctionStartTime);
        if (d.auctionEndTime) setAuctionEndTime(d.auctionEndTime);
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
      const d: Draft = {
        step: nextStep, url, title, desc, frontend, backend, database, monetization,
        location, reason, category, age, structure, price, revenue, expenses, transferMethods, monthlyVisits,
        saleType, auctionStartPrice, auctionStartTime, auctionEndTime,
      };
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
    return [url, title, desc, frontend, backend, database, monetization, price, revenue, expenses].some(
      (v) => v.trim().length > 0
    );
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

  // ── Image slot handling ──
  function openSlotPicker(idx: number) {
    targetIdxRef.current = idx;
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  }

  function readFile(file: File, idx: number) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const spec = SLOT_SPECS[idx];
        if (spec.orientation === "landscape") {
          if (img.naturalWidth <= img.naturalHeight) {
            setErrors((e) => ({
              ...e,
              img: `That image is ${img.naturalWidth}×${img.naturalHeight}, which is portrait or square. Please upload a landscape image (wider than it is tall) for this slot.`,
            }));
            return;
          }
        } else if (spec.w != null && spec.h != null) {
          const actualRatio = img.naturalWidth / img.naturalHeight;
          const targetRatio = spec.w / spec.h;
          const diff = Math.abs(actualRatio - targetRatio) / targetRatio;
          if (diff > RATIO_TOLERANCE) {
            setErrors((e) => ({
              ...e,
              img: `That image is ${img.naturalWidth}×${img.naturalHeight}, which isn't a ${spec.label} image. Please upload an image close to a ${spec.label} ratio for this slot.`,
            }));
            return;
          }
        }
        setErrors((e) => ({ ...e, img: "" }));
        // Normalize to JPEG via canvas, same as the original
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext("2d")?.drawImage(img, 0, 0);
        canvas.toBlob(
          (blob) => {
            if (!blob) return;
            const normalized = new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" });
            setImages((prev) => {
              const next = [...prev];
              next[idx] = { file: normalized, dataUrl: ev.target?.result as string };
              return next;
            });
          },
          "image/jpeg",
          0.92
        );
      };
      img.src = ev.target?.result as string;
    };
    reader.readAsDataURL(file);
  }

  async function onFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    const idx = targetIdxRef.current;
    if (!f || idx == null) return;
    if (!f.type.startsWith("image/")) {
      await alert({ theme: "warning", title: "Invalid File", msg: "Please select an image file (PNG, JPG, or WebP)." });
      return;
    }
    readFile(f, idx);
  }

  function removeImage(idx: number) {
    setImages((prev) => {
      const next = [...prev];
      next[idx] = null;
      return next;
    });
  }

  // ── Validation ──
  function clearAllErrors() {
    setErrors({});
  }

  function validateStep1(): boolean {
    clearAllErrors();
    const filled = images.filter(Boolean);
    if (filled.length !== 4) {
      setErrors({ img: "Please upload all 4 images (2 portrait + 2 landscape) before continuing." });
      return false;
    }
    const urlVal = url.trim();
    if (!urlVal) {
      setErrors({ url: "Please enter a website URL." });
      return false;
    }
    if (!/^https?:\/\/.+/.test(urlVal)) {
      setErrors({ url: "Please enter a valid URL starting with https://." });
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

  function validateStep2(): boolean {
    clearAllErrors();
    if (!frontend.trim() || !backend.trim() || !database.trim() || !monetization.trim()) {
      setErrors({ tech: "Please fill in all tech stack fields (Frontend, Backend, Database, Monetization)." });
      return false;
    }
    if (!category || !age || !structure) {
      setErrors({ settings: "Please select Category, Site Age, and Business Structure." });
      return false;
    }
    if (transferMethods.length === 0) {
      setErrors({ transfer: "Please select at least one transfer method." });
      return false;
    }
    return true;
  }

  function goToStep(n: number) {
    if (n > step) {
      if (step === 1 && !validateStep1()) return;
      if (step === 2 && !validateStep2()) return;
    }
    changeStep(n);
    saveDraft(n);
  }

  const profit = (parseFloat(revenue) || 0) - (parseFloat(expenses) || 0);

  function toggleTransfer(value: string) {
    setTransferMethods((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  async function handleSubmit() {
    clearAllErrors();
    setSubmitError("");

    const filled = images.filter(Boolean);
    if (filled.length !== 4) {
      changeStep(1);
      setErrors({ img: "Please upload all 4 images (2 portrait + 2 landscape)." });
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
      if (!revenue.trim() || !expenses.trim()) {
        setErrors({ fin: "Please fill in Monthly Revenue and Monthly Expenses." });
        return;
      }
    } else if (!price.trim() || !revenue.trim() || !expenses.trim()) {
      setErrors({ fin: "Please fill in Price, Monthly Revenue, and Monthly Expenses." });
      return;
    }
    const revenueNum = parseFloat(revenue) || 0;
    if (revenueNum > 0 && revenueProof.length === 0) {
      setErrors({ fin: "Please upload at least one screenshot proving your claimed monthly revenue (e.g. Stripe, PayPal, or ad-network dashboard)." });
      return;
    }
    const visitsNum = parseFloat(monthlyVisits) || 0;
    if (monthlyVisits.trim() && visitsNum > 0 && trafficProof.length === 0) {
      setErrors({ fin: "Please upload at least one analytics screenshot (e.g. Google Analytics or Search Console) to support your monthly visits number." });
      return;
    }
    if (!user) {
      setSubmitError("You must be logged in to list.");
      return;
    }

    setSubmitting(true);
    try {
      setProgress({ pct: 0, label: "Uploading images to Imgur…" });
      const imgUrls: string[] = [];
      for (let i = 0; i < 4; i++) {
        const imgFile = images[i]!.file;
        const uploadedUrl = await uploadToImgur(imgFile);
        imgUrls.push(uploadedUrl);
        setProgress({ pct: Math.round(((i + 1) / 4) * 80), label: `Uploading image ${i + 1} of 4…` });
      }

      const idToken = await user.getIdToken();

      // Upload financial/traffic proof screenshots, if any — these back up
      // the numbers entered in the Financials step (see validateStep before
      // handleSubmit ever gets called: revenue > 0 requires at least one,
      // and a non-zero monthly visits figure requires at least one too).
      let revenueProofUrls: string[] = [];
      if (revenueProof.length > 0) {
        setProgress({ pct: 87, label: "Uploading revenue proof…" });
        for (const img of revenueProof) revenueProofUrls.push(await uploadToImgur(img.file));
      }
      let trafficProofUrls: string[] = [];
      if (trafficProof.length > 0) {
        setProgress({ pct: 89, label: "Uploading traffic proof…" });
        for (const img of trafficProof) trafficProofUrls.push(await uploadToImgur(img.file));
      }

      setProgress({ pct: 92, label: "Saving listing to marketplace…" });

      const { listingId } = await createListing({
        idToken,
        type: "website",
        url: url.trim(),
        title: title.trim(),
        description: desc.trim(),
        images: imgUrls,
        category,
        tech: { frontend, backend, database, monetization },
        settings: { category, age, location: location || "", structure, reason: reason || "" },
        financials: {
          price: saleType === "auction" ? parseFloat(auctionStartPrice) : parseFloat(price),
          revenue: parseFloat(revenue),
          expenses: parseFloat(expenses),
          revenueProofUrls,
        },
        saleType,
        auction: saleType === "auction"
          ? {
              startPrice: parseFloat(auctionStartPrice),
              startTime: new Date(auctionStartTime).toISOString(),
              endTime: new Date(auctionEndTime).toISOString(),
            }
          : undefined,
        traffic: monthlyVisits.trim()
          ? { monthlyVisits: parseFloat(monthlyVisits) || 0, proofUrls: trafficProofUrls }
          : undefined,
        transferMethods,
        attachedRepo: null,
      });

      setProgress({ pct: 100, label: "Published!" });
      setSuccess(true);
      setCreatedListingId(listingId);
      clearDraft();
      // No auto-redirect here on purpose — a website listing always has a
      // verifiable domain, so this is the moment to offer "Verify now" (see
      // the success block below) before the user wanders off to the
      // marketplace. They can still skip it and go straight there.
    } catch (err: any) {
      setSubmitError("Error: " + (err?.message || "Something went wrong. Please try again."));
    } finally {
      setSubmitting(false);
    }
  }

  async function startVerification() {
    if (!createdListingId) return;
    setVerifyStep("generating");
    setVerifyError(null);
    try {
      const idToken = await user!.getIdToken();
      const result = await generateVerification({ idToken, listingId: createdListingId });
      setVerifySnippet(result.snippet);
      setVerifyStep("ready");
    } catch (err: any) {
      setVerifyError(err?.message || "Could not generate a verification snippet — please try again.");
      setVerifyStep("idle");
    }
  }

  async function runVerificationCheck() {
    if (!createdListingId) return;
    setVerifyStep("checking");
    setVerifyError(null);
    try {
      const idToken = await user!.getIdToken();
      const result = await checkVerification({ idToken, listingId: createdListingId });
      if (result.verified) {
        setVerifyStep("verified");
      } else {
        setVerifyError("We couldn't find the tag on your site yet. Make sure it's saved and live, then try again.");
        setVerifyStep("ready");
      }
    } catch (err: any) {
      setVerifyError(err?.message || "Could not check verification right now — please try again.");
      setVerifyStep("ready");
    }
  }

  function copyVerifySnippet() {
    if (!verifySnippet) return;
    navigator.clipboard.writeText(verifySnippet).then(() => {
      setVerifyCopied(true);
      setTimeout(() => setVerifyCopied(false), 1500);
    });
  }

  return (
    <div style={{ marginTop: 92, background: "#000", color: "#fff", fontFamily: "'Segoe UI',system-ui,sans-serif" }}>
      <AiLengthPickerHost />
      <ConfirmHost />
      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onFileInputChange} />

      {/* Header */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          height: 52,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 20px",
          background: "rgba(0,0,0,0.9)",
          backdropFilter: "blur(18px)",
          WebkitBackdropFilter: "blur(18px)",
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
            Siterifty<span style={{ color: "rgba(163,230,53,0.55)" }}>.com</span>
          </div>
        </div>
        <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: ACCENT }}>
          Website Listing
        </span>
      </header>

      <div style={{ maxWidth: 820, margin: "0 auto", padding: "28px 16px 80px" }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 6 }}>
          List a <em style={{ fontStyle: "normal", color: "rgba(163,230,53,0.85)" }}>Website</em>
        </h1>
        <p style={{ fontSize: 14, color: "rgba(255,255,255,0.4)", marginBottom: 28 }}>
          Add screenshots, details, and set your price.
        </p>

        {/* Step tabs */}
        <div style={{ display: "flex", gap: 8, margin: "24px 0 20px", borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: 12 }}>
          {["1. Basics", "2. Tech & Settings", "3. Financials"].map((label, i) => (
            <button
              key={label}
              onClick={() => goToStep(i + 1)}
              style={{
                background: step === i + 1 ? "rgba(163,230,53,0.1)" : "none",
                color: step === i + 1 ? ACCENT : "rgba(255,255,255,0.25)",
                border: "none",
                fontSize: 13,
                fontWeight: 700,
                padding: "8px 14px",
                borderRadius: 20,
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {step === 1 && (
          <div>
            <span style={sectionLabelStyle}>
              Screenshots <span style={{ color: "#f87171" }}>*</span>
            </span>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              {SLOT_SPECS.map((spec, idx) => (
                <ImageSlot
                  key={idx}
                  image={images[idx]}
                  spec={spec}
                  landscape={spec.role === "landscape"}
                  onClick={() => openSlotPicker(idx)}
                  onRemove={() => removeImage(idx)}
                />
              ))}
            </div>
            {errors.img && <ErrorBox>{errors.img}</ErrorBox>}

            <div style={{ marginBottom: 16 }}>
              <label style={fieldLabelStyle}>
                Website URL <span style={{ color: "#f87171" }}>*</span>
              </label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com"
                style={inputStyle}
              />
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginTop: 4 }}>
                Full link to your live website.
              </div>
              {errors.url && <ErrorBox>{errors.url}</ErrorBox>}
            </div>

            <Field label="Title" required error={errors.title}>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="A short, catchy name for your site"
                style={inputStyle}
              />
              <CharCount value={title} min={TITLE_MIN} max={TITLE_MAX} />
            </Field>

            <Field label="Description" required error={errors.desc}>
              <textarea
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="Describe what it does, why it's valuable, and what's included in the sale…"
                rows={6}
                style={{ ...inputStyle, height: "auto", padding: 14, resize: "vertical" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                <button
                  type="button"
                  className="ai-autogen-btn"
                  onClick={handleAutoGenerate}
                  disabled={aiGenerating}
                >
                  <span>{aiGenerating ? "✨ Generating…" : "✨ Auto Generate"}</span>
                </button>
                <CharCount value={desc} min={DESC_MIN} max={DESC_MAX} />
              </div>
              {aiError && <ErrorBox>{aiError}</ErrorBox>}
            </Field>

            <NextButton onClick={() => goToStep(2)} />
          </div>
        )}

        {step === 2 && (
          <div>
            <span style={sectionLabelStyle}>Tech Stack</span>
            {errors.tech && <ErrorBox>{errors.tech}</ErrorBox>}
            <div className="sr-lf-row-2" style={{ marginBottom: 20 }}>
              <TechField label="Frontend" value={frontend} onChange={setFrontend} options={FRONTEND_OPTIONS} accent={ACCENT} />
              <TechField label="Backend" value={backend} onChange={setBackend} options={BACKEND_OPTIONS} accent={ACCENT} />
              <TechField label="Database" value={database} onChange={setDatabase} options={DATABASE_OPTIONS} accent={ACCENT} />
              <TechField label="Monetization" value={monetization} onChange={setMonetization} options={WEBSITE_MONETIZATION_OPTIONS} accent={ACCENT} />
            </div>

            <span style={sectionLabelStyle}>Settings</span>
            {errors.settings && <ErrorBox>{errors.settings}</ErrorBox>}
            <div className="sr-lf-row-3" style={{ marginBottom: 20 }}>
              <Field label="Category">
                <Select value={category} onChange={setCategory} options={CATEGORY_OPTIONS} accent={ACCENT} />
              </Field>
              <Field label="Site Age">
                <Select value={age} onChange={setAge} options={AGE_OPTIONS} accent={ACCENT} />
              </Field>
              <Field label="Business Structure">
                <Select value={structure} onChange={setStructure} options={STRUCTURE_OPTIONS} accent={ACCENT} />
              </Field>
            </div>

            <div className="sr-lf-row-2" style={{ marginBottom: 20 }}>
              <Field label="Location (optional)"><input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Remote / US-based" style={inputStyle} /></Field>
              <Field label="Reason for selling (optional)"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Moving on to a new project" style={inputStyle} /></Field>
            </div>

            <span style={sectionLabelStyle}>
              Delivery Method <span style={{ color: "#f87171" }}>*</span>
            </span>
            {errors.transfer && <ErrorBox>{errors.transfer}</ErrorBox>}
            <div style={{ marginBottom: 24 }}>
              <TransferMethodPicker
                methods={WEBSITE_TRANSFER_METHODS}
                selected={transferMethods}
                onToggle={toggleTransfer}
                accent={ACCENT}
              />
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <PrevButton onClick={() => changeStep(1)} />
              <NextButton onClick={() => goToStep(3)} />
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            {errors.fin && <ErrorBox>{errors.fin}</ErrorBox>}

            <div style={{ marginBottom: 18 }}>
              <span style={sectionLabelStyle}>Sale Type</span>
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
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
            </div>

            {saleType === "auction" ? (
              <div className="sr-lf-fin-card">
                <div className="sr-lf-row-3">
                  <Field label="Starting Price (USD)">
                    <div className="sr-lf-money">
                      <input
                        type="number" min="0" value={auctionStartPrice}
                        onChange={(e) => setAuctionStartPrice(e.target.value)}
                        placeholder="10" style={inputStyle}
                      />
                    </div>
                  </Field>
                  <Field label="Start Time">
                    <input
                      type="datetime-local" value={auctionStartTime}
                      onChange={(e) => setAuctionStartTime(e.target.value)}
                      style={inputStyle}
                    />
                  </Field>
                  <Field label="End Time">
                    <input
                      type="datetime-local" value={auctionEndTime}
                      onChange={(e) => setAuctionEndTime(e.target.value)}
                      style={inputStyle}
                    />
                  </Field>
                </div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", marginTop: 2 }}>
                  Buyers must bid at least 10% above the current highest bid (or the starting price for the first bid). Auctions run 1 hour–30 days. Once a bid comes in, the price and dates below lock in.
                </div>
              </div>
            ) : null}

            <div className="sr-lf-fin-card" style={{ marginTop: saleType === "auction" ? 16 : 0 }}>
              <div className="sr-lf-row-3">
                {saleType === "fixed" && (
                  <Field label="Asking Price (USD)">
                    <div className="sr-lf-money">
                      <input type="number" min="0" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="5000" style={inputStyle} />
                    </div>
                  </Field>
                )}
                <Field label="Monthly Revenue (USD)">
                  <div className="sr-lf-money">
                    <input type="number" min="0" value={revenue} onChange={(e) => setRevenue(e.target.value)} placeholder="500" style={inputStyle} />
                  </div>
                </Field>
                <Field label="Monthly Expenses (USD)">
                  <div className="sr-lf-money">
                    <input type="number" min="0" value={expenses} onChange={(e) => setExpenses(e.target.value)} placeholder="50" style={inputStyle} />
                  </div>
                </Field>
              </div>

              <div style={{ padding: 14, background: "rgba(255,255,255,0.03)", borderRadius: 10, marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", fontWeight: 600 }}>Monthly Profit (USD)</span>
                <span style={{ fontSize: 20, fontWeight: 800, color: profit >= 0 ? ACCENT : "#f87171" }}>
                  {profit >= 0 ? "+" : ""}${profit.toFixed(2)}
                </span>
              </div>
            </div>

            {(parseFloat(revenue) || 0) > 0 && (
              <div className="sr-lf-proof-card">
                <span style={sectionLabelStyle}>
                  Proof of Revenue <span style={{ color: "#f87171" }}>*</span>
                </span>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 10 }}>
                  Upload a screenshot of your Stripe, PayPal, ad network, or bank dashboard showing this revenue. Listings without proof can't be published — buyers trust verified numbers.
                </div>
                <ProofUploader
                  images={revenueProof}
                  onAdd={(img) => setRevenueProof((prev) => [...prev, img])}
                  onRemove={(i) => setRevenueProof((prev) => prev.filter((_, idx) => idx !== i))}
                  max={3}
                  accent={ACCENT}
                />
              </div>
            )}

            <div style={{ marginBottom: 24 }}>
              <span style={sectionLabelStyle}>Traffic (optional)</span>
              <Field label="Monthly Visits">
                <input
                  type="number"
                  min="0"
                  value={monthlyVisits}
                  onChange={(e) => setMonthlyVisits(e.target.value)}
                  placeholder="e.g. 12000"
                  style={inputStyle}
                />
              </Field>
              {(parseFloat(monthlyVisits) || 0) > 0 && (
                <div className="sr-lf-proof-card">
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 10 }}>
                    Since you entered a visits number, upload 1–3 analytics screenshots (Google Analytics, Search Console, or your host's dashboard) to back it up. <span style={{ color: "#f87171" }}>Required.</span>
                  </div>
                  <ProofUploader
                    images={trafficProof}
                    onAdd={(img) => setTrafficProof((prev) => [...prev, img])}
                    onRemove={(i) => setTrafficProof((prev) => prev.filter((_, idx) => idx !== i))}
                    max={3}
                    accent={ACCENT}
                  />
                </div>
              )}
            </div>

            {submitError && <ErrorBox>{submitError}</ErrorBox>}

            {progress && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ height: 8, background: "rgba(255,255,255,0.08)", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${progress.pct}%`, background: ACCENT, transition: "width 0.3s" }} />
                </div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginTop: 6 }}>{progress.label} ({progress.pct}%)</div>
              </div>
            )}

            {success && (
              <div style={{ padding: 16, background: "rgba(163,230,53,0.1)", border: "1px solid rgba(163,230,53,0.3)", borderRadius: 10, marginBottom: 16 }}>
                <div style={{ color: ACCENT, fontWeight: 700, textAlign: "center", marginBottom: 12 }}>
                  ✓ Published!
                </div>

                {verifyStep === "idle" && (
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", marginBottom: 10 }}>
                      Want the green &quot;Verified&quot; badge? Prove you own this domain — takes about a minute. Totally optional.
                    </div>
                    <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                      <button onClick={startVerification} style={{ ...nextBtnStyle, width: "auto", padding: "10px 20px" }}>
                        Verify now
                      </button>
                      <button onClick={() => router.push("/marketplace")} style={{ ...nextBtnStyle, width: "auto", padding: "10px 20px", background: "transparent", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.7)" }}>
                        Skip, go to marketplace
                      </button>
                    </div>
                  </div>
                )}

                {verifyStep === "generating" && (
                  <div style={{ textAlign: "center", fontSize: 13, color: "rgba(255,255,255,0.6)" }}>Generating snippet…</div>
                )}

                {(verifyStep === "ready" || verifyStep === "checking") && verifySnippet && (
                  <div>
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", marginBottom: 8 }}>
                      Paste this into your site&apos;s <code>&lt;head&gt;</code>, save, then check:
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#0d0d0d", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "10px 12px" }}>
                      <code style={{ fontSize: 11, color: "rgba(255,255,255,0.8)", wordBreak: "break-all", flex: 1 }}>{verifySnippet}</code>
                      <button onClick={copyVerifySnippet} style={{ flexShrink: 0, background: "transparent", border: "none", color: ACCENT, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                        {verifyCopied ? "Copied!" : "Copy"}
                      </button>
                    </div>
                    <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 12 }}>
                      <button onClick={runVerificationCheck} disabled={verifyStep === "checking"} style={{ ...nextBtnStyle, width: "auto", padding: "10px 20px", opacity: verifyStep === "checking" ? 0.6 : 1 }}>
                        {verifyStep === "checking" ? "Checking…" : "Check now"}
                      </button>
                      <button onClick={() => router.push("/marketplace")} style={{ ...nextBtnStyle, width: "auto", padding: "10px 20px", background: "transparent", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.7)" }}>
                        I&apos;ll do this later
                      </button>
                    </div>
                  </div>
                )}

                {verifyStep === "verified" && (
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 13, color: ACCENT, fontWeight: 700, marginBottom: 10 }}>✓ Domain verified!</div>
                    <button onClick={() => router.push("/marketplace")} style={{ ...nextBtnStyle, width: "auto", padding: "10px 20px" }}>
                      Go to marketplace
                    </button>
                  </div>
                )}

                {verifyError && (
                  <div style={{ marginTop: 10, fontSize: 12, color: "#f87171", textAlign: "center" }}>{verifyError}</div>
                )}
              </div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <PrevButton onClick={() => changeStep(2)} disabled={submitting} />
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

// ── Shared subcomponents ──

function ImageSlot({
  image,
  spec,
  landscape,
  onClick,
  onRemove,
}: {
  image: SlotImage | null;
  spec: { caption: string; hint: string };
  landscape: boolean;
  onClick: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      onClick={image ? undefined : onClick}
      style={{
        gridColumn: landscape ? "1/-1" : undefined,
        height: landscape ? 140 : 180,
        background: "rgba(255,255,255,0.03)",
        border: `2px dashed ${image ? "transparent" : "rgba(255,255,255,0.15)"}`,
        borderRadius: 14,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        cursor: image ? "default" : "pointer",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {image ? (
        <>
          <img src={image.dataUrl} alt={spec.caption} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            style={{
              position: "absolute",
              top: 6,
              right: 6,
              width: 24,
              height: 24,
              borderRadius: "50%",
              background: "rgba(0,0,0,0.7)",
              color: "#fff",
              border: "none",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            ✕
          </button>
        </>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, color: "rgba(255,255,255,0.25)", fontSize: 11, fontWeight: 500, textAlign: "center", padding: 8 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} style={{ width: 22, height: 22, opacity: 0.5 }}>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
          <span>
            {spec.caption}
            <br />
            <span style={{ fontSize: 10, opacity: 0.6 }}>{spec.hint}</span>
          </span>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
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

// Tech Stack field — dropdown of common presets + "Other", instead of a
// bare free-text input (which let people type anything, including
// nonsense — see the "Hi" / "Hu" reports). `value` is the actual saved
// string: if it matches one of `options` exactly the dropdown shows that
// selection; otherwise (a prior custom entry, or nothing yet) it falls
// back to "Other" and reveals the text input pre-filled with the
// existing value. Selecting "Other" from the list clears to an empty
// custom field so the user isn't left with a stale preset string.
function TechField({
  label,
  value,
  onChange,
  options,
  placeholder,
  accent,
  optional,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  accent: string;
  optional?: boolean;
}) {
  // Tracks whether the user has explicitly picked "Other" this session —
  // can't be derived from `value` alone, since choosing "Other" clears
  // value to "" (a fresh custom field), and "" would otherwise fall back
  // to showing the placeholder instead of staying on "Other" + the text
  // input. Also flips true automatically if `value` is a non-empty string
  // that isn't one of the presets (e.g. an existing draft/listing loaded
  // with a legacy free-text tech value).
  const isKnownPreset = options.includes(value);
  const [forcedOther, setForcedOther] = useState(value !== "" && !isKnownPreset);
  const showOther = forcedOther || (value !== "" && !isKnownPreset);
  const selectValue = showOther ? "Other" : value;
  return (
    <Field label={optional ? `${label} (optional)` : label}>
      <Select
        value={selectValue}
        onChange={(v) => {
          if (v === "Other") {
            setForcedOther(true);
            onChange("");
          } else {
            setForcedOther(false);
            onChange(v);
          }
        }}
        options={options}
        placeholder={placeholder || "Select"}
        accent={accent}
      />
      {showOther && (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Type your own…"
          style={{ ...inputStyle, marginTop: 8 }}
          autoFocus
        />
      )}
    </Field>
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
    <div
      style={{
        marginTop: 8,
        padding: "10px 14px",
        background: "rgba(239,68,68,0.1)",
        border: "1px solid rgba(239,68,68,0.25)",
        borderRadius: 8,
        color: "#fca5a5",
        fontSize: 13,
        fontWeight: 600,
      }}
    >
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
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "rgba(255,255,255,0.7)",
  padding: "7px 14px",
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  gap: 6,
};
const typeBtnStyle: React.CSSProperties = {
  flex: 1,
  padding: "12px 10px",
  border: "none",
  background: "transparent",
  borderRadius: 10,
  fontSize: 15,
  fontWeight: 700,
  color: "rgba(255,255,255,0.3)",
  cursor: "pointer",
};
const sectionLabelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "rgba(255,255,255,0.5)",
  marginBottom: 10,
};
const fieldLabelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 700,
  color: "rgba(255,255,255,0.5)",
  marginBottom: 6,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 44,
  padding: "0 14px",
  background: "#09090b",
  border: "1px solid rgba(255,255,255,0.28)",
  borderRadius: 8,
  fontSize: 14,
  color: "#fff",
  outline: "none",
  fontFamily: "inherit",
  boxSizing: "border-box",
};
const nextBtnStyle: React.CSSProperties = {
  flex: 1,
  width: "100%",
  height: 48,
  background: ACCENT,
  color: "#09090b",
  border: "none",
  borderRadius: 10,
  fontSize: 14,
  fontWeight: 800,
  cursor: "pointer",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};
const prevBtnStyle: React.CSSProperties = {
  height: 48,
  padding: "0 24px",
  background: "rgba(255,255,255,0.06)",
  color: "rgba(255,255,255,0.7)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 10,
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
};

