"use client";

// Template listings are their own type — this used to be a toggle buried
// inside WebsiteListingForm.tsx ("It's a template"), which meant Template
// wasn't reachable as its own thing from the /sell type-picker. Split out
// here so Template is a first-class tab, and Website stays website-only.
//
// Structurally mirrors WebsiteListingForm.tsx's 3-step flow, but Basics is
// intentionally lighter for templates: no fixed portrait/landscape slots or
// aspect-ratio checks — just 1-6 screenshots of any size, since a template
// doesn't have a live site's card-image conventions to match. The
// website-specific bits are otherwise swapped for template-specific ones:
//   Step 1 (Basics): 1-6 screenshots (any orientation/size), title,
//     description, and the template files/demo-link flow (Upload Files —
//     HTML/CSS/JS, combined into one playable preview + Test Play — or an
//     External Link to a hosted demo). Both optional: templates built in
//     other tools (Figma, Canva, etc.) can skip straight to screenshots +
//     description.
//   Step 2 (Tech & Settings): frontend/backend/database/monetization
//     (template-flavored option lists), category/age/structure, transfer
//     methods (checkboxes, at least 1 required)
//   Step 3 (Financials): price, monthly revenue, monthly expenses (profit
//     auto-calculated)
//
// No domain-ownership verification step on success — that only makes sense
// for a listing with a live, verifiable URL, which templates don't have
// (url is always sent as the sentinel "[TEMPLATE]", same convention the
// server already understands via isTemplate).
//
// Draft save/restore uses localStorage (key: srf_draft_template), same
// pattern as the other listing forms.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { createListing } from "@/lib/listings";
import { aiStudioCall, aiPlanCap } from "@/lib/aiStudio";
import { useAiLengthPicker } from "@/lib/useAiLengthPicker";
import { useConfirm } from "@/lib/useConfirm";
import { useLimits } from "@/lib/useLimits";
import Select from "./shared/Select";
import TransferMethodPicker from "./shared/TransferMethodPicker";
import ProofUploader, { type ProofImage } from "./shared/ProofUploader";
import { WEBSITE_TRANSFER_METHODS } from "./shared/transferMethods";

const ACCENT = "#c084fc"; // purple — matches the Template icon on /sell, distinct from Website's lime green
const DRAFT_KEY = "srf_draft_template";

// Fallback limits — used only until useLimits() resolves live values from
// GET /api/limits. Same numbers as the website form's fallback.
const FALLBACK_TITLE_MIN = 3;
const FALLBACK_TITLE_MAX = 99;
const FALLBACK_DESC_MIN = 100;
const FALLBACK_DESC_MAX = 5000;

const CATEGORY_OPTIONS = ["Landing Page", "Dashboard/Admin", "E-commerce", "Portfolio", "Blog", "SaaS Starter", "Email/Newsletter", "UI Kit", "Other"];
const AGE_OPTIONS = ["< 3 months", "3–5 months", "6–11 months", "1+ year", "2+ years", "3+ years", "5+ years", "10+ years"];
const STRUCTURE_OPTIONS = ["Sole Proprietorship", "LLC", "Corporation", "Partnership", "Other"];

// Template-flavored tech stack options — includes design-tool entries
// (Figma, Canva) alongside code frameworks, since a "template" here can be
// either a coded build or a design file.
const FRONTEND_OPTIONS = ["React", "Next.js", "Vue", "Nuxt", "Angular", "Svelte", "HTML/CSS/JS", "WordPress", "Webflow", "Figma", "Canva", "Other"];
const BACKEND_OPTIONS = ["Node.js", "Express", "Django", "Flask", "Ruby on Rails", "Laravel", "PHP", "Firebase", "Supabase", "None / Static", "Other"];
const DATABASE_OPTIONS = ["PostgreSQL", "MySQL", "MongoDB", "Firestore", "Supabase", "SQLite", "Redis", "None", "Other"];
const TEMPLATE_MONETIZATION_OPTIONS = ["One-time purchase", "License tiers", "Subscription", "Marketplace royalties", "Not monetized yet", "Other"];

// Templates are lighter-weight than websites: no fixed portrait/landscape
// slots, no aspect-ratio enforcement — just "add a few screenshots" (1
// required, up to MAX_IMAGES), since a template's cover art / demo shots
// don't need to match a live site's card-image conventions.
const MIN_IMAGES = 1;
const MAX_IMAGES = 6;

interface SlotImage {
  file: File;
  dataUrl: string;
}

