"use client";

// Ports the app-listing form that actually lives inside Js/onboarding.js
// (lines ~1-993) — despite the filename, that file has nothing to do with
// product-tour onboarding; every line of it is the standalone "list an app"
// modal (window.__openAppListingForm / #listingFormModalApp), a sibling of
// listing-form.js (website) and listing-form-game.js (game). The real
// onboarding/welcome-tour flow lives elsewhere and is already ported as
// components/onboarding/TourModal.tsx — that naming collision is why this
// form was previously marked "done" in port-status.md when it had never
// been started. See port-status.md for the corrected breakdown.
//
// Field-for-field mirror of the original 4-step modal:
//   Step 1 (Basics): name, description, category, app age, business
//     structure, reason for selling (optional)
//   Step 2 (Media): banner (16:9), icon, exactly 3 screenshots
//   Step 3 (Platforms & Transfer): iOS / Android / Web toggles (each with
//     its own store/site URL OR a per-platform "Not live yet" build
//     upload), a separate global "Not Live" tile (app isn't published
//     anywhere yet — clears/disables iOS/Android/Web and requires its own
//     build upload instead), optional extra files, transfer methods
//   Step 4 (Financials): price (always required), revenue/expenses/
//     monetization model (disabled + cleared while globally "Not Live",
//     since there's nothing live generating them yet), subscription
//     monthly/annual sub-fields when monetization is "Subscription"
//
// Images (banner/icon/screenshots) upload to Imgur, exactly like the
// website/game forms. Build files (per-platform "not live" uploads, the
// global "not live" upload, and the optional extra-files slot) upload to
// /api/storage — that handler already accepts both text (html/css/js) and
// base64 (apk/aab/obb/apks/xapk/ipa/zip) encodings untouched from the
// legacy backend, so no server-side change was needed for this form.
//
// Draft save/restore uses localStorage (key: srf_draft_app), matching the
// original's AFM_DRAFT_KEY. GitHub repo attach isn't ported yet anywhere
// in this app, so attachedRepo is always sent as null (same as the
// website/game forms).

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { createListing, checkStoreLink, type ListingBuildFile } from "@/lib/listings";
import { aiStudioCall, aiPlanCap } from "@/lib/aiStudio";
import { useAiLengthPicker } from "@/lib/useAiLengthPicker";
import { useConfirm } from "@/lib/useConfirm";
import { useLimits } from "@/lib/useLimits";
import Select from "./shared/Select";
import PlatformPicker, { PlatformIcon } from "./shared/PlatformPicker";
import TransferMethodPicker from "./shared/TransferMethodPicker";
import ProofUploader, { type ProofImage } from "./shared/ProofUploader";
import { APP_TRANSFER_METHODS } from "./shared/transferMethods";

const ACCENT = "#fbbf24";
const DRAFT_KEY = "srf_draft_app";

// Fallback limits — used only until useLimits() resolves live values from
// GET /api/limits (app/api/_lib/limits.js's LIMITS.listing). Same numbers
// as that source (title 3-99 chars, desc 100-5000 chars), kept here as the
// initial/degrade-on-failure state rather than a permanent hardcode.
const FALLBACK_TITLE_MIN = 3;
const FALLBACK_TITLE_MAX = 99;
const FALLBACK_DESC_MIN = 100;
const FALLBACK_DESC_MAX = 5000;

const CATEGORY_OPTIONS = ["Productivity", "Social", "Finance", "Health & Fitness", "Entertainment", "Education", "Utilities", "Other"];
const AGE_OPTIONS = ["< 3 months", "3–5 months", "6–11 months", "1+ year", "2+ years", "3+ years", "5+ years", "10+ years"];
const STRUCTURE_OPTIONS = ["Sole Proprietorship", "LLC", "Corporation", "Partnership", "Other"];
const MONETIZATION_OPTIONS = ["Ads", "Subscription", "One-time purchase", "In-app purchases", "Freemium", "Other"];

// Tech Stack dropdown options — was free-text, converted to pick-from-list
// + "Other" (see TechField in WebsiteListingForm.tsx for the same pattern
// and rationale).
const FRONTEND_OPTIONS = ["React Native", "Flutter", "Swift/SwiftUI", "Kotlin", "Java", "Ionic", "Xamarin", "Unity", "Other"];
const BACKEND_OPTIONS = ["Node.js", "Firebase", "Supabase", "Django", "Flask", "Ruby on Rails", "Laravel", "None / Client-only", "Other"];
const DATABASE_OPTIONS = ["Firestore", "PostgreSQL", "MySQL", "MongoDB", "Supabase", "SQLite", "Realm", "None", "Other"];

type Platform = "ios" | "android" | "web";
// "Not live" builds are link-only for iOS/Android — no binary APK/IPA/AAB
// upload accepted anywhere in this form (that storage would be wasted on
// files nobody can install without sideloading anyway; a direct download
// link to the build, hosted wherever the seller already has it, works just
// as well and costs us nothing). "Web" is the one case where an upload
// still makes sense, since it's small (html/css/js only) and we can render
// it live ourselves later — see EXTRA_FILE_EXTS/TEXT_EXTS below and
// zipIfMultiple() further down this file.
const PLATFORM_META: Record<Platform, { label: string; urlLabel: string; urlPlaceholder: string; buildUrlLabel: string; buildUrlPlaceholder: string }> = {
  ios: { label: "iOS", urlLabel: "App Store URL", urlPlaceholder: "https://apps.apple.com/...", buildUrlLabel: "Link to your .ipa (any host)", buildUrlPlaceholder: "https://drive.google.com/... or any direct link" },
  android: { label: "Android", urlLabel: "Play Store URL", urlPlaceholder: "https://play.google.com/...", buildUrlLabel: "Link to your .apk/.aab (any host)", buildUrlPlaceholder: "https://drive.google.com/... or any direct link" },
  web: { label: "Web", urlLabel: "Site URL", urlPlaceholder: "https://example.com", buildUrlLabel: "", buildUrlPlaceholder: "" },
};
// Only text web assets can be uploaded anywhere in this form — no binaries.
// If a seller selects more than one file, they get zipped into a single
// bundle client-side (see zipIfMultiple) before upload, so storage only
// ever holds one small archive instead of loose files.
const EXTRA_FILE_EXTS = [".html", ".htm", ".css", ".js", ".zip"];
const TEXT_EXTS = ["html", "htm", "css", "js"];
const WEB_BUILD_EXTS = [".html", ".htm", ".css", ".js"];

interface SlotImage {
  file: File;
  dataUrl: string;
}
interface NamedFile {
  file: File;
  name: string;
}

