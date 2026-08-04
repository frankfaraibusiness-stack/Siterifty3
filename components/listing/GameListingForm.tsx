"use client";

// Ports Js/listing-form-game.js — the standalone game listing form
// (distinct from listing-form.js's website flow). Field-for-field
// mirror of the original 3-step modal:
//   Step 1 (Basics): 3 screenshots (2 portrait, 1 landscape — NO aspect-ratio
//     enforcement, unlike the website form's slots), game source (upload
//     HTML/CSS/JS build OR external link), title, description
//   Step 2 (Details): platform, genre, monetization, age, business
//     structure, reason (optional), transfer methods (at least 1 required)
//   Step 3 (Financials): price, monthly revenue, monthly expenses
//
// Game-build upload combines the uploaded .html/.css/.js files into one
// blob (CSS inlined in <style>, JS inlined in <script>) for local Test
// Play preview, then on submit uploads that same combined HTML to
// /api/storage (now wired — see app/api/storage/route.ts) exactly like
// the original's _uploadCombinedGameHtml.
//
// Draft save/restore uses localStorage (key: srf_draft_game). GitHub
// repo attach isn't ported yet elsewhere in this app, so attachedRepo
// is always sent as null.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { createListing, checkStoreLink } from "@/lib/listings";
import { aiStudioCall, aiPlanCap } from "@/lib/aiStudio";
import { useAiLengthPicker } from "@/lib/useAiLengthPicker";
import { useConfirm } from "@/lib/useConfirm";
import { useLimits } from "@/lib/useLimits";
import Select from "./shared/Select";
import TransferMethodPicker from "./shared/TransferMethodPicker";
import ProofUploader, { type ProofImage } from "./shared/ProofUploader";
import { GAME_TRANSFER_METHODS } from "./shared/transferMethods";
import { PLATFORM_META, type PlatformKey } from "./shared/platforms";
import PlatformPicker, { PlatformIcon } from "./shared/PlatformPicker";

const ACCENT = "#f59e0b";
const DRAFT_KEY = "srf_draft_game";

// Fallback limits — used only until useLimits() resolves live values from
// GET /api/limits (app/api/_lib/limits.js's LIMITS.listing). Same numbers
// as that source (title 3-99 chars, desc 100-5000 chars), kept here as the
// initial/degrade-on-failure state rather than a permanent hardcode.
const FALLBACK_TITLE_MIN = 3;
const FALLBACK_TITLE_MAX = 99;
const FALLBACK_DESC_MIN = 100;
const FALLBACK_DESC_MAX = 5000;

// A game's distribution platforms, independent of where its source/build
// lives (that's the separate Upload/Link "Game Source" step below). A
// game can be a browser game only, or it can also ship as a real app on
// the Play Store / App Store, on Steam, or as a direct desktop download —
// any combination. Reuses the same PLATFORM_META/installs+MAU pattern as
// AppListingForm so a "game that's also a store app" is captured properly
// instead of being forced into a single Android/Desktop/Both dropdown.
const GAME_PLATFORM_KEYS: PlatformKey[] = ["web", "ios", "android", "steam", "desktop"];

const GENRE_OPTIONS = ["Action", "Adventure", "RPG", "Shooter", "Strategy", "Simulation", "Sports", "Puzzle", "Other"];
const AGE_OPTIONS = ["< 3 months", "3–5 months", "6–11 months", "1+ year", "2+ years", "3+ years", "5+ years", "10+ years"];
const STRUCTURE_OPTIONS = ["Sole Proprietorship", "LLC", "Corporation", "Partnership", "Other"];
const GAME_MONETIZATION_OPTIONS = ["Premium (one-time purchase)", "Free-to-play + Ads", "In-app purchases", "Subscription", "DLC / Expansions", "Free / Not monetized", "Other"];

const SLOT_LABELS = ["Portrait 1", "Portrait 2", "Landscape 16:9"];

interface SlotImage {
  file: File;
  dataUrl: string;
}