interface Draft {
  step?: number;
  tplUploadType?: "upload" | "link";
  tplLinkUrl?: string;
  title?: string;
  desc?: string;
  frontend?: string;
  backend?: string;
  database?: string;
  monetization?: string;
  category?: string;
  age?: string;
  structure?: string;
  price?: string;
  revenue?: string;
  expenses?: string;
  transferMethods?: string[];
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

// Combines uploaded html/css/js files into one playable HTML blob (CSS
// inlined in <style> before </head>, JS inlined in <script> before
// </body>) — same approach used for game-build uploads.
function combineTplFiles(files: File[]): Promise<string> {
  const htmlFile = files.find((f) => /\.html?$/i.test(f.name));
  const cssFiles = files.filter((f) => /\.css$/i.test(f.name));
  const jsFiles = files.filter((f) => /\.js$/i.test(f.name));

  const readText = (f: File) =>
    new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = (e) => resolve((e.target?.result as string) || "");
      r.readAsText(f);
    });

  return (async () => {
    let htmlContent = htmlFile
      ? await readText(htmlFile)
      : '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Template</title></head><body></body></html>';
    let cssContent = "";
    for (const f of cssFiles) cssContent += "\n/* " + f.name + " */\n" + (await readText(f));
    let jsContent = "";
    for (const f of jsFiles) jsContent += "\n// " + f.name + "\n" + (await readText(f));

    let finalHtml = htmlContent;
    if (cssContent) {
      const styleTag = "<style>" + cssContent + "</style>";
      finalHtml = finalHtml.includes("</head>") ? finalHtml.replace("</head>", styleTag + "</head>") : finalHtml.replace("<body>", "<body>" + styleTag);
    }
    if (jsContent) {
      const scriptTag = "<script>" + jsContent + "</" + "script>";
      finalHtml = finalHtml.includes("</body>") ? finalHtml.replace("</body>", scriptTag + "</body>") : finalHtml + scriptTag;
    }
    return finalHtml;
  })();
}

async function uploadTextToStorage(filename: string, content: string, idToken: string): Promise<string> {
  const res = await fetch("/api/storage", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ filename, content, encoding: "utf8" }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "File upload failed.");
  return json.url;
}