interface Draft {
  step?: number;
  name?: string;
  desc?: string;
  category?: string;
  age?: string;
  structure?: string;
  reason?: string;
  videoUrl?: string;
  previewUrl?: string;
  price?: string;
  revenue?: string;
  expenses?: string;
  techFrontend?: string;
  techBackend?: string;
  techDatabase?: string;
  platforms?: Platform[];
  iosStoreUrl?: string;
  androidStoreUrl?: string;
  webSiteUrl?: string;
  globalNotLive?: boolean;
  transferMethods?: string[];
  monetization?: string;
  subMonthly?: string;
  subAnnual?: string;
}

function extOf(filename: string): string {
  return "." + (filename.split(".").pop() || "").toLowerCase();
}

async function uploadToImgur(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("image", file);
  const res = await fetch("https://api.imgur.com/3/image", {
    method: "POST",
    headers: { Authorization: "Client-ID 891e5bb4aa94282" },
    body: fd,
  });
  const json = await res.json();
  if (!json.success) throw new Error("Imgur upload failed: " + (json.data && json.data.error));
  return json.data.link;
}

// Uploads one File to /api/storage, choosing utf8 vs base64 encoding by
// extension exactly like the original's per-file branch — text web assets
// get a real `url` back, binaries/zips get a private `storagePath` that
// must be resolved to a signed URL later at render time.
async function uploadBuildFile(file: File, idToken: string): Promise<ListingBuildFile> {
  const ext = extOf(file.name).slice(1);
  let body: Record<string, string>;
  if (TEXT_EXTS.includes(ext)) {
    const content = await file.text();
    body = { filename: file.name, content, encoding: "utf8" };
  } else {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = () => reject(new Error(file.name + " read failed"));
      reader.readAsDataURL(file);
    });
    body = { filename: file.name, content: base64, encoding: "base64" };
  }
  const res = await fetch("/api/storage", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || file.name + " upload failed");
  return {
    filename: file.name,
    url: json.url || null,
    storagePath: json.storagePath || null,
  };
}

// If the seller selected more than one html/css/js file for a "not live"
// web build, bundle them into a single .zip client-side before upload —
// storage only ever holds one small archive per not-live build instead of
// N loose files, and it still renders live later the same way a single
// uploaded .html file would (just unzipped server/render-side first). A
// single file is left as-is; zipping one file would just add overhead for
// no benefit.
async function zipIfMultiple(files: NamedFile[]): Promise<NamedFile[]> {
  if (files.length <= 1) return files;
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.file);
  const blob = await zip.generateAsync({ type: "blob" });
  const zipFile = new File([blob], "site-bundle.zip", { type: "application/zip" });
  return [{ file: zipFile, name: zipFile.name }];
}