interface Draft {
  step?: number;
  gameType?: "upload" | "link";
  url?: string;
  title?: string;
  desc?: string;
  platforms?: PlatformKey[];
  platformUrls?: Partial<Record<PlatformKey, string>>;
  genre?: string;
  monetization?: string;
  reason?: string;
  price?: string;
  revenue?: string;
  expenses?: string;
  age?: string;
  structure?: string;
  transferMethods?: string[];
  monthlyVisits?: string;
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

// Combines uploaded html/css/js files into one playable HTML blob —
// mirrors _combineAndPreview exactly (CSS inlined in <style> before
// </head>, JS inlined in <script> before </body>).
function combineGameFiles(files: File[]): Promise<string> {
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
      : '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Game</title></head><body></body></html>';
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

export default function GameListingForm({ onBack }: { onBack?: () => void } = {}) {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { limits } = useLimits();

  const TITLE_MIN = limits.listing.titleMinLength ?? FALLBACK_TITLE_MIN;
  const TITLE_MAX = limits.listing.titleMaxLength ?? FALLBACK_TITLE_MAX;
  const DESC_MIN = limits.listing.descMinLength ?? FALLBACK_DESC_MIN;
  const DESC_MAX = limits.listing.descMaxLength ?? FALLBACK_DESC_MAX;

  const [step, setStep] = useState(1);

  // Clicking Continue/Back re-renders a completely different step, but
  // the page was staying scrolled wherever the user left off on the
  // previous step — so e.g. finishing step 2 scrolled near the bottom of
  // a long page, and step 3 then opened still scrolled down there instead
  // of at its own top. changeStep() replaces every direct setStep() call
  // so navigating between steps always lands back at the top of the form.
  function changeStep(n: number) {
    setStep(n);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  const [images, setImages] = useState<(SlotImage | null)[]>([null, null, null]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const targetIdxRef = useRef<number | null>(null);

  const [gameType, setGameType] = useState<"upload" | "link">("upload");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");

  // ── AI auto-description (ports gfmAutoGenBtn from ai-support-chat.js) ──
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

  const gameFileInputRef = useRef<HTMLInputElement>(null);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [combinedHtml, setCombinedHtml] = useState<string>("");
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);
  const [testPlayOpen, setTestPlayOpen] = useState(false);
  const [duplicateError, setDuplicateError] = useState("");

  // Distribution platforms — where the game can actually be played/bought,
  // separate from "Game Source" above (which is the build/link itself).
  // Defaults to Web selected since every uploaded/linked game is at least
  // playable in a browser; sellers add App Store/Play Store/Steam/Desktop
  // on top of that when the game also ships there.
  const [platforms, setPlatforms] = useState<Set<PlatformKey>>(new Set(["web"]));
  const [platformUrls, setPlatformUrls] = useState<Partial<Record<PlatformKey, string>>>({});
  // Installs + Monthly Active Users — required once iOS/Android is
  // selected as a live distribution platform, same reasoning as the App
  // form: that's the only way a buyer can sanity-check store traction.
  const [platformStats, setPlatformStats] = useState<Record<"ios" | "android", { installs: string; mau: string }>>({
    ios: { installs: "", mau: "" },
    android: { installs: "", mau: "" },
  });
  const [genre, setGenre] = useState("");
  const [monetization, setMonetization] = useState("");
  const [age, setAge] = useState("");
  const [structure, setStructure] = useState("");
  const [reason, setReason] = useState("");
  const [transferMethods, setTransferMethods] = useState<string[]>([]);

  const [price, setPrice] = useState("");
  const [revenue, setRevenue] = useState("");
  const [expenses, setExpenses] = useState("");
  const [saleType, setSaleType] = useState<"fixed" | "auction">("fixed");
  const [auctionStartPrice, setAuctionStartPrice] = useState("");
  const [auctionStartTime, setAuctionStartTime] = useState("");
  const [auctionEndTime, setAuctionEndTime] = useState("");
  // Proof of the claimed monthly revenue — required whenever revenue > 0.
  const [revenueProof, setRevenueProof] = useState<ProofImage[]>([]);
  // Optional traffic claim (for browser-playable games) + its supporting
  // analytics screenshots — required the moment a visits number is entered.
  const [monthlyVisits, setMonthlyVisits] = useState("");
  const [trafficProof, setTrafficProof] = useState<ProofImage[]>([]);

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
          msg: "You have a saved draft for a game listing. Restore it?",
          confirmText: "Restore",
          cancelText: "Discard",
        });
        if (!ok) {
          localStorage.removeItem(DRAFT_KEY);
          return;
        }
        const d: Draft = JSON.parse(raw);
        if (d.gameType) setGameType(d.gameType);
        if (d.url) setUrl(d.url);
        if (d.title) setTitle(d.title);
        if (d.desc) setDesc(d.desc);
        if (d.platforms?.length) setPlatforms(new Set(d.platforms));
        if (d.platformUrls) setPlatformUrls(d.platformUrls);
        if (d.genre) setGenre(d.genre);
        if (d.monetization) setMonetization(d.monetization);
        if (d.reason) setReason(d.reason);
        if (d.price) setPrice(d.price);
        if (d.revenue) setRevenue(d.revenue);
        if (d.expenses) setExpenses(d.expenses);
        if (d.age) setAge(d.age);
        if (d.structure) setStructure(d.structure);
        if (d.transferMethods?.length) setTransferMethods(d.transferMethods);
        if (d.monthlyVisits) setMonthlyVisits(d.monthlyVisits);
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
        step: nextStep, gameType, url, title, desc,
        platforms: Array.from(platforms), platformUrls, genre, monetization,
        reason, price, revenue, expenses, age, structure, transferMethods, monthlyVisits,
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
    return [url, title, desc, price, revenue, expenses].some((v) => v.trim().length > 0) || uploadedFiles.length > 0;
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
    if (previewBlobUrl) URL.revokeObjectURL(previewBlobUrl);
    if (onBack) onBack();
    else router.push("/marketplace");
  }