export default function TemplateListingForm({ onBack }: { onBack?: () => void } = {}) {
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
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  const [images, setImages] = useState<SlotImage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");

  // ── AI auto-description ──
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

  // ── Template file upload / demo link (optional) ──
  const [tplUploadType, setTplUploadType] = useState<"upload" | "link">("upload");
  const tplFileInputRef = useRef<HTMLInputElement>(null);
  const [tplUploadedFiles, setTplUploadedFiles] = useState<File[]>([]);
  const [tplCombinedHtml, setTplCombinedHtml] = useState<string>("");
  const [tplPreviewBlobUrl, setTplPreviewBlobUrl] = useState<string | null>(null);
  const [tplTestPlayOpen, setTplTestPlayOpen] = useState(false);
  const [tplDuplicateError, setTplDuplicateError] = useState("");
  const [tplLinkUrl, setTplLinkUrl] = useState("");

  const [frontend, setFrontend] = useState("");
  const [backend, setBackend] = useState("");
  const [database, setDatabase] = useState("");
  const [monetization, setMonetization] = useState("");
  const [category, setCategory] = useState("");
  const [age, setAge] = useState("");
  const [structure, setStructure] = useState("");
  const [transferMethods, setTransferMethods] = useState<string[]>([]);

  const [price, setPrice] = useState("");
  const [revenue, setRevenue] = useState("");
  const [expenses, setExpenses] = useState("");
  const [revenueProof, setRevenueProof] = useState<ProofImage[]>([]);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<{ pct: number; label: string } | null>(null);
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
          msg: "You have a saved draft for a template listing. Restore it?",
          confirmText: "Restore",
          cancelText: "Discard",
        });
        if (!ok) {
          localStorage.removeItem(DRAFT_KEY);
          return;
        }
        const d: Draft = JSON.parse(raw);
        if (d.tplUploadType) setTplUploadType(d.tplUploadType);
        if (d.tplLinkUrl) setTplLinkUrl(d.tplLinkUrl);
        if (d.title) setTitle(d.title);
        if (d.desc) setDesc(d.desc);
        if (d.frontend) setFrontend(d.frontend);
        if (d.backend) setBackend(d.backend);
        if (d.database) setDatabase(d.database);
        if (d.monetization) setMonetization(d.monetization);
        if (d.category) setCategory(d.category);
        if (d.age) setAge(d.age);
        if (d.structure) setStructure(d.structure);
        if (d.price) setPrice(d.price);
        if (d.revenue) setRevenue(d.revenue);
        if (d.expenses) setExpenses(d.expenses);
        if (d.transferMethods?.length) setTransferMethods(d.transferMethods);
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
        step: nextStep, tplUploadType, tplLinkUrl, title, desc, frontend, backend, database, monetization,
        category, age, structure, price, revenue, expenses, transferMethods,
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
    return (
      [title, desc, frontend, backend, database, monetization, price, revenue, expenses].some(
        (v) => v.trim().length > 0
      ) || tplUploadedFiles.length > 0
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
    if (tplPreviewBlobUrl) URL.revokeObjectURL(tplPreviewBlobUrl);
    if (onBack) onBack();
    else router.push("/marketplace");
  }

  // ── Image handling — simple add-a-few-screenshots flow, no fixed
  // portrait/landscape slots or aspect-ratio checks (unlike the website
  // form's card-image requirements, which don't apply to a template gallery) ──
  function openSlotPicker() {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  }

  function readFile(file: File) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        setErrors((e) => ({ ...e, img: "" }));
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext("2d")?.drawImage(img, 0, 0);
        canvas.toBlob(
          (blob) => {
            if (!blob) return;
            const normalized = new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" });
            setImages((prev) => [...prev, { file: normalized, dataUrl: ev.target?.result as string }]);
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
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      await alert({ theme: "warning", title: "Invalid File", msg: "Please select an image file (PNG, JPG, or WebP)." });
      return;
    }
    if (images.length >= MAX_IMAGES) {
      await alert({ theme: "warning", title: "Too Many Images", msg: `You can upload up to ${MAX_IMAGES} screenshots.` });
      return;
    }
    readFile(f);
  }

  function removeImage(idx: number) {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  }

  // ── Template file upload — filters to html/css/js, allows only one HTML
  // file, dedupes names, then combines + previews. ──
  async function handleTplFiles(fileList: FileList) {
    setTplDuplicateError("");
    const allowed = [".html", ".htm", ".css", ".js"];
    let valid = Array.from(fileList).filter((f) => allowed.includes("." + f.name.split(".").pop()!.toLowerCase()));
    if (valid.length === 0) {
      setErrors((e) => ({ ...e, tplUpload: "Please upload HTML, CSS, or JS files." }));
      return;
    }
    const htmlFiles = valid.filter((f) => /\.html?$/i.test(f.name));
    if (htmlFiles.length > 1) {
      setTplDuplicateError("Only one HTML file allowed.");
      valid = valid.filter((f) => !/\.html?$/i.test(f.name) || f === htmlFiles[0]);
    }
    const names = valid.map((f) => f.name);
    if (new Set(names).size !== names.length) {
      setTplDuplicateError("Duplicate file names detected.");
      const seen = new Set<string>();
      valid = valid.filter((f) => {
        if (seen.has(f.name)) return false;
        seen.add(f.name);
        return true;
      });
    }
    if (valid.length === 0) return;
    setErrors((e) => ({ ...e, tplUpload: "" }));
    setTplUploadedFiles(valid);
    const finalHtml = await combineTplFiles(valid);
    setTplCombinedHtml(finalHtml);
    if (tplPreviewBlobUrl) URL.revokeObjectURL(tplPreviewBlobUrl);
    const blob = new Blob([finalHtml], { type: "text/html" });
    setTplPreviewBlobUrl(URL.createObjectURL(blob));
  }

  function removeTplFiles() {
    setTplUploadedFiles([]);
    setTplCombinedHtml("");
    setTplDuplicateError("");
    if (tplPreviewBlobUrl) {
      URL.revokeObjectURL(tplPreviewBlobUrl);
      setTplPreviewBlobUrl(null);
    }
  }

  // ── Validation ──
  function clearAllErrors() {
    setErrors({});
  }

  function validateStep1(): boolean {
    clearAllErrors();
    if (images.length < MIN_IMAGES) {
      setErrors({ img: `Please upload at least ${MIN_IMAGES} screenshot before continuing.` });
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
    if (!frontend.trim() || !monetization.trim()) {
      setErrors({ tech: "Please fill in at least Frontend/Tool and Monetization." });
      return false;
    }
    if (!category) {
      setErrors({ settings: "Please select a Category." });
      return false;
    }
    if (transferMethods.length === 0) {
      setErrors({ transfer: "Please select at least one delivery method." });
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

    if (images.length < MIN_IMAGES) {
      changeStep(1);
      setErrors({ img: `Please upload at least ${MIN_IMAGES} screenshot.` });
      return;
    }
    if (!price.trim() || !revenue.trim() || !expenses.trim()) {
      setErrors({ fin: "Please fill in Price, Monthly Revenue, and Monthly Expenses." });
      return;
    }
    const revenueNum = parseFloat(revenue) || 0;
    if (revenueNum > 0 && revenueProof.length === 0) {
      setErrors({ fin: "Please upload at least one screenshot proving your claimed monthly revenue (e.g. Gumroad, Stripe, or marketplace payout dashboard)." });
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
      for (let i = 0; i < images.length; i++) {
        const imgFile = images[i].file;
        const uploadedUrl = await uploadToImgur(imgFile);
        imgUrls.push(uploadedUrl);
        setProgress({ pct: Math.round(((i + 1) / images.length) * 75), label: `Uploading image ${i + 1} of ${images.length}…` });
      }

      const idToken = await user.getIdToken();

      // Optional: upload the template's HTML/CSS/JS build (if provided) so
      // the listing has a real, hosted, playable preview. Skipped entirely
      // for non-code templates (Figma/Canva/etc) that only use screenshots
      // + description.
      let tplBuildUrl: string | null = null;
      let tplDemoUrl: string | null = null;
      if (tplUploadType === "upload" && tplCombinedHtml) {
        setProgress({ pct: 80, label: "Uploading template build…" });
        tplBuildUrl = await uploadTextToStorage("template.html", tplCombinedHtml, idToken);
      } else if (tplUploadType === "link" && tplLinkUrl.trim()) {
        tplDemoUrl = tplLinkUrl.trim();
      }

      let revenueProofUrls: string[] = [];
      if (revenueProof.length > 0) {
        setProgress({ pct: 88, label: "Uploading revenue proof…" });
        for (const img of revenueProof) revenueProofUrls.push(await uploadToImgur(img.file));
      }

      setProgress({ pct: 92, label: "Saving listing to marketplace…" });

      await createListing({
        idToken,
        type: "website",
        isTemplate: true,
        url: "[TEMPLATE]",
        tplBuildUrl,
        tplDemoUrl,
        title: title.trim(),
        description: desc.trim(),
        images: imgUrls,
        category,
        tech: { frontend, backend, database, monetization },
        settings: { category, age, structure },
        financials: {
          price: parseFloat(price),
          revenue: parseFloat(revenue),
          expenses: parseFloat(expenses),
          revenueProofUrls,
        },
        transferMethods,
        attachedRepo: null,
      });

      setProgress({ pct: 100, label: "Published!" });
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
            Siterifty<span style={{ color: "rgba(192,132,252,0.55)" }}>.com</span>
          </div>
        </div>
        <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: ACCENT }}>
          Template Listing
        </span>
      </header>

      <div style={{ maxWidth: 820, margin: "0 auto", padding: "28px 16px 80px" }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 6 }}>
          List a <em style={{ fontStyle: "normal", color: "rgba(192,132,252,0.85)" }}>Template</em>
        </h1>
        <p style={{ fontSize: 14, color: "rgba(255,255,255,0.4)", marginBottom: 28 }}>
          A few screenshots, an optional build/demo, and your price — lighter than a full site listing.
        </p>

        {/* Step tabs */}
        <div style={{ display: "flex", gap: 8, margin: "24px 0 20px", borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: 12 }}>
          {["1. Basics", "2. Tech & Settings", "3. Financials"].map((label, i) => (
            <button
              key={label}
              onClick={() => goToStep(i + 1)}
              style={{
                background: step === i + 1 ? "rgba(192,132,252,0.1)" : "none",
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
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginBottom: 10 }}>
              Add {MIN_IMAGES === 1 ? "at least 1 screenshot" : `at least ${MIN_IMAGES} screenshots`} — any size or orientation, up to {MAX_IMAGES}.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12, marginBottom: 12 }}>
              {images.map((image, idx) => (
                <ImageSlot key={idx} image={image} onRemove={() => removeImage(idx)} />
              ))}
              {images.length < MAX_IMAGES && <AddImageTile onClick={openSlotPicker} />}
            </div>
            {errors.img && <ErrorBox>{errors.img}</ErrorBox>}

            {/* Template file upload / demo link — optional */}
            <div style={{ marginBottom: 20 }}>
              <span style={sectionLabelStyle}>
                Template Files <span style={{ color: "rgba(255,255,255,0.3)", textTransform: "none", letterSpacing: "normal", fontWeight: 500 }}>(optional)</span>
              </span>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginBottom: 10 }}>
                If your template is HTML/CSS/JS, upload it below for a live preview and Test Play. Not required — templates made in other tools (Figma, Canva, etc.) can skip this and just use screenshots + description.
              </div>

              <div style={{ display: "flex", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: 4, marginBottom: 14, gap: 4 }}>
                <button
                  onClick={() => setTplUploadType("upload")}
                  style={{ ...typeBtnStyle, ...(tplUploadType === "upload" ? { background: "rgba(192,132,252,0.12)", color: ACCENT, boxShadow: "0 0 0 1px rgba(192,132,252,0.15)" } : {}) }}
                >
                  Upload Files
                </button>
                <button
                  onClick={() => setTplUploadType("link")}
                  style={{ ...typeBtnStyle, ...(tplUploadType === "link" ? { background: "rgba(192,132,252,0.12)", color: ACCENT, boxShadow: "0 0 0 1px rgba(192,132,252,0.15)" } : {}) }}
                >
                  External Link
                </button>
              </div>

              {tplUploadType === "upload" ? (
                <div>
                  <div
                    onClick={() => tplFileInputRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (e.dataTransfer.files.length) handleTplFiles(e.dataTransfer.files);
                    }}
                    style={{
                      border: `2px dashed ${tplUploadedFiles.length ? "rgba(192,132,252,0.4)" : "rgba(255,255,255,0.15)"}`,
                      borderRadius: 14,
                      padding: 24,
                      textAlign: "center",
                      cursor: "pointer",
                      background: "rgba(255,255,255,0.02)",
                    }}
                  >
                    <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginBottom: 8 }}>
                      {tplUploadedFiles.length
                        ? `${tplUploadedFiles.length} file${tplUploadedFiles.length > 1 ? "s" : ""} selected — click to add more`
                        : "Click or drag to upload your template files (HTML, CSS, JS)"}
                    </div>
                    {tplUploadedFiles.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center", marginTop: 8 }}>
                        {tplUploadedFiles.map((f) => (
                          <span key={f.name} style={fileTagStyle}>{f.name}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginTop: 6 }}>
                    Upload your main HTML file + any CSS/JS. Only one HTML file allowed.
                  </div>
                  {tplDuplicateError && <ErrorBox>{tplDuplicateError}</ErrorBox>}
                  {errors.tplUpload && <ErrorBox>{errors.tplUpload}</ErrorBox>}
                  {tplUploadedFiles.length > 0 && (
                    <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                      <button onClick={() => setTplTestPlayOpen(true)} style={testPlayBtnStyle}>▶ Test Play</button>
                      <button onClick={removeTplFiles} style={prevBtnStyle}>Remove Files</button>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <label style={fieldLabelStyle}>Template Demo URL</label>
                  <input
                    type="url"
                    value={tplLinkUrl}
                    onChange={(e) => setTplLinkUrl(e.target.value)}
                    placeholder="https://mytemplate-demo.site"
                    style={inputStyle}
                  />
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginTop: 4 }}>
                    Optional link to a live demo of the template.
                  </div>
                </div>
              )}
              <input
                ref={tplFileInputRef}
                type="file"
                accept=".html,.htm,.css,.js"
                multiple
                style={{ display: "none" }}
                onChange={(e) => {
                  if (e.target.files?.length) handleTplFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>

            <Field label="Title" required error={errors.title}>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="A short, catchy name for your template"
                style={inputStyle}
              />
              <CharCount value={title} min={TITLE_MIN} max={TITLE_MAX} />
            </Field>

            <Field label="Description" required error={errors.desc}>
              <textarea
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="Describe what it includes, who it's for, and what's in the sale…"
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
              <TechField label="Frontend / Tool" value={frontend} onChange={setFrontend} options={FRONTEND_OPTIONS} accent={ACCENT} />
              <TechField label="Backend" value={backend} onChange={setBackend} options={BACKEND_OPTIONS} accent={ACCENT} optional />
              <TechField label="Database" value={database} onChange={setDatabase} options={DATABASE_OPTIONS} accent={ACCENT} optional />
              <TechField label="Monetization" value={monetization} onChange={setMonetization} options={TEMPLATE_MONETIZATION_OPTIONS} accent={ACCENT} />
            </div>

            <span style={sectionLabelStyle}>Settings</span>
            {errors.settings && <ErrorBox>{errors.settings}</ErrorBox>}
            <div className="sr-lf-row-3" style={{ marginBottom: 20 }}>
              <Field label="Category">
                <Select value={category} onChange={setCategory} options={CATEGORY_OPTIONS} accent={ACCENT} />
              </Field>
              <Field label="Template Age (optional)">
                <Select value={age} onChange={setAge} options={AGE_OPTIONS} accent={ACCENT} />
              </Field>
              <Field label="Business Structure (optional)">
                <Select value={structure} onChange={setStructure} options={STRUCTURE_OPTIONS} accent={ACCENT} />
              </Field>
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
            <div className="sr-lf-fin-card">
              <div className="sr-lf-row-3">
                <Field label="Asking Price (USD)">
                  <div className="sr-lf-money">
                    <input type="number" min="0" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="49" style={inputStyle} />
                  </div>
                </Field>
                <Field label="Monthly Revenue (USD)">
                  <div className="sr-lf-money">
                    <input type="number" min="0" value={revenue} onChange={(e) => setRevenue(e.target.value)} placeholder="0" style={inputStyle} />
                  </div>
                </Field>
                <Field label="Monthly Expenses (USD)">
                  <div className="sr-lf-money">
                    <input type="number" min="0" value={expenses} onChange={(e) => setExpenses(e.target.value)} placeholder="0" style={inputStyle} />
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
                  Upload a screenshot of your Gumroad, Stripe, or marketplace payout dashboard showing this revenue. Listings without proof can't be published — buyers trust verified numbers.
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
              <div style={{ padding: 16, background: "rgba(192,132,252,0.1)", border: "1px solid rgba(192,132,252,0.3)", borderRadius: 10, marginBottom: 16, textAlign: "center" }}>
                <div style={{ color: ACCENT, fontWeight: 700, marginBottom: 12 }}>
                  ✓ Published!
                </div>
                <button onClick={() => router.push("/marketplace")} style={{ ...nextBtnStyle, width: "auto", padding: "10px 20px" }}>
                  Go to marketplace
                </button>
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

      {/* Test Play modal (template build preview) */}
      {tplTestPlayOpen && tplPreviewBlobUrl && (
        <div
          onClick={() => setTplTestPlayOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,0.85)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 480, height: "80vh", background: "#000", borderRadius: 16, border: "1px solid rgba(192,132,252,0.3)", overflow: "hidden", position: "relative" }}>
            <button
              onClick={() => setTplTestPlayOpen(false)}
              style={{ position: "absolute", top: 10, right: 10, zIndex: 1, width: 32, height: 32, borderRadius: "50%", background: "rgba(0,0,0,0.7)", color: "#fff", border: "none", cursor: "pointer" }}
            >
              ✕
            </button>
            <iframe src={tplPreviewBlobUrl} sandbox="allow-scripts allow-same-origin" style={{ width: "100%", height: "100%", border: "none" }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared subcomponents ──

function ImageSlot({ image, onRemove }: { image: SlotImage; onRemove: () => void }) {
  return (
    <div
      style={{
        height: 140,
        background: "rgba(255,255,255,0.03)",
        borderRadius: 14,
        display: "flex",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <img src={image.dataUrl} alt="Template screenshot" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      <button
        type="button"
        onClick={onRemove}
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
    </div>
  );
}

function AddImageTile({ onClick }: { onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        height: 140,
        background: "rgba(255,255,255,0.03)",
        border: "2px dashed rgba(255,255,255,0.15)",
        borderRadius: 14,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        gap: 6,
        color: "rgba(255,255,255,0.25)",
        fontSize: 11,
        fontWeight: 500,
      }}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} style={{ width: 22, height: 22, opacity: 0.5 }}>
        <path d="M12 5v14M5 12h14" />
      </svg>
      Add screenshot
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
const fileTagStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8,
  padding: "5px 10px",
  fontSize: 11.5,
  color: "rgba(255,255,255,0.75)",
};
const testPlayBtnStyle: React.CSSProperties = {
  flex: 1,
  height: 44,
  background: "rgba(192,132,252,0.12)",
  color: ACCENT,
  border: "1px solid rgba(192,132,252,0.3)",
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
};