export default function AppListingForm({ onBack }: { onBack?: () => void } = {}) {
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


  // Step 1 — Basics
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  // ── AI auto-description (ports afmAutoGenBtn from ai-support-chat.js) ──
  const { pick, AiLengthPickerHost } = useAiLengthPicker();
  const { confirm, alert, ConfirmHost } = useConfirm();
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  async function handleAutoGenerate() {
    const n = name.trim();
    if (!n) {
      setErrors((prev) => ({ ...prev, name: `Name must be between ${TITLE_MIN} and ${TITLE_MAX} characters (currently 0).` }));
      return;
    }
    setAiError(null);
    const plan = profile?.plan || "free";
    const cap = aiPlanCap(plan);
    const targetLength = await pick(cap, plan);
    if (targetLength === null) return; // cancelled

    setAiGenerating(true);
    try {
      // Server action takes `title` regardless of listing type — the app
      // form's field is just labeled "Name" in the UI (same mapping the
      // original's afmAutoGenBtn wiring uses: titleId points at afmName).
      const result = await aiStudioCall<{ description?: string }>("auto-description", { title: n, targetLength, plan });
      const generated = (result.description || "").trim();
      if (!generated) throw new Error("The AI returned an empty description.");
      setDesc(generated);
    } catch (e) {
      setAiError(e instanceof Error ? `Couldn't generate a description: ${e.message}` : "Could not generate a description right now — please try again or write your own.");
    } finally {
      setAiGenerating(false);
    }
  }
  const [category, setCategory] = useState("");
  const [age, setAge] = useState("");
  const [structure, setStructure] = useState("");
  const [reason, setReason] = useState("");

  // Step 2 — Media
  const [banner, setBanner] = useState<SlotImage | null>(null);
  const [icon, setIcon] = useState<SlotImage | null>(null);
  const [screenshots, setScreenshots] = useState<SlotImage[]>([]);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);
  const screenshotInputRef = useRef<HTMLInputElement>(null);
  const MAX_SCREENSHOTS = 3;

  // Step 3 — Platforms & Transfer
  const [platforms, setPlatforms] = useState<Set<Platform>>(new Set());
  const [globalNotLive, setGlobalNotLive] = useState(false);
  const [notLive, setNotLive] = useState<Record<Platform, boolean>>({ ios: false, android: false, web: false });
  const [platformUrls, setPlatformUrls] = useState<Record<Platform, string>>({ ios: "", android: "", web: "" });
  // iOS/Android "not live" builds are a URL (to wherever the seller already
  // hosts the .ipa/.apk — Drive, Dropbox, their own site, etc.), never a
  // file upload — see PLATFORM_META comment above. Only "web" keeps a file
  // list, since that's the one case we accept an upload for (html/css/js).
  const [platformBuildUrls, setPlatformBuildUrls] = useState<Record<"ios" | "android", string>>({ ios: "", android: "" });
  const [webNotLiveFiles, setWebNotLiveFiles] = useState<NamedFile[]>([]);
  // Installs + Monthly Active Users — required once a store platform
  // (iOS/Android) is marked Live, since that's the only way a buyer can
  // sanity-check store traction claims. Not required while "Not live"
  // (nothing to report yet) or for Web (no single install-count source).
  const [platformStats, setPlatformStats] = useState<Record<"ios" | "android", { installs: string; mau: string }>>({
    ios: { installs: "", mau: "" },
    android: { installs: "", mau: "" },
  });
  // Global "app isn't published anywhere yet" also takes a link now, not a
  // file — same reasoning as platformBuildUrls above.
  const [globalBuildUrl, setGlobalBuildUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [extraFiles, setExtraFiles] = useState<NamedFile[]>([]);
  const [transferMethods, setTransferMethods] = useState<string[]>([]);
  const webNotLiveInputRef = useRef<HTMLInputElement>(null);
  const extraFileInputRef = useRef<HTMLInputElement>(null);

  // Step 4 — Financials
  const [price, setPrice] = useState("");
  const [revenue, setRevenue] = useState("");
  const [expenses, setExpenses] = useState("");
  // Fixed-price vs auction — see WebsiteListingForm.tsx's matching block
  // for the full rationale; kept identical across every listing type.
  const [saleType, setSaleType] = useState<"fixed" | "auction">("fixed");
  const [auctionStartPrice, setAuctionStartPrice] = useState("");
  const [auctionStartTime, setAuctionStartTime] = useState("");
  const [auctionEndTime, setAuctionEndTime] = useState("");
  const [techFrontend, setTechFrontend] = useState("");
  const [techBackend, setTechBackend] = useState("");
  const [techDatabase, setTechDatabase] = useState("");
  const [monetization, setMonetization] = useState("");
  const [subMonthly, setSubMonthly] = useState("");
  const [subAnnual, setSubAnnual] = useState("");
  // Proof of the claimed monthly revenue — required whenever revenue > 0
  // and the app isn't marked globally Not Live (no revenue to prove then).
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
          msg: "You have a saved draft for an app listing. Restore it?",
          confirmText: "Restore",
          cancelText: "Discard",
        });
        if (!ok) {
          localStorage.removeItem(DRAFT_KEY);
          return;
        }
        const d: Draft = JSON.parse(raw);
        if (d.name) setName(d.name);
        if (d.desc) setDesc(d.desc);
        if (d.category) setCategory(d.category);
        if (d.age) setAge(d.age);
        if (d.structure) setStructure(d.structure);
        if (d.reason) setReason(d.reason);
        if (d.videoUrl) setVideoUrl(d.videoUrl);
        if (d.previewUrl) setPreviewUrl(d.previewUrl);
        if (d.price) setPrice(d.price);
        if (d.revenue) setRevenue(d.revenue);
        if (d.expenses) setExpenses(d.expenses);
        if (d.techFrontend) setTechFrontend(d.techFrontend);
        if (d.techBackend) setTechBackend(d.techBackend);
        if (d.techDatabase) setTechDatabase(d.techDatabase);
        if (d.platforms?.length) setPlatforms(new Set(d.platforms));
        if (d.iosStoreUrl || d.androidStoreUrl || d.webSiteUrl) {
          setPlatformUrls({ ios: d.iosStoreUrl || "", android: d.androidStoreUrl || "", web: d.webSiteUrl || "" });
        }
        if (d.globalNotLive) setGlobalNotLive(true);
        if (d.transferMethods?.length) setTransferMethods(d.transferMethods);
        if (d.monetization) setMonetization(d.monetization);
        if (d.subMonthly) setSubMonthly(d.subMonthly);
        if (d.subAnnual) setSubAnnual(d.subAnnual);
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
        step: nextStep, name, desc, category, age, structure, reason, videoUrl, previewUrl,
        price, revenue, expenses, techFrontend, techBackend, techDatabase,
        platforms: Array.from(platforms), iosStoreUrl: platformUrls.ios, androidStoreUrl: platformUrls.android,
        webSiteUrl: platformUrls.web, globalNotLive, transferMethods, monetization, subMonthly, subAnnual,
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
    return [name, desc, price].some((v) => v.trim().length > 0);
  }

  async function handleBack() {
    if (hasAnyData()) {
      const save = await confirm({
        theme: "warning",
        title: "Save as Draft?",
        msg: "You have unsaved app listing info. Save as a draft so you can pick up where you left off?",
        confirmText: "Save Draft",
        cancelText: "Discard & Close",
      });
      if (save) saveDraft();
      else clearDraft();
    }
    if (onBack) onBack();
    else router.push("/marketplace");
  }

  // ── Image helpers (banner/icon/screenshots — plain read, no normalization needed) ──
  function readImage(file: File): Promise<SlotImage> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (ev) => resolve({ file, dataUrl: ev.target?.result as string });
      reader.readAsDataURL(file);
    });
  }

  async function onBannerChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      await alert({ theme: "warning", title: "Invalid File", msg: "Please select an image file." });
      return;
    }
    setBanner(await readImage(f));
  }
  async function onIconChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      await alert({ theme: "warning", title: "Invalid File", msg: "Please select an image file." });
      return;
    }
    setIcon(await readImage(f));
  }
  async function onScreenshotsChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []).filter((f) => f.type.startsWith("image/"));
    e.target.value = "";
    const remaining = MAX_SCREENSHOTS - screenshots.length;
    if (remaining <= 0 || files.length === 0) return;
    const toAdd = files.slice(0, remaining);
    const read = await Promise.all(toAdd.map(readImage));
    setScreenshots((prev) => [...prev, ...read]);
  }
  function removeScreenshot(idx: number) {
    setScreenshots((prev) => prev.filter((_, i) => i !== idx));
  }

  // ── Platform toggles ──
  function togglePlatform(p: Platform) {
    if (globalNotLive) return;
    setPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }
  function toggleGlobalNotLive() {
    setGlobalNotLive((prev) => {
      const next = !prev;
      if (next) setPlatforms(new Set());
      return next;
    });
  }
  function togglePlatformNotLive(p: Platform) {
    setNotLive((prev) => ({ ...prev, [p]: !prev[p] }));
  }
  function setPlatformUrl(p: Platform, v: string) {
    setPlatformUrls((prev) => ({ ...prev, [p]: v }));
  }
  function setPlatformBuildUrl(p: "ios" | "android", v: string) {
    setPlatformBuildUrls((prev) => ({ ...prev, [p]: v }));
  }
  function setPlatformStat(p: "ios" | "android", field: "installs" | "mau", v: string) {
    setPlatformStats((prev) => ({ ...prev, [p]: { ...prev[p], [field]: v } }));
  }
  // Web is the only "not live" platform that still takes a file upload —
  // html/css/js only, never binaries. Multiple files get zipped into one
  // bundle at submit time (see zipIfMultiple), so this list is just staging.
  function addWebNotLiveFiles(fileList: FileList | File[]) {
    const valid = Array.from(fileList).filter((f) => WEB_BUILD_EXTS.includes(extOf(f.name)));
    if (valid.length === 0) return;
    setWebNotLiveFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name));
      const additions = valid.filter((f) => !existing.has(f.name)).map((f) => ({ file: f, name: f.name }));
      return [...prev, ...additions];
    });
  }
  function removeWebNotLiveFile(idx: number) {
    setWebNotLiveFiles((prev) => prev.filter((_, i) => i !== idx));
  }
  function addExtraFiles(fileList: FileList | File[]) {
    const valid = Array.from(fileList).filter((f) => EXTRA_FILE_EXTS.includes(extOf(f.name)));
    if (valid.length === 0) return;
    setExtraFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name));
      const additions = valid.filter((f) => !existing.has(f.name)).map((f) => ({ file: f, name: f.name }));
      return [...prev, ...additions].slice(0, 10);
    });
  }
  function removeExtraFile(idx: number) {
    setExtraFiles((prev) => prev.filter((_, i) => i !== idx));
  }
  function toggleTransfer(value: string) {
    setTransferMethods((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  function isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  // ── Validation ──
  function clearAllErrors() {
    setErrors({});
  }

  function validateStep1(): boolean {
    clearAllErrors();
    const n = name.trim();
    if (n.length < TITLE_MIN || n.length > TITLE_MAX) {
      setErrors({ name: `Name must be between ${TITLE_MIN} and ${TITLE_MAX} characters (currently ${n.length}).` });
      return false;
    }
    const d = desc.trim();
    if (d.length < DESC_MIN || d.length > DESC_MAX) {
      setErrors({ desc: `Description must be between ${DESC_MIN} and ${DESC_MAX} characters (currently ${d.length}).` });
      return false;
    }
    if (!category || !age || !structure) {
      setErrors({ basics: "Please fill in Category, App Age, and Business Structure." });
      return false;
    }
    return true;
  }

  function validateStep2(): boolean {
    clearAllErrors();
    if (!banner) {
      setErrors({ banner: "Please upload a banner image." });
      return false;
    }
    if (!icon) {
      setErrors({ icon: "Please upload an app icon." });
      return false;
    }
    if (screenshots.length !== MAX_SCREENSHOTS) {
      setErrors({ screenshots: `Please upload exactly ${MAX_SCREENSHOTS} screenshots.` });
      return false;
    }
    return true;
  }

  function validateStep3(): boolean {
    clearAllErrors();
    if (globalNotLive) {
      if (!globalBuildUrl.trim() || !isValidUrl(globalBuildUrl.trim())) {
        setErrors({ platforms: "Please enter a valid link to your build for this not-yet-published app." });
        return false;
      }
    } else if (platforms.size === 0) {
      setErrors({ platforms: "Please select at least one platform, or mark the app as Not Live." });
      return false;
    }
    if (!globalNotLive) {
      for (const p of platforms) {
        if (notLive[p]) {
          if (p === "web") {
            if (webNotLiveFiles.length === 0) {
              setErrors({ platforms: "Please upload your site files for Web, or switch it back to live." });
              return false;
            }
          } else {
            const u = platformBuildUrls[p].trim();
            if (!u || !isValidUrl(u)) {
              setErrors({ platforms: `Please enter a valid build link for ${PLATFORM_META[p].label}, or switch it back to live.` });
              return false;
            }
          }
        } else {
          const u = platformUrls[p].trim();
          if (!u || !isValidUrl(u)) {
            setErrors({ platforms: `Please enter a valid ${PLATFORM_META[p].urlLabel} for ${PLATFORM_META[p].label}.` });
            return false;
          }
          // Live store platforms (iOS/Android) must report install count +
          // monthly active users — that's the traction data a buyer checks
          // a store listing's numbers against. Web has no single
          // install-count source, so it's exempt.
          if (p === "ios" || p === "android") {
            const stats = platformStats[p];
            if (!stats.installs.trim() || isNaN(parseFloat(stats.installs)) || parseFloat(stats.installs) < 0) {
              setErrors({ platforms: `Please enter a valid install count for ${PLATFORM_META[p].label}.` });
              return false;
            }
            if (!stats.mau.trim() || isNaN(parseFloat(stats.mau)) || parseFloat(stats.mau) < 0) {
              setErrors({ platforms: `Please enter valid Monthly Active Users for ${PLATFORM_META[p].label}.` });
              return false;
            }
          }
        }
      }
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
      if (step === 3 && !validateStep3()) return;
    }
    changeStep(n);
    saveDraft(n);
  }

  const profit = (parseFloat(revenue) || 0) - (parseFloat(expenses) || 0);

  async function handleSubmit() {
    clearAllErrors();
    setSubmitError("");

    if (!validateStep1()) {
      changeStep(1);
      return;
    }
    if (!validateStep2()) {
      changeStep(2);
      return;
    }
    if (!validateStep3()) {
      changeStep(3);
      return;
    }
    let priceVal = "";
    if (saleType === "auction") {
      if (!auctionStartPrice.trim() || isNaN(parseFloat(auctionStartPrice)) || parseFloat(auctionStartPrice) <= 0) {
        setErrors({ fin: "Please enter a valid starting price for your auction." });
        return;
      }
      if (!auctionStartTime || !auctionEndTime) {
        setErrors({ fin: "Please set a start and end time for your auction." });
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
      // financials.price mirrors the starting price for auctions, same
      // convention as WebsiteListingForm — it gives the backend/cards a
      // sane fallback number before any bid exists.
      priceVal = auctionStartPrice.trim();
    } else {
      priceVal = price.trim();
      if (!priceVal || isNaN(parseFloat(priceVal)) || parseFloat(priceVal) < 0) {
        setErrors({ fin: "Please enter a valid asking price." });
        return;
      }
    }
    if (!globalNotLive) {
      if (!revenue.trim() || isNaN(parseFloat(revenue)) || !expenses.trim() || isNaN(parseFloat(expenses)) || !monetization) {
        setErrors({ fin: "Please fill in Monthly Revenue, Monthly Expenses, and Monetization Model." });
        return;
      }
      if (monetization === "Subscription") {
        if (!subMonthly.trim() || isNaN(parseFloat(subMonthly)) || !subAnnual.trim() || isNaN(parseFloat(subAnnual))) {
          setErrors({ fin: "Please fill in the monthly and annual subscription prices." });
          return;
        }
      }
      if ((parseFloat(revenue) || 0) > 0 && revenueProof.length === 0) {
        setErrors({ fin: "Please upload at least one screenshot proving your claimed monthly revenue (e.g. App Store Connect, Play Console, or Stripe dashboard)." });
        return;
      }
    }
    if (!user) {
      setSubmitError("You must be logged in to list.");
      return;
    }

    setSubmitting(true);
    try {
      setProgress({ pct: 0, label: "Uploading banner…" });
      const bannerUrl = await uploadToImgur(banner!.file);
      setProgress({ pct: 15, label: "Uploading icon…" });
      const iconUrl = await uploadToImgur(icon!.file);

      const shotUrls: string[] = [];
      for (let i = 0; i < screenshots.length; i++) {
        setProgress({ pct: 20 + Math.round(((i + 1) / screenshots.length) * 25), label: `Uploading screenshot ${i + 1} of ${screenshots.length}…` });
        shotUrls.push(await uploadToImgur(screenshots[i].file));
      }
      // banner isn't a listing field on its own in the backend contract —
      // it's folded into images[0] the same way the original sends it
      // (images = shots, appIcon = icon); keep banner as the cover image.
      const allImages = [bannerUrl, ...shotUrls];

      const idToken = await user.getIdToken();

      setProgress({ pct: 48, label: "Uploading extra files…" });
      const additionalFiles: ListingBuildFile[] = [];
      for (const f of extraFiles) additionalFiles.push(await uploadBuildFile(f.file, idToken));

      // Only "web" not-live builds are ever uploaded as files — iOS/Android
      // not-live builds are always a URL the seller already hosts elsewhere
      // (see platformBuildUrls/globalBuildUrl), never a binary we store.
      setProgress({ pct: 60, label: "Uploading web build…" });
      let webBuildFiles: ListingBuildFile[] | null = null;
      if (!globalNotLive && platforms.has("web") && notLive.web && webNotLiveFiles.length) {
        const bundled = await zipIfMultiple(webNotLiveFiles);
        const uploaded: ListingBuildFile[] = [];
        for (const f of bundled) uploaded.push(await uploadBuildFile(f.file, idToken));
        webBuildFiles = uploaded;
      }

      let revenueProofUrls: string[] = [];
      if (revenueProof.length > 0) {
        setProgress({ pct: 85, label: "Uploading revenue proof…" });
        for (const img of revenueProof) revenueProofUrls.push(await uploadToImgur(img.file));
      }

      setProgress({ pct: 90, label: "Saving listing to marketplace…" });

      const effectivePreviewUrl = platforms.has("web") && !notLive.web ? previewUrl.trim() || undefined : undefined;

      const { listingId } = await createListing({
        idToken,
        type: "app",
        title: name.trim(),
        description: desc.trim(),
        appIcon: iconUrl,
        images: allImages,
        videoUrl: videoUrl.trim() || undefined,
        previewUrl: effectivePreviewUrl,
        category,
        additionalFiles,
        platforms: {
          selected: Array.from(platforms),
          iosUrl: platforms.has("ios") && !notLive.ios ? platformUrls.ios.trim() : null,
          androidUrl: platforms.has("android") && !notLive.android ? platformUrls.android.trim() : null,
          webUrl: platforms.has("web") && !notLive.web ? platformUrls.web.trim() : null,
          previewUrl: effectivePreviewUrl || null,
          notLive: {
            ios: platforms.has("ios") ? notLive.ios : false,
            android: platforms.has("android") ? notLive.android : false,
            web: platforms.has("web") ? notLive.web : false,
          },
          // Not-live builds: iOS/Android are always a link the seller
          // already hosts elsewhere; web is the one uploaded build file.
          iosBuildUrl: platforms.has("ios") && notLive.ios ? platformBuildUrls.ios.trim() : null,
          androidBuildUrl: platforms.has("android") && notLive.android ? platformBuildUrls.android.trim() : null,
          webBuildFiles,
          stats: {
            ios: platforms.has("ios") && !notLive.ios
              ? { installs: parseFloat(platformStats.ios.installs) || 0, mau: parseFloat(platformStats.ios.mau) || 0 }
              : undefined,
            android: platforms.has("android") && !notLive.android
              ? { installs: parseFloat(platformStats.android.installs) || 0, mau: parseFloat(platformStats.android.mau) || 0 }
              : undefined,
          },
        },
        notLive: { ios: false, android: false, web: false, global: globalNotLive },
        // Global not-live is also link-only now — see globalBuildUrl state.
        globalBuildUrl: globalNotLive ? globalBuildUrl.trim() : undefined,
        tech: {
          frontend: techFrontend.trim() || undefined,
          backend: techBackend.trim() || undefined,
          database: techDatabase.trim() || undefined,
          monetization: monetization || undefined,
        },
        settings: { category, age, structure, reason: reason.trim() || undefined },
        financials: globalNotLive
          ? { price: parseFloat(priceVal), revenue: 0, expenses: 0 }
          : { price: parseFloat(priceVal), revenue: parseFloat(revenue), expenses: parseFloat(expenses), revenueProofUrls },
        saleType,
        auction: saleType === "auction"
          ? {
              startPrice: parseFloat(auctionStartPrice),
              startTime: new Date(auctionStartTime).toISOString(),
              endTime: new Date(auctionEndTime).toISOString(),
            }
          : undefined,
        transferMethods,
        attachedRepo: null,
      });

      setProgress({ pct: 100, label: "Published!" });
      setSuccess(true);
      clearDraft();

      // Best-effort, non-blocking: for any live store URL (Play Store/App
      // Store), ask the backend to do a lightweight plausibility check
      // (see listing.link-check / handleLinkCheck). This is NOT ownership
      // proof — it just upgrades 'link-provided' to 'link-checked' when the
      // store page is reachable and mentions the listing's title. Errors
      // here are swallowed on purpose: this is a nice-to-have background
      // enrichment, not something that should ever block or interrupt the
      // "Published!" flow the user is already seeing.
      for (const p of ["ios", "android"] as const) {
        if (platforms.has(p) && !notLive[p] && !globalNotLive && platformUrls[p].trim()) {
          checkStoreLink({ idToken, listingId, url: platformUrls[p].trim() }).catch(() => {});
        }
      }

      setTimeout(() => router.push("/marketplace"), 2000);
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
      <input ref={bannerInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onBannerChange} />
      <input ref={iconInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onIconChange} />
      <input ref={screenshotInputRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={onScreenshotsChange} />
      <input
        ref={webNotLiveInputRef}
        type="file"
        accept={WEB_BUILD_EXTS.join(",")}
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files?.length) addWebNotLiveFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={extraFileInputRef}
        type="file"
        accept={EXTRA_FILE_EXTS.join(",")}
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files?.length) addExtraFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {/* Header */}
      <header
        style={{
          position: "sticky", top: 0, zIndex: 10, height: 52, display: "flex", alignItems: "center",
          justifyContent: "space-between", padding: "0 20px", background: "rgba(0,0,0,0.9)",
          backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)", borderBottom: "1px solid rgba(255,255,255,0.07)",
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
            Siterifty<span style={{ color: "rgba(251,191,36,0.55)" }}>.com</span>
          </div>
        </div>
        <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: ACCENT }}>
          App Listing
        </span>
      </header>

      <div style={{ maxWidth: 820, margin: "0 auto", padding: "28px 16px 80px" }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 6 }}>
          List an <em style={{ fontStyle: "normal", color: "rgba(251,191,36,0.85)" }}>App</em>
        </h1>
        <p style={{ fontSize: 14, color: "rgba(255,255,255,0.4)", marginBottom: 28 }}>
          Add your app&apos;s details, media, platforms, and price to list it on the marketplace.
        </p>

        {/* Step tabs */}
        <div style={{ display: "flex", gap: 8, margin: "0 0 20px", borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: 12, flexWrap: "wrap" }}>
          {["1. Basics", "2. Media", "3. Platforms", "4. Financials"].map((label, i) => (
            <button
              key={label}
              onClick={() => goToStep(i + 1)}
              style={{
                background: step === i + 1 ? "rgba(251,191,36,0.1)" : "none",
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
            {errors.basics && <ErrorBox>{errors.basics}</ErrorBox>}
            <Field label="App Name" required error={errors.name}>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your app's name" style={inputStyle} />
              <CharCount value={name} min={TITLE_MIN} max={TITLE_MAX} />
            </Field>

            <Field label="Description" required error={errors.desc}>
              <textarea
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="Describe what the app does, its users, and what's included in the sale…"
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

            <div className="sr-lf-row-2" style={{ marginBottom: 16 }}>
              <Field label="Category">
                <Select value={category} onChange={setCategory} options={CATEGORY_OPTIONS} accent={ACCENT} />
              </Field>
              <Field label="App Age">
                <Select value={age} onChange={setAge} options={AGE_OPTIONS} accent={ACCENT} />
              </Field>
            </div>

            <Field label="Business Structure">
              <Select value={structure} onChange={setStructure} options={STRUCTURE_OPTIONS} accent={ACCENT} />
            </Field>

            <Field label="Reason for selling (optional)">
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Moving to a new project, time constraints" style={inputStyle} />
            </Field>

            <NextButton onClick={() => goToStep(2)} />
          </div>
        )}

        {step === 2 && (
          <div>
            <span style={sectionLabelStyle}>
              Banner <span style={{ color: "#f87171" }}>*</span> <span style={{ opacity: 0.5, textTransform: "none", fontWeight: 400 }}>— 16:9, e.g. 1280×720px</span>
            </span>
            <ImageSlot image={banner} label="Upload Banner" landscape onClick={() => bannerInputRef.current?.click()} onRemove={() => setBanner(null)} />
            {errors.banner && <ErrorBox>{errors.banner}</ErrorBox>}

            <div style={{ height: 16 }} />
            <span style={sectionLabelStyle}>
              Icon <span style={{ color: "#f87171" }}>*</span>
            </span>
            <div style={{ width: 120 }}>
              <ImageSlot image={icon} label="Upload Icon" onClick={() => iconInputRef.current?.click()} onRemove={() => setIcon(null)} square />
            </div>
            {errors.icon && <ErrorBox>{errors.icon}</ErrorBox>}

            <div style={{ height: 16 }} />
            <span style={sectionLabelStyle}>
              Screenshots <span style={{ color: "#f87171" }}>*</span> <span style={{ opacity: 0.5, textTransform: "none", fontWeight: 400 }}>— exactly {MAX_SCREENSHOTS}</span>
            </span>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {Array.from({ length: MAX_SCREENSHOTS }).map((_, i) => (
                <ImageSlot
                  key={i}
                  image={screenshots[i] || null}
                  label="+ Add"
                  onClick={() => screenshotInputRef.current?.click()}
                  onRemove={() => removeScreenshot(i)}
                />
              ))}
            </div>
            {errors.screenshots && <ErrorBox>{errors.screenshots}</ErrorBox>}

            <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
              <PrevButton onClick={() => changeStep(1)} />
              <NextButton onClick={() => goToStep(3)} />
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            {errors.platforms && <ErrorBox>{errors.platforms}</ErrorBox>}

            <span style={sectionLabelStyle}>Platforms</span>
            <div style={{ marginBottom: 12 }}>
              <PlatformPicker
                keys={["ios", "android", "web"]}
                meta={PLATFORM_META}
                selected={platforms as Set<string>}
                onToggle={(p) => togglePlatform(p as Platform)}
                accent={ACCENT}
                disabled={globalNotLive}
              />
            </div>

            {!globalNotLive && (["ios", "android", "web"] as Platform[]).map((p) =>
              platforms.has(p) ? (
                <div key={p} style={{ marginBottom: 16, padding: 14, background: "rgba(255,255,255,0.03)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 7 }}>
                      <PlatformIcon platform={p} size={15} color="rgba(255,255,255,0.7)" />
                      {PLATFORM_META[p].label}
                    </span>
                    <button onClick={() => togglePlatformNotLive(p)} style={notLiveBtnStyle(notLive[p])}>
                      {notLive[p] ? "Live — switch back" : "Not live yet"}
                    </button>
                  </div>
                  {notLive[p] ? (
                    p === "web" ? (
                      <div>
                        <div
                          onClick={() => webNotLiveInputRef.current?.click()}
                          style={{ border: "2px dashed rgba(251,191,36,0.3)", borderRadius: 10, padding: 16, textAlign: "center", cursor: "pointer", fontSize: 12, color: "rgba(255,255,255,0.5)" }}
                        >
                          Click or drag to upload your site ({WEB_BUILD_EXTS.join(", ")}) — multiple files are bundled into one archive automatically
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                          {webNotLiveFiles.map((f, i) => (
                            <FileTag key={f.name} name={f.name} onRemove={() => removeWebNotLiveFile(i)} />
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div>
                        <input
                          type="url"
                          value={platformBuildUrls[p]}
                          onChange={(e) => setPlatformBuildUrl(p, e.target.value)}
                          placeholder={PLATFORM_META[p].buildUrlPlaceholder}
                          style={inputStyle}
                        />
                        <div style={{ fontSize: 11, opacity: 0.45, marginTop: 6 }}>
                          {PLATFORM_META[p].buildUrlLabel} — we don&apos;t host APK/IPA files, just link to wherever it&apos;s already hosted.
                        </div>
                      </div>
                    )
                  ) : (
                    <div>
                      <input
                        type="url"
                        value={platformUrls[p]}
                        onChange={(e) => setPlatformUrl(p, e.target.value)}
                        placeholder={PLATFORM_META[p].urlPlaceholder}
                        style={inputStyle}
                      />
                      {(p === "ios" || p === "android") && (
                        <div className="sr-lf-row-2" style={{ marginTop: 10 }}>
                          <RangeStatField label="Installs" value={platformStats[p].installs} onChange={(v) => setPlatformStat(p, "installs", v)} accent={ACCENT} />
                          <RangeStatField label="Monthly Active Users" value={platformStats[p].mau} onChange={(v) => setPlatformStat(p, "mau", v)} accent={ACCENT} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : null
            )}

            <div
              onClick={toggleGlobalNotLive}
              style={{
                marginBottom: 16, padding: 14, borderRadius: 12, cursor: "pointer",
                background: globalNotLive ? "rgba(251,191,36,0.08)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${globalNotLive ? "rgba(251,191,36,0.35)" : "rgba(255,255,255,0.08)"}`,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: globalNotLive ? ACCENT : "#fff" }}>
                {globalNotLive ? "✓ " : ""}App isn&apos;t published anywhere yet
              </div>
              <div style={{ fontSize: 12, opacity: 0.5, marginTop: 4 }}>
                Selecting this clears platform selections. Price is still required; revenue/expenses/monetization won&apos;t apply yet.
              </div>
              {globalNotLive && (
                <div style={{ marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
                  <input
                    type="url"
                    value={globalBuildUrl}
                    onChange={(e) => setGlobalBuildUrl(e.target.value)}
                    placeholder="Link to your build (Drive/Dropbox/any host)"
                    style={inputStyle}
                  />
                  <div style={{ fontSize: 11, opacity: 0.45, marginTop: 6 }}>
                    We don&apos;t host APK/IPA files — just link to wherever the build already lives.
                  </div>
                </div>
              )}
            </div>

            {platforms.has("web") && !notLive.web && !globalNotLive && (
              <Field label="Preview URL (optional)">
                <input type="url" value={previewUrl} onChange={(e) => setPreviewUrl(e.target.value)} placeholder="https://example.com/demo" style={inputStyle} />
              </Field>
            )}

            <Field label="Demo video URL (optional)">
              <input type="url" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://youtube.com/watch?v=..." style={inputStyle} />
            </Field>

            <span style={sectionLabelStyle}>Additional files (optional)</span>
            <div
              onClick={() => extraFileInputRef.current?.click()}
              style={{ border: "2px dashed rgba(255,255,255,0.15)", borderRadius: 12, padding: 16, textAlign: "center", cursor: "pointer", fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 8 }}
            >
              Click or drag extra files ({EXTRA_FILE_EXTS.join(", ")})
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 20 }}>
              {extraFiles.map((f, i) => (
                <FileTag key={f.name} name={f.name} onRemove={() => removeExtraFile(i)} />
              ))}
            </div>

            <span style={sectionLabelStyle}>
              Delivery Method <span style={{ color: "#f87171" }}>*</span>
            </span>
            {errors.transfer && <ErrorBox>{errors.transfer}</ErrorBox>}
            <div style={{ marginBottom: 24 }}>
              <TransferMethodPicker
                methods={APP_TRANSFER_METHODS}
                selected={transferMethods}
                onToggle={toggleTransfer}
                accent={ACCENT}
              />
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <PrevButton onClick={() => changeStep(2)} />
              <NextButton onClick={() => goToStep(4)} />
            </div>
          </div>
        )}

        {step === 4 && (
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

            {saleType === "auction" && (
              <div className="sr-lf-fin-card">
                <Field label="Starting Price (USD)" required>
                  <div className="sr-lf-money">
                    <input type="number" min="0" value={auctionStartPrice} onChange={(e) => setAuctionStartPrice(e.target.value)} placeholder="200" style={inputStyle} />
                  </div>
                </Field>
                <div className="sr-lf-row-2">
                  <Field label="Start Time">
                    <input type="datetime-local" value={auctionStartTime} onChange={(e) => setAuctionStartTime(e.target.value)} style={inputStyle} />
                  </Field>
                  <Field label="End Time">
                    <input type="datetime-local" value={auctionEndTime} onChange={(e) => setAuctionEndTime(e.target.value)} style={inputStyle} />
                  </Field>
                </div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>
                  Buyers must bid at least 10% above the current highest bid (or starting price for the first bid). Runs 1 hour–30 days.
                </div>
              </div>
            )}

            <div className="sr-lf-fin-card">
              {saleType === "fixed" && (
                <Field label="Asking Price (USD)" required>
                  <div className="sr-lf-money">
                    <input type="number" min="0" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="1000" style={inputStyle} />
                  </div>
                </Field>
              )}

              {globalNotLive && (
                <div style={{ padding: 12, background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.2)", borderRadius: 10, marginBottom: 16, fontSize: 12, color: ACCENT }}>
                  This app is marked &quot;Not Live&quot; — revenue, expenses, and monetization model aren&apos;t applicable yet and are disabled. Price is still required.
                </div>
              )}

              <div className="sr-lf-row-2" style={{ opacity: globalNotLive ? 0.4 : 1 }}>
                <Field label="Monthly Revenue (USD)">
                  <div className="sr-lf-money">
                    <input type="number" min="0" value={revenue} onChange={(e) => setRevenue(e.target.value)} placeholder="200" disabled={globalNotLive} style={inputStyle} />
                  </div>
                </Field>
                <Field label="Monthly Expenses (USD)">
                  <div className="sr-lf-money">
                    <input type="number" min="0" value={expenses} onChange={(e) => setExpenses(e.target.value)} placeholder="20" disabled={globalNotLive} style={inputStyle} />
                  </div>
                </Field>
              </div>
            </div>

            {!globalNotLive && (parseFloat(revenue) || 0) > 0 && (
              <div className="sr-lf-proof-card">
                <span style={sectionLabelStyle}>
                  Proof of Revenue <span style={{ color: "#f87171" }}>*</span>
                </span>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 10 }}>
                  Upload a screenshot of your App Store Connect, Play Console, or payment processor dashboard showing this revenue. Listings without proof can't be published.
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

            <div style={{ opacity: globalNotLive ? 0.4 : 1, marginBottom: 16 }}>
              <Field label="Monetization Model">
                <Select value={monetization} onChange={setMonetization} options={MONETIZATION_OPTIONS} accent={ACCENT} disabled={globalNotLive} />
              </Field>
              {monetization === "Subscription" && !globalNotLive && (
                <div className="sr-lf-row-2" style={{ marginTop: 12 }}>
                  <Field label="Sub. Price — Monthly (USD)">
                    <input type="number" min="0" value={subMonthly} onChange={(e) => setSubMonthly(e.target.value)} placeholder="9.99" style={inputStyle} />
                  </Field>
                  <Field label="Sub. Price — Annual (USD)">
                    <input type="number" min="0" value={subAnnual} onChange={(e) => setSubAnnual(e.target.value)} placeholder="99" style={inputStyle} />
                  </Field>
                </div>
              )}
            </div>

            <div className="sr-lf-row-3" style={{ marginBottom: 16 }}>
              <TechField label="Frontend" value={techFrontend} onChange={setTechFrontend} options={FRONTEND_OPTIONS} accent={ACCENT} />
              <TechField label="Backend" value={techBackend} onChange={setTechBackend} options={BACKEND_OPTIONS} accent={ACCENT} />
              <TechField label="Database" value={techDatabase} onChange={setTechDatabase} options={DATABASE_OPTIONS} accent={ACCENT} />
            </div>

            {!globalNotLive && (
              <div style={{ padding: 16, background: "rgba(255,255,255,0.03)", borderRadius: 12, marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", fontWeight: 600 }}>Monthly Profit (USD)</span>
                <span style={{ fontSize: 20, fontWeight: 800, color: profit >= 0 ? ACCENT : "#f87171" }}>
                  {profit >= 0 ? "+" : ""}${profit.toFixed(2)}
                </span>
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
              <div style={{ padding: 14, background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 10, color: ACCENT, fontWeight: 700, marginBottom: 16, textAlign: "center" }}>
                ✓ Published! Redirecting to the marketplace…
              </div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <PrevButton onClick={() => changeStep(3)} disabled={submitting} />
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
  label,
  landscape,
  square,
  onClick,
  onRemove,
}: {
  image: SlotImage | null;
  label: string;
  landscape?: boolean;
  square?: boolean;
  onClick: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      onClick={image ? undefined : onClick}
      style={{
        height: landscape ? 140 : square ? 120 : 110,
        background: "rgba(255,255,255,0.03)",
        border: `2px dashed ${image ? "transparent" : "rgba(255,255,255,0.15)"}`,
        borderRadius: 14,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        cursor: image ? "default" : "pointer", position: "relative", overflow: "hidden",
      }}
    >
      {image ? (
        <>
          <img src={image.dataUrl} alt={label} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            style={{ position: "absolute", top: 6, right: 6, width: 24, height: 24, borderRadius: "50%", background: "rgba(0,0,0,0.7)", color: "#fff", border: "none", cursor: "pointer", fontSize: 12 }}
          >
            ✕
          </button>
        </>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, color: "rgba(255,255,255,0.25)", fontSize: 12, fontWeight: 500, textAlign: "center", padding: 8 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} style={{ width: 26, height: 26, opacity: 0.5 }}>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
          <span>{label}</span>
        </div>
      )}
    </div>
  );
}

function FileTag({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <span style={fileTagStyle}>
      {name}
      <button type="button" onClick={onRemove} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: 12, lineHeight: 1, padding: 0 }}>
        ✕
      </button>
    </span>
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

// Tech Stack field — dropdown of common presets + "Other" fallback text
// input. See WebsiteListingForm.tsx's TechField for the full rationale.
function TechField({
  label,
  value,
  onChange,
  options,
  accent,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  accent: string;
}) {
  // See WebsiteListingForm.tsx's TechField for why forcedOther is needed
  // (choosing "Other" clears value to "", which can't be distinguished
  // from "nothing selected yet" by value alone).
  const isKnownPreset = options.includes(value);
  const [forcedOther, setForcedOther] = useState(value !== "" && !isKnownPreset);
  const showOther = forcedOther || (value !== "" && !isKnownPreset);
  const selectValue = showOther ? "Other" : value;
  return (
    <Field label={`${label} (optional)`}>
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
        placeholder="Select"
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

// Installs / Monthly Active Users field — a range picker first (so most
// sellers can answer in one tap without guessing an exact figure), then a
// plain number input scoped to whichever bucket was picked, so the value
// actually saved is always a real number the seller typed, never a
// midpoint/guess derived from the bucket. "10,000+" has no upper bound.
const STAT_BUCKETS = [
  { label: "Under 100", min: 0, max: 99 },
  { label: "101 – 500", min: 101, max: 500 },
  { label: "501 – 1,000", min: 501, max: 1000 },
  { label: "1,001 – 5,000", min: 1001, max: 5000 },
  { label: "5,001 – 9,999", min: 5001, max: 9999 },
  { label: "10,000+", min: 10000, max: null },
];
function bucketForValue(v: string): string {
  const n = parseFloat(v);
  if (!v || isNaN(n)) return "";
  const b = STAT_BUCKETS.find((b) => n >= b.min && (b.max === null || n <= b.max));
  return b ? b.label : "";
}
function RangeStatField({
  label,
  value,
  onChange,
  accent,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  accent: string;
  placeholder?: string;
}) {
  const [bucket, setBucket] = useState(() => bucketForValue(value));
  const activeBucket = STAT_BUCKETS.find((b) => b.label === bucket);
  return (
    <Field label={label}>
      <Select
        value={bucket}
        onChange={(v) => {
          setBucket(v);
          // Clear any existing value that no longer fits the newly
          // picked bucket, so the number field re-prompts instead of
          // silently keeping a stale, out-of-range figure.
          const b = STAT_BUCKETS.find((b) => b.label === v);
          const n = parseFloat(value);
          if (b && (!value || isNaN(n) || n < b.min || (b.max !== null && n > b.max))) {
            onChange("");
          }
        }}
        options={STAT_BUCKETS.map((b) => b.label)}
        placeholder={placeholder || "Select a range"}
        accent={accent}
      />
      {bucket !== "" && (
        <input
          type="number"
          min={activeBucket?.min ?? 0}
          max={activeBucket?.max ?? undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={activeBucket?.max === null ? "e.g. 25000" : `${activeBucket?.min}–${activeBucket?.max}`}
          style={{ ...inputStyle, marginTop: 8 }}
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
  padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
};
const activeAmberStyle: React.CSSProperties = {
  background: "rgba(251,191,36,0.12)", color: ACCENT, boxShadow: "0 0 0 1px rgba(251,191,36,0.2)",
};
const platformToggleStyle: React.CSSProperties = {
  padding: "12px 10px", border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)",
  borderRadius: 10, fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.5)", cursor: "pointer",
};
function notLiveBtnStyle(active: boolean): React.CSSProperties {
  return {
    padding: "5px 10px", fontSize: 11, fontWeight: 700, borderRadius: 8, cursor: "pointer",
    background: active ? "rgba(251,191,36,0.15)" : "rgba(255,255,255,0.05)",
    color: active ? ACCENT : "rgba(255,255,255,0.4)",
    border: `1px solid ${active ? "rgba(251,191,36,0.3)" : "rgba(255,255,255,0.1)"}`,
  };
}
const sectionLabelStyle: React.CSSProperties = {
  display: "block", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "rgba(255,255,255,0.5)", marginBottom: 10,
};
const fieldLabelStyle: React.CSSProperties = {
  display: "block", fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.5)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em",
};
const inputStyle: React.CSSProperties = {
  width: "100%", height: 44, padding: "0 14px", background: "#09090b", border: "1px solid rgba(255,255,255,0.28)",
  borderRadius: 8, fontSize: 14, color: "#fff", outline: "none", fontFamily: "inherit", boxSizing: "border-box",
};
const fileTagStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8, padding: "5px 10px", fontSize: 11.5, color: "rgba(255,255,255,0.75)",
};
const nextBtnStyle: React.CSSProperties = {
  flex: 1, width: "100%", height: 48, background: ACCENT, color: "#09090b", border: "none", borderRadius: 10,
  fontSize: 14, fontWeight: 800, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.04em",
};
const prevBtnStyle: React.CSSProperties = {
  height: 48, padding: "0 24px", background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.7)",
  border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer",
};