  // ── Screenshot slots (no aspect-ratio enforcement, unlike website form) ──
  function openSlotPicker(idx: number) {
    targetIdxRef.current = idx;
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  }

  function readImageFile(file: File, idx: number) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
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
    readImageFile(f, idx);
  }

  function removeImage(idx: number) {
    setImages((prev) => {
      const next = [...prev];
      next[idx] = null;
      return next;
    });
  }

  // ── Game build upload (html/css/js) ──
  async function handleGameFiles(fileList: FileList | File[]) {
    setDuplicateError("");
    const allowed = [".html", ".htm", ".css", ".js"];
    let valid = Array.from(fileList).filter((f) => allowed.includes("." + f.name.split(".").pop()!.toLowerCase()));
    if (valid.length === 0) {
      setErrors((e) => ({ ...e, upload: "Please upload HTML, CSS, or JS files." }));
      return;
    }
    const htmlFiles = valid.filter((f) => /\.html?$/i.test(f.name));
    if (htmlFiles.length > 1) {
      setDuplicateError("Only one HTML file allowed.");
      valid = valid.filter((f) => !/\.html?$/i.test(f.name) || f === htmlFiles[0]);
    }
    const names = valid.map((f) => f.name);
    if (new Set(names).size !== names.length) {
      setDuplicateError("Duplicate file names detected.");
      const seen = new Set<string>();
      valid = valid.filter((f) => {
        if (seen.has(f.name)) return false;
        seen.add(f.name);
        return true;
      });
    }
    if (valid.length === 0) return;
    setErrors((e) => ({ ...e, upload: "" }));
    setUploadedFiles(valid);
    const finalHtml = await combineGameFiles(valid);
    setCombinedHtml(finalHtml);
    if (previewBlobUrl) URL.revokeObjectURL(previewBlobUrl);
    const blob = new Blob([finalHtml], { type: "text/html" });
    setPreviewBlobUrl(URL.createObjectURL(blob));
  }

  function removeGameFiles() {
    setUploadedFiles([]);
    setCombinedHtml("");
    setDuplicateError("");
    if (previewBlobUrl) {
      URL.revokeObjectURL(previewBlobUrl);
      setPreviewBlobUrl(null);
    }
  }

  // ── Validation ──
  function clearAllErrors() {
    setErrors({});
  }

  function validateStep1(): boolean {
    clearAllErrors();
    const filled = images.filter(Boolean);
    if (filled.length !== 3) {
      setErrors({ img: "Please upload all 3 images (2 portrait + 1 landscape) before continuing." });
      return false;
    }
    if (gameType === "upload") {
      if (uploadedFiles.length === 0 || !combinedHtml) {
        setErrors({ upload: "Please upload your game files (must include an HTML file)." });
        return false;
      }
    } else {
      const urlVal = url.trim();
      if (!urlVal) {
        setErrors({ upload: "Please enter a game URL." });
        return false;
      }
      if (!/^https?:\/\/.+/.test(urlVal)) {
        setErrors({ upload: "Please enter a valid URL starting with https://." });
        return false;
      }
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
    if (platforms.size === 0) {
      setErrors({ details: "Please select at least one platform this game is available on." });
      return false;
    }
    if (!genre) {
      setErrors({ details: "Please select a Genre." });
      return false;
    }
    for (const p of platforms) {
      if (p === "web") continue; // web's URL is the game source itself, not a separate field
      const u = (platformUrls[p] || "").trim();
      if (!u || !isValidUrl(u)) {
        setErrors({ details: `Please enter a valid ${PLATFORM_META[p].urlLabel} for ${PLATFORM_META[p].label}.` });
        return false;
      }
      if (p === "ios" || p === "android") {
        const stats = platformStats[p];
        if (!stats.installs.trim() || isNaN(parseFloat(stats.installs)) || parseFloat(stats.installs) < 0) {
          setErrors({ details: `Please enter a valid install count for ${PLATFORM_META[p].label}.` });
          return false;
        }
        if (!stats.mau.trim() || isNaN(parseFloat(stats.mau)) || parseFloat(stats.mau) < 0) {
          setErrors({ details: `Please enter valid Monthly Active Users for ${PLATFORM_META[p].label}.` });
          return false;
        }
      }
    }
    if (!monetization.trim()) {
      setErrors({ details: "Please enter how this game is monetized." });
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

  function togglePlatform(p: PlatformKey) {
    setPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }
  function setPlatformUrl(p: PlatformKey, v: string) {
    setPlatformUrls((prev) => ({ ...prev, [p]: v }));
  }
  function setPlatformStat(p: "ios" | "android", field: "installs" | "mau", v: string) {
    setPlatformStats((prev) => ({ ...prev, [p]: { ...prev[p], [field]: v } }));
  }

  function isValidUrl(u: string): boolean {
    try {
      new URL(u);
      return true;
    } catch {
      return false;
    }
  }

  async function handleSubmit() {
    clearAllErrors();
    setSubmitError("");

    const filled = images.filter(Boolean);
    if (filled.length !== 3) {
      changeStep(1);
      setErrors({ img: "Please upload exactly 3 images (2 portrait + 1 landscape)." });
      return;
    }
    let gameUrl: string | null = null;
    if (gameType === "upload") {
      if (!combinedHtml) {
        changeStep(1);
        setErrors({ upload: "Please upload your game files." });
        return;
      }
    } else {
      gameUrl = url.trim();
      if (!gameUrl || !/^https?:\/\/.+/.test(gameUrl)) {
        changeStep(1);
        setErrors({ upload: "Please enter a valid game URL." });
        return;
      }
    }
    if (!validateStep2()) {
      changeStep(2);
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
      setErrors({ fin: "Please upload at least one screenshot proving your claimed monthly revenue (e.g. Steam, App Store Connect, Play Console, or Stripe dashboard)." });
      return;
    }
    const visitsNum = parseFloat(monthlyVisits) || 0;
    if (monthlyVisits.trim() && visitsNum > 0 && trafficProof.length === 0) {
      setErrors({ fin: "Please upload at least one analytics screenshot to support your monthly visits number." });
      return;
    }
    if (!user) {
      setSubmitError("You must be logged in to list.");
      return;
    }

    setSubmitting(true);
    try {
      setProgress({ pct: 0, label: "Uploading screenshots…" });
      const imgUrls: string[] = [];
      for (let i = 0; i < 3; i++) {
        const imgFile = images[i]!.file;
        const uploadedUrl = await uploadToImgur(imgFile);
        imgUrls.push(uploadedUrl);
        setProgress({ pct: Math.round(((i + 1) / 3) * 50), label: `Uploading screenshot ${i + 1} of 3…` });
      }

      const idToken = await user.getIdToken();

      if (gameType === "upload") {
        setProgress({ pct: 60, label: "Uploading game build…" });
        gameUrl = await uploadTextToStorage("game.html", combinedHtml, idToken);
      }

      let revenueProofUrls: string[] = [];
      if (revenueProof.length > 0) {
        setProgress({ pct: 68, label: "Uploading revenue proof…" });
        for (const img of revenueProof) revenueProofUrls.push(await uploadToImgur(img.file));
      }
      let trafficProofUrls: string[] = [];
      if (trafficProof.length > 0) {
        setProgress({ pct: 72, label: "Uploading traffic proof…" });
        for (const img of trafficProof) trafficProofUrls.push(await uploadToImgur(img.file));
      }

      setProgress({ pct: 78, label: "Saving listing to marketplace…" });

      const platformLabel = Array.from(platforms).map((p) => PLATFORM_META[p].label).join(", ");

      const { listingId } = await createListing({
        idToken,
        type: "game",
        gameType,
        url: gameUrl,
        title: title.trim(),
        description: desc.trim(),
        images: imgUrls,
        category: "Game",
        tech: { frontend: platformLabel, backend: genre, database: "", monetization },
        settings: { category: "Game", age: age || "", location: "", structure: structure || "", reason: reason || "" },
        platforms: {
          selected: Array.from(platforms),
          iosUrl: platforms.has("ios") ? (platformUrls.ios || "").trim() : null,
          androidUrl: platforms.has("android") ? (platformUrls.android || "").trim() : null,
          webUrl: null,
          steamUrl: platforms.has("steam") ? (platformUrls.steam || "").trim() : null,
          desktopUrl: platforms.has("desktop") ? (platformUrls.desktop || "").trim() : null,
          stats: {
            ios: platforms.has("ios")
              ? { installs: parseFloat(platformStats.ios.installs) || 0, mau: parseFloat(platformStats.ios.mau) || 0 }
              : undefined,
            android: platforms.has("android")
              ? { installs: parseFloat(platformStats.android.installs) || 0, mau: parseFloat(platformStats.android.mau) || 0 }
              : undefined,
          },
        },
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
      clearDraft();

      // Best-effort, non-blocking plausibility check — only makes sense
      // when the seller supplied their own external link (gameType ===
      // "link"); an "upload" game's URL is a storage link we generated
      // ourselves, so there's nothing external to check. See the identical
      // pattern/comment in AppListingForm.tsx.
      if (gameType === "link" && gameUrl) {
        checkStoreLink({ idToken, listingId, url: gameUrl }).catch(() => {});
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
      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onFileInputChange} />
      <input
        ref={gameFileInputRef}
        type="file"
        accept=".html,.htm,.css,.js"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files?.length) handleGameFiles(e.target.files);
          e.target.value = "";
        }}
      />

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
            Siterifty<span style={{ color: "rgba(245,158,11,0.55)" }}>.com</span>
          </div>
        </div>
        <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: ACCENT }}>
          Game Listing
        </span>
      </header>

      <div style={{ maxWidth: 820, margin: "0 auto", padding: "28px 16px 80px" }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 6 }}>
          List a <em style={{ fontStyle: "normal", color: "rgba(245,158,11,0.85)" }}>Game</em>
        </h1>
        <p style={{ fontSize: 14, color: "rgba(255,255,255,0.4)", marginBottom: 28 }}>
          Showcase your game with screenshots, upload your build, or link an external page — then set your price.
        </p>

        {/* Step tabs */}
        <div style={{ display: "flex", gap: 8, margin: "0 0 20px", borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: 12 }}>
          {["1. Basics", "2. Details", "3. Financials"].map((label, i) => (
            <button
              key={label}
              onClick={() => goToStep(i + 1)}
              style={{
                background: step === i + 1 ? "rgba(245,158,11,0.1)" : "none",
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
              {SLOT_LABELS.map((label, idx) => (
                <ImageSlot
                  key={idx}
                  image={images[idx]}
                  label={label}
                  landscape={idx === 2}
                  onClick={() => openSlotPicker(idx)}
                  onRemove={() => removeImage(idx)}
                />
              ))}
            </div>
            {errors.img && <ErrorBox>{errors.img}</ErrorBox>}

            <span style={sectionLabelStyle}>Game Source</span>
            <div style={{ display: "flex", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: 4, marginBottom: 16, gap: 4 }}>
              <button
                onClick={() => setGameType("upload")}
                style={{ ...typeBtnStyle, ...(gameType === "upload" ? activeAmberStyle : {}) }}
              >
                Upload Build
              </button>
              <button
                onClick={() => setGameType("link")}
                style={{ ...typeBtnStyle, ...(gameType === "link" ? activeAmberStyle : {}) }}
              >
                External Link
              </button>
            </div>

            {gameType === "upload" ? (
              <div style={{ marginBottom: 20 }}>
                <div
                  onClick={() => gameFileInputRef.current?.click()}
                  style={{
                    border: `2px dashed ${uploadedFiles.length ? "rgba(245,158,11,0.4)" : "rgba(255,255,255,0.15)"}`,
                    borderRadius: 14,
                    padding: 24,
                    textAlign: "center",
                    cursor: "pointer",
                    background: "rgba(255,255,255,0.02)",
                  }}
                >
                  <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", marginBottom: 8 }}>
                    {uploadedFiles.length
                      ? `${uploadedFiles.length} file${uploadedFiles.length > 1 ? "s" : ""} selected — click to add more`
                      : "Click or drag to upload your game (.html, .css, .js)"}
                  </div>
                  {uploadedFiles.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center", marginTop: 8 }}>
                      {uploadedFiles.map((f) => (
                        <span key={f.name} style={fileTagStyle}>{f.name}</span>
                      ))}
                    </div>
                  )}
                </div>
                {duplicateError && <ErrorBox>{duplicateError}</ErrorBox>}
                {errors.upload && <ErrorBox>{errors.upload}</ErrorBox>}
                {uploadedFiles.length > 0 && (
                  <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                    <button onClick={() => setTestPlayOpen(true)} style={testPlayBtnStyle}>▶ Test Play</button>
                    <button onClick={removeGameFiles} style={prevBtnStyle}>Remove Files</button>
                  </div>
                )}
              </div>
            ) : (
              <Field label="Game URL" required error={errors.upload}>
                <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/play" style={inputStyle} />
              </Field>
            )}

            <Field label="Title" required error={errors.title}>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="A short, catchy name for your game" style={inputStyle} />
              <CharCount value={title} min={TITLE_MIN} max={TITLE_MAX} />
            </Field>

            <Field label="Description" required error={errors.desc}>
              <textarea
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="Describe the gameplay, genre, and what's included in the sale…"
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
            <span style={sectionLabelStyle}>
              Platforms <span style={{ color: "#f87171" }}>*</span>
            </span>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", marginBottom: 10 }}>
              Select everywhere this game can be played. A browser game that&apos;s also on the Play Store or App Store should have both selected.
            </div>
            {errors.details && <ErrorBox>{errors.details}</ErrorBox>}
            <div style={{ marginBottom: 14 }}>
              <PlatformPicker
                keys={GAME_PLATFORM_KEYS}
                meta={PLATFORM_META}
                selected={platforms}
                onToggle={togglePlatform}
                accent={ACCENT}
              />
            </div>

            {GAME_PLATFORM_KEYS.filter((p) => p !== "web" && platforms.has(p)).map((p) => (
              <div key={p} style={{ marginBottom: 16, padding: 14, background: "rgba(255,255,255,0.03)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, display: "flex", alignItems: "center", gap: 7 }}>
                  <PlatformIcon platform={p} size={15} color="rgba(255,255,255,0.7)" />
                  {PLATFORM_META[p].label}
                </div>
                <input
                  type="url"
                  value={platformUrls[p] || ""}
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
            ))}

            <span style={sectionLabelStyle}>Details</span>
            <div className="sr-lf-row-2" style={{ marginBottom: 16 }}>
              <Field label="Genre">
                <Select value={genre} onChange={setGenre} options={GENRE_OPTIONS} accent={ACCENT} />
              </Field>
              <Field label="Game Age">
                <Select value={age} onChange={setAge} options={AGE_OPTIONS} accent={ACCENT} />
              </Field>
            </div>
            <SelectWithOther
              label="Monetization"
              required
              value={monetization}
              onChange={setMonetization}
              options={GAME_MONETIZATION_OPTIONS}
              accent={ACCENT}
            />

            <Field label="Business Structure">
              <Select value={structure} onChange={setStructure} options={STRUCTURE_OPTIONS} accent={ACCENT} />
            </Field>

            <Field label="Reason for selling (optional)">
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Moving to a new project, time constraints" style={inputStyle} />
            </Field>

            <span style={sectionLabelStyle}>
              Delivery Method <span style={{ color: "#f87171" }}>*</span>
            </span>
            {errors.transfer && <ErrorBox>{errors.transfer}</ErrorBox>}
            <div style={{ marginBottom: 24 }}>
              <TransferMethodPicker
                methods={GAME_TRANSFER_METHODS}
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

            {saleType === "auction" && (
              <div className="sr-lf-fin-card">
                <div className="sr-lf-row-3">
                  <Field label="Starting Price (USD)">
                    <div className="sr-lf-money">
                      <input type="number" min="0" value={auctionStartPrice} onChange={(e) => setAuctionStartPrice(e.target.value)} placeholder="10" style={inputStyle} />
                    </div>
                  </Field>
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

            <div className="sr-lf-fin-card" style={{ marginTop: saleType === "auction" ? 16 : 0 }}>
              <div className="sr-lf-row-3">
                {saleType === "fixed" && (
                  <Field label="Asking Price (USD)">
                    <div className="sr-lf-money">
                      <input type="number" min="0" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="1000" style={inputStyle} />
                    </div>
                  </Field>
                )}
                <Field label="Monthly Revenue (USD)">
                  <div className="sr-lf-money">
                    <input type="number" min="0" value={revenue} onChange={(e) => setRevenue(e.target.value)} placeholder="200" style={inputStyle} />
                  </div>
                </Field>
                <Field label="Monthly Expenses (USD)">
                  <div className="sr-lf-money">
                    <input type="number" min="0" value={expenses} onChange={(e) => setExpenses(e.target.value)} placeholder="20" style={inputStyle} />
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
                  Upload a screenshot of your Steam, App Store Connect, Play Console, or payment processor dashboard showing this revenue. Listings without proof can't be published.
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
                    Since you entered a visits number, upload 1–3 analytics screenshots (Google Analytics, Steam stats, or your host's dashboard) to back it up. <span style={{ color: "#f87171" }}>Required.</span>
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
              <div style={{ padding: 14, background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 10, color: ACCENT, fontWeight: 700, marginBottom: 16, textAlign: "center" }}>
                ✓ Published! Redirecting to the marketplace…
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

      {/* Test Play modal */}
      {testPlayOpen && previewBlobUrl && (
        <div
          onClick={() => setTestPlayOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,0.85)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 480, height: "80vh", background: "#000", borderRadius: 16, border: "1px solid rgba(245,158,11,0.3)", overflow: "hidden", position: "relative" }}>
            <button
              onClick={() => setTestPlayOpen(false)}
              style={{ position: "absolute", top: 10, right: 10, zIndex: 1, width: 32, height: 32, borderRadius: "50%", background: "rgba(0,0,0,0.7)", color: "#fff", border: "none", cursor: "pointer" }}
            >
              ✕
            </button>
            <iframe src={previewBlobUrl} sandbox="allow-scripts allow-same-origin" style={{ width: "100%", height: "100%", border: "none" }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared subcomponents ──

function ImageSlot({
  image,
  label,
  landscape,
  onClick,
  onRemove,
}: {
  image: SlotImage | null;
  label: string;
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
          <img src={image.dataUrl} alt={label} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
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
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, color: "rgba(255,255,255,0.25)", fontSize: 12, fontWeight: 500, textAlign: "center", padding: 8 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} style={{ width: 28, height: 28, opacity: 0.5 }}>
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

// Dropdown-of-presets + "Other" fallback text input — same pattern as
// TechField in WebsiteListingForm.tsx/AppListingForm.tsx, used here for
// Monetization since Game listings don't have separate Frontend/Backend/
// Database fields. `forcedOther` tracks an explicit "Other" pick since
// choosing it clears value to "", which can't be told apart from "nothing
// selected yet" by value alone.
function SelectWithOther({
  label,
  required,
  value,
  onChange,
  options,
  accent,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  accent: string;
}) {
  const isKnownPreset = options.includes(value);
  const [forcedOther, setForcedOther] = useState(value !== "" && !isKnownPreset);
  const showOther = forcedOther || (value !== "" && !isKnownPreset);
  const selectValue = showOther ? "Other" : value;
  return (
    <Field label={label} required={required}>
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

// Installs / Monthly Active Users field — range picker first, then a
// plain number input scoped to the picked bucket, so the saved value is
// always a real typed number, never a guessed midpoint. See
// AppListingForm.tsx's RangeStatField for the full rationale (same
// pattern, duplicated here since these are per-file helpers).
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  accent: string;
}) {
  const [bucket, setBucket] = useState(() => bucketForValue(value));
  const activeBucket = STAT_BUCKETS.find((b) => b.label === bucket);
  return (
    <Field label={label}>
      <Select
        value={bucket}
        onChange={(v) => {
          setBucket(v);
          const b = STAT_BUCKETS.find((b) => b.label === v);
          const n = parseFloat(value);
          if (b && (!value || isNaN(n) || n < b.min || (b.max !== null && n > b.max))) {
            onChange("");
          }
        }}
        options={STAT_BUCKETS.map((b) => b.label)}
        placeholder="Select a range"
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
  fontSize: 14,
  fontWeight: 700,
  color: "rgba(255,255,255,0.3)",
  cursor: "pointer",
};
const activeAmberStyle: React.CSSProperties = {
  background: "rgba(245,158,11,0.12)",
  color: ACCENT,
  boxShadow: "0 0 0 1px rgba(245,158,11,0.15)",
};
const platformToggleStyle: React.CSSProperties = {
  padding: "10px 8px",
  border: "1px solid rgba(255,255,255,0.1)",
  background: "rgba(255,255,255,0.03)",
  borderRadius: 10,
  fontSize: 12.5,
  fontWeight: 700,
  color: "rgba(255,255,255,0.5)",
  cursor: "pointer",
  textAlign: "center",
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
const testPlayBtnStyle: React.CSSProperties = {
  flex: 1,
  height: 44,
  background: "rgba(245,158,11,0.12)",
  color: ACCENT,
  border: "1px solid rgba(245,158,11,0.3)",
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
};
