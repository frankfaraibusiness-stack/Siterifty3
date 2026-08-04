"use client";

// Ports the edit-listing modal from Js/sellers-transfer.js (lines 168-562,
// #editListingOverlay + window.__openEditListingModal/__closeEditListingModal).
// This was previously routed to /sell as a placeholder (see MyProfileHub's
// old "Listing editing isn't wired up yet" toast) — this is the real thing.
//
// Field-for-field mirror of the original: title/description (with the same
// char-count validation as the create forms), URL (hidden for app listings,
// skipped entirely for templates — matches _handleSave's `type !== 'app' &&
// !isTemplate` gate), category, tech fields (frontend/backend/database/
// monetization — relabeled to Platform/Genre for games, same as
// _applySectionVisibility), financials with a live profit readout, transfer
// methods checklist, and an image grid (existing images shown by URL,
// replaceable one at a time — newly-picked files upload to Imgur on save,
// untouched slots keep their existing URL). Delete is a separate destructive
// action in the footer, gated behind a confirm dialog exactly like the
// original's srfModal.confirm.
//
// Unlike the original (a single global overlay reused across listings via
// window.__openEditListingModal(id)), this is a React modal driven by
// EditListingModalProvider — same pattern as BoostModalProvider/
// WalletModalProvider. Any component reaches it via
// useEditListingModal().openEdit(listingId).
//
// listing.update already supports every field this form sends (see
// handleUpdate in app/api/listings/_handler.js) — no server-side change
// was needed.
//
// Markup uses the #editListingOverlay / .el-* class system already defined
// in app/globals.css (ported from the original's own stylesheet) instead of
// one-off inline styles — this is the gold-accent themed look the original
// modal actually had, and keeps this component visually consistent with the
// rest of the app's CSS-driven modals rather than diverging from it.

import React, { useEffect, useState } from "react";
import { fetchListingById, updateListing, type Listing } from "@/lib/listings";
import { useAuth } from "@/lib/AuthContext";
import { useLimits } from "@/lib/useLimits";
import { resolveEmbedUrl } from "@/lib/embedUrl";
import AssetIframe from "./AssetIframe";

const IMGUR_CLIENT_ID = "891e5bb4aa94282";

// Fallback limits — used only until useLimits() resolves live values from
// GET /api/limits (app/api/_lib/limits.js's LIMITS.listing). Same numbers
// as that source (title 3-99 chars, desc 100-5000 chars), kept here as the
// initial/degrade-on-failure state rather than a permanent hardcode.
const FALLBACK_TITLE_MIN = 3;
const FALLBACK_TITLE_MAX = 99;
const FALLBACK_DESC_MIN = 100;
const FALLBACK_DESC_MAX = 5000;

const TRANSFER_OPTIONS = [
  { value: "escrow_migration", label: "Escrow-Protected Migration" },
  { value: "store_account_handover", label: "Store Account Handover" },
  { value: "source_files", label: "Source Files / Full Handover" },
  { value: "domain_push", label: "Domain Push (Registrar Transfer)" },
  { value: "site_archive", label: "Full Site Archive (Files + Database)" },
  { value: "hosting_handover", label: "Hosting Account Handover" },
  { value: "cpanel", label: "cPanel / Control Panel Access" },
  { value: "database_export", label: "Database Export (.sql)" },
  { value: "repo_transfer", label: "GitHub / GitLab Repository Transfer" },
  { value: "site_builder_transfer", label: "Site Builder Transfer" },
  { value: "build_transfer", label: "Signed Build Transfer (APK/AAB/IPA)" },
  { value: "console_store_code", label: "Console Store Code" },
  { value: "steam_key_transfer", label: "Steam Key / CD Key Transfer" },
  { value: "account_handover", label: "Player Account Handover" },
  { value: "direct_download", label: "Direct Build Transfer" },
  { value: "ftp_credentials", label: "FTP/SFTP Credentials" },
  { value: "other", label: "Other (confirm details in chat)" },
];

const TYPE_LABEL: Record<string, string> = { website: "Website", app: "App", game: "Game", "3d": "3D Asset" };

// Mirrors AssetListingForm.tsx's own option sets exactly — 3D Assets don't
// share Category/Format/License with any other listing type.
const ASSET_CATEGORY_OPTIONS = ["Character", "Environment", "Prop / Object", "Vehicle", "Architecture", "Weapon", "Animal / Creature", "Rigged / Animated", "VFX Asset", "Other"];
const ASSET_FORMAT_OPTIONS = [".fbx", ".obj", ".gltf / .glb", ".blend", ".max", ".c4d", ".usd / .usdz", ".stl", "Multiple formats", "Other"];
const ASSET_LICENSE_OPTIONS = ["Personal use only", "Commercial use", "Royalty-free", "Extended / Resale rights", "Exclusive (one buyer only)", "Other"];

interface ImageSlotState {
  url?: string;
  file?: File;
  dataUrl?: string;
}

async function uploadToImgur(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("image", file);
  const res = await fetch("https://api.imgur.com/3/image", {
    method: "POST",
    headers: { Authorization: `Client-ID ${IMGUR_CLIENT_ID}` },
    body: fd,
  });
  const json = await res.json();
  if (!json.success) throw new Error("Image upload failed. Please try again.");
  return json.data.link;
}

export default function EditListingModal({
  open,
  onClose,
  listingId,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  listingId: string | null;
  onSaved?: (listing: Listing) => void;
  onDeleted?: (listingId: string) => void;
}) {
  const { user } = useAuth();
  const { limits } = useLimits();

  const TITLE_MIN = limits.listing.titleMinLength ?? FALLBACK_TITLE_MIN;
  const TITLE_MAX = limits.listing.titleMaxLength ?? FALLBACK_TITLE_MAX;
  const DESC_MIN = limits.listing.descMinLength ?? FALLBACK_DESC_MIN;
  const DESC_MAX = limits.listing.descMaxLength ?? FALLBACK_DESC_MAX;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [listing, setListing] = useState<Listing | null>(null);

  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [url, setUrl] = useState("");
  const [category, setCategory] = useState("");
  const [frontend, setFrontend] = useState("");
  const [backend, setBackend] = useState("");
  const [database, setDatabase] = useState("");
  const [monetization, setMonetization] = useState("");
  const [price, setPrice] = useState("");
  const [revenue, setRevenue] = useState("");
  const [expenses, setExpenses] = useState("");
  const [transferMethods, setTransferMethods] = useState<string[]>([]);
  const [images, setImages] = useState<ImageSlotState[]>([]);

  // 3D Asset listings only — separate from the website/app/game state above
  // since this type has its own fields (no images, no URL, no transfer
  // methods; embed preview + format/license instead).
  const [assetEmbedMode, setAssetEmbedMode] = useState<"link" | "code">("link");
  const [assetEmbedValue, setAssetEmbedValue] = useState("");
  const [assetFormat, setAssetFormat] = useState("");
  const [assetLicense, setAssetLicense] = useState("");

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Load the listing fresh each time the modal opens for a (possibly
  // different) listing — mirrors the original's _loadListing.
  useEffect(() => {
    if (!open || !listingId) return;
    setLoading(true);
    setLoadError("");
    setErrMsg("");
    setSuccessMsg(false);
    setConfirmingDelete(false);
    (async () => {
      const l = await fetchListingById(listingId).catch(() => null);
      if (!l) {
        setLoadError("Could not load this listing. Please try again.");
        setLoading(false);
        return;
      }
      setListing(l);
      setTitle(l.title || "");
      setDesc(l.description || "");
      setUrl(l.url && l.url !== "[TEMPLATE]" ? l.url : "");
      setCategory(l.category || l.settings?.category || "");
      setFrontend(l.tech?.frontend || "");
      setBackend(l.tech?.backend || "");
      setDatabase(l.tech?.database || "");
      setMonetization(l.tech?.monetization || "");
      setPrice(l.financials?.price != null ? String(l.financials.price) : "");
      setRevenue(l.financials?.revenue != null ? String(l.financials.revenue) : "");
      setExpenses(l.financials?.expenses != null ? String(l.financials.expenses) : "");
      setTransferMethods(l.transferMethods || []);
      // 3D Asset listings only.
      setAssetEmbedMode("link");
      setAssetEmbedValue(l.embedUrl || "");
      setAssetFormat(l.settings?.format || "");
      setAssetLicense(l.settings?.license || "");
      const existing = l.images || [];
      const slotCount = l.type === "app" ? Math.max(existing.length, 3) : 3;
      const slots: ImageSlotState[] = existing.slice(0, Math.max(slotCount, existing.length)).map((u) => ({ url: u }));
      while (slots.length < slotCount) slots.push({});
      setImages(slots);
      setLoading(false);
    })();
  }, [open, listingId]);

  if (!open) return null;

  const type = listing?.type || "website";
  const isGame = type === "game";
  const isApp = type === "app";
  const isWebsite = type === "website";
  const is3d = type === "3d";
  const profit = (parseFloat(revenue) || 0) - (parseFloat(expenses) || 0);
  const resolvedAssetEmbed = assetEmbedValue.trim() ? resolveEmbedUrl(assetEmbedMode, assetEmbedValue) : null;

  function onPickImage(idx: number, file: File) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      setImages((prev) => {
        const next = [...prev];
        next[idx] = { file, dataUrl: ev.target?.result as string };
        return next;
      });
    };
    reader.readAsDataURL(file);
  }

  function toggleTransfer(value: string) {
    setTransferMethods((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  async function handleSave() {
    if (!listingId || !listing) return;
    setErrMsg("");
    setSuccessMsg(false);

    const t = title.trim();
    const d = desc.trim();
    if (t.length < TITLE_MIN || t.length > TITLE_MAX) {
      setErrMsg(`Title must be between ${TITLE_MIN} and ${TITLE_MAX} characters (currently ${t.length}).`);
      return;
    }
    if (d.length < DESC_MIN || d.length > DESC_MAX) {
      setErrMsg(`Description must be between ${DESC_MIN} and ${DESC_MAX} characters (currently ${d.length}).`);
      return;
    }
    const trimmedUrl = url.trim();
    if (type !== "app" && !listing.isTemplate) {
      if (!trimmedUrl || !/^https?:\/\/.+/.test(trimmedUrl)) {
        setErrMsg("Please provide a valid URL starting with https://.");
        return;
      }
    }
    if (!user) {
      setErrMsg("You must be logged in to edit this listing.");
      return;
    }

    setSaving(true);
    try {
      const finalImages: string[] = [];
      for (const slot of images) {
        if (slot.file) finalImages.push(await uploadToImgur(slot.file));
        else if (slot.url) finalImages.push(slot.url);
      }

      const idToken = await user.getIdToken();
      const priceVal = parseFloat(price);
      const revenueVal = parseFloat(revenue);
      const expensesVal = parseFloat(expenses);

      await updateListing({
        idToken,
        listingId,
        title: t,
        description: d,
        url: type === "app" ? undefined : listing.isTemplate ? "[TEMPLATE]" : trimmedUrl,
        images: finalImages,
        category: category.trim() || undefined,
        tech: {
          frontend: frontend.trim(),
          backend: backend.trim(),
          database: database.trim(),
          monetization: monetization.trim(),
        },
        settings: { category: category.trim() || listing.settings?.category || "" },
        financials: {
          price: Number.isFinite(priceVal) ? priceVal : null,
          revenue: Number.isFinite(revenueVal) ? revenueVal : null,
          expenses: Number.isFinite(expensesVal) ? expensesVal : null,
        },
        transferMethods,
      });

      setSuccessMsg(true);
      onSaved?.({
        ...listing,
        title: t,
        description: d,
        images: finalImages,
        category: category.trim() || listing.category,
      });
      setTimeout(() => onClose(), 900);
    } catch (err: any) {
      setErrMsg(err?.message || "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  // 3D Asset listings only — mirrors handleSave above but for this type's
  // much smaller field set: no URL, no images, no transfer methods; embed
  // preview + format/license instead. Kept as a fully separate function
  // rather than branching handleSave itself, since the two save paths
  // share almost nothing (different validation, different updateListing
  // payload shape).
  async function handleSave3d() {
    if (!listingId || !listing) return;
    setErrMsg("");
    setSuccessMsg(false);

    const t = title.trim();
    const d = desc.trim();
    if (t.length < TITLE_MIN || t.length > TITLE_MAX) {
      setErrMsg(`Title must be between ${TITLE_MIN} and ${TITLE_MAX} characters (currently ${t.length}).`);
      return;
    }
    if (d.length < DESC_MIN || d.length > DESC_MAX) {
      setErrMsg(`Description must be between ${DESC_MIN} and ${DESC_MAX} characters (currently ${d.length}).`);
      return;
    }
    if (!assetEmbedValue.trim() || !resolvedAssetEmbed) {
      setErrMsg(
        assetEmbedMode === "link"
          ? "Please provide a valid preview link (starting with https://)."
          : "Please paste a valid <iframe> embed snippet — we couldn't find a usable link in it."
      );
      return;
    }
    if (!user) {
      setErrMsg("You must be logged in to edit this listing.");
      return;
    }

    setSaving(true);
    try {
      const idToken = await user.getIdToken();
      const priceVal = parseFloat(price);

      await updateListing({
        idToken,
        listingId,
        title: t,
        description: d,
        category: category.trim() || undefined,
        settings: {
          category: category.trim() || listing.settings?.category || "",
          format: assetFormat,
          license: assetLicense,
        },
        embedCode: assetEmbedValue.trim(),
        financials: {
          price: Number.isFinite(priceVal) ? priceVal : null,
          revenue: null,
          expenses: null,
        },
      });

      setSuccessMsg(true);
      onSaved?.({
        ...listing,
        title: t,
        description: d,
        category: category.trim() || listing.category,
      });
      setTimeout(() => onClose(), 900);
    } catch (err: any) {
      setErrMsg(err?.message || "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!listingId || !user) return;
    setDeleting(true);
    try {
      const idToken = await user.getIdToken();
      const resp = await fetch("/api/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "listing.delete", idToken, listingId }),
      });
      const out = await resp.json().catch(() => ({}));
      if (!resp.ok || !out.ok) throw new Error(out.error?.message || "Delete failed");
      onDeleted?.(listingId);
      onClose();
    } catch {
      setErrMsg("Could not delete this listing. Please try again.");
      setConfirmingDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      id="editListingOverlay"
      className="visible"
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${TYPE_LABEL[type] || "Listing"}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div id="editListingPanel">
        <div className="el-header">
          <div className="el-header-left">
            <div className="el-type-badge">
              <svg viewBox="0 0 24 24">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z" />
              </svg>
            </div>
            <div className="el-header-text" style={{ minWidth: 0 }}>
              <h2>Edit {TYPE_LABEL[type] || "Listing"}</h2>
              <p style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {listing?.title || "Untitled listing"}
              </p>
            </div>
          </div>
          <div className="el-header-right">
            <button type="button" className="el-icon-btn" onClick={onClose} aria-label="Close">
              <svg viewBox="0 0 24 24">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <div className="el-body" data-scroll-lock-exempt>
          {loading ? (
            <div className="el-loading">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}>
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              Loading listing…
            </div>
          ) : loadError ? (
            <div className="el-error" style={{ display: "flex", alignItems: "center" }}>{loadError}</div>
          ) : (
            <>
              <div className="el-field">
                <label>
                  Title <span style={{ color: "#f87171" }}>*</span>
                </label>
                <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
                <CharCount value={title} min={TITLE_MIN} max={TITLE_MAX} />
              </div>

              <div className="el-field">
                <label>
                  Description <span style={{ color: "#f87171" }}>*</span>
                </label>
                <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={5} />
                <CharCount value={desc} min={DESC_MIN} max={DESC_MAX} />
              </div>

              {is3d ? (
                <>
                  <div className="el-section">
                    <div className="el-section-title">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                        <path d="M12 2l8 4.5v11L12 22l-8-4.5v-11L12 2z" />
                        <path d="M12 22V12M20 6.5L12 12 4 6.5" />
                      </svg>
                      Live Preview
                    </div>
                    <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
                      <button
                        type="button"
                        className="el-cancel-btn"
                        style={assetEmbedMode === "link" ? { borderColor: "rgba(45,212,191,0.4)", color: "#2dd4bf" } : undefined}
                        onClick={() => setAssetEmbedMode("link")}
                      >
                        I have a link
                      </button>
                      <button
                        type="button"
                        className="el-cancel-btn"
                        style={assetEmbedMode === "code" ? { borderColor: "rgba(45,212,191,0.4)", color: "#2dd4bf" } : undefined}
                        onClick={() => setAssetEmbedMode("code")}
                      >
                        I have embed code
                      </button>
                    </div>
                    {assetEmbedMode === "link" ? (
                      <input
                        type="url"
                        value={assetEmbedValue}
                        onChange={(e) => setAssetEmbedValue(e.target.value)}
                        placeholder="https://sketchfab.com/models/xxxxx/embed"
                      />
                    ) : (
                      <textarea
                        value={assetEmbedValue}
                        onChange={(e) => setAssetEmbedValue(e.target.value)}
                        placeholder='<iframe src="https://sketchfab.com/models/xxxxx/embed" ...></iframe>'
                        rows={3}
                        style={{ fontFamily: "monospace", fontSize: 12.5 }}
                      />
                    )}
                    {resolvedAssetEmbed && (
                      <div style={{ marginTop: 10, aspectRatio: "16/9", background: "#08080d", borderRadius: 10, overflow: "hidden", border: "1px solid rgba(45,212,191,0.25)" }}>
                        <AssetIframe src={resolvedAssetEmbed} title={title || "3D asset preview"} interactive />
                      </div>
                    )}
                  </div>

                  <div className="el-field">
                    <label>Category</label>
                    <input type="text" value={category} onChange={(e) => setCategory(e.target.value)} list="el-asset-category-options" />
                    <datalist id="el-asset-category-options">
                      {ASSET_CATEGORY_OPTIONS.map((o) => <option key={o} value={o} />)}
                    </datalist>
                  </div>

                  <div className="el-grid-2">
                    <div className="el-field">
                      <label>File Format</label>
                      <input type="text" value={assetFormat} onChange={(e) => setAssetFormat(e.target.value)} list="el-asset-format-options" />
                      <datalist id="el-asset-format-options">
                        {ASSET_FORMAT_OPTIONS.map((o) => <option key={o} value={o} />)}
                      </datalist>
                    </div>
                    <div className="el-field">
                      <label>License</label>
                      <input type="text" value={assetLicense} onChange={(e) => setAssetLicense(e.target.value)} list="el-asset-license-options" />
                      <datalist id="el-asset-license-options">
                        {ASSET_LICENSE_OPTIONS.map((o) => <option key={o} value={o} />)}
                      </datalist>
                    </div>
                  </div>

                  <div className="el-field">
                    <label>Price (USD)</label>
                    <input type="number" min="0" value={price} onChange={(e) => setPrice(e.target.value)} />
                  </div>

                  {errMsg && <div className="el-error" style={{ display: "block" }}>{errMsg}</div>}
                  {successMsg && (
                    <div className="el-success" style={{ display: "flex" }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}>
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                      Changes saved.
                    </div>
                  )}
                </>
              ) : (
                <>
              {!isApp && (
                <div className="el-field">
                  <label>{isGame ? "Game URL (external link)" : "URL"}</label>
                  <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} disabled={listing?.isTemplate} />
                </div>
              )}

              {(isWebsite || isApp) && (
                <div className="el-field">
                  <label>Category</label>
                  <input type="text" value={category} onChange={(e) => setCategory(e.target.value)} />
                </div>
              )}

              <div className="el-grid-2">
                <div className="el-field">
                  <label>{isGame ? "Platform" : "Frontend"}</label>
                  <input type="text" value={frontend} onChange={(e) => setFrontend(e.target.value)} />
                </div>
                <div className="el-field">
                  <label>{isGame ? "Genre" : "Backend"}</label>
                  <input type="text" value={backend} onChange={(e) => setBackend(e.target.value)} />
                </div>
              </div>

              {!isGame && (
                <div className="el-field">
                  <label>Database</label>
                  <input type="text" value={database} onChange={(e) => setDatabase(e.target.value)} />
                </div>
              )}

              <div className="el-field">
                <label>Monetization</label>
                <input type="text" value={monetization} onChange={(e) => setMonetization(e.target.value)} />
              </div>

              <div className="el-section">
                <div className="el-section-title">
                  <svg viewBox="0 0 24 24">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <path d="m21 15-5-5L5 21" />
                  </svg>
                  Images
                </div>
                <div className="el-images">
                  {images.map((slot, i) => (
                    <label key={i} className="el-img-slot">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          e.target.value = "";
                          if (f) onPickImage(i, f);
                        }}
                      />
                      {slot.dataUrl || slot.url ? (
                        <img src={slot.dataUrl || slot.url} alt={`Image ${i + 1}`} />
                      ) : (
                        <div className="el-img-ph">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
                            <rect x="3" y="3" width="18" height="18" rx="2" />
                            <path d="M3 9h18M9 21V9" />
                          </svg>
                          <span>Add image</span>
                        </div>
                      )}
                      <div className="el-img-replace">Replace</div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="el-grid-3">
                <div className="el-field">
                  <label>Price (USD)</label>
                  <input type="number" min="0" value={price} onChange={(e) => setPrice(e.target.value)} />
                </div>
                <div className="el-field">
                  <label>Monthly Revenue (USD)</label>
                  <input type="number" min="0" value={revenue} onChange={(e) => setRevenue(e.target.value)} />
                </div>
                <div className="el-field">
                  <label>Monthly Expenses (USD)</label>
                  <input type="number" min="0" value={expenses} onChange={(e) => setExpenses(e.target.value)} />
                </div>
              </div>
              <div className="el-profit-box">
                <span className="el-profit-label">Monthly Profit (USD)</span>
                <span className={`el-profit-value${profit < 0 ? " loss" : ""}`}>
                  {profit < 0 ? "-" : ""}${Math.abs(profit).toLocaleString()}
                </span>
              </div>

              <div className="el-section">
                <div className="el-section-title">
                  <svg viewBox="0 0 24 24">
                    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                  </svg>
                  Transfer Methods
                </div>
                <div className="el-transfer-grid">
                  {TRANSFER_OPTIONS.map((o) => (
                    <label key={o.value} className="el-transfer-cb">
                      <input type="checkbox" checked={transferMethods.includes(o.value)} onChange={() => toggleTransfer(o.value)} />
                      {o.label}
                    </label>
                  ))}
                </div>
              </div>

              {errMsg && <div className="el-error" style={{ display: "block" }}>{errMsg}</div>}
              {successMsg && (
                <div className="el-success" style={{ display: "flex" }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}>
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  Changes saved.
                </div>
              )}
                </>
              )}
            </>
          )}
        </div>

        {!loading && !loadError && (
          <div className="el-footer">
            <div className="el-footer-inner">
              {confirmingDelete ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
                  <div style={{ fontSize: 12.5, color: "#f87171", textAlign: "center" }}>
                    This will permanently remove the listing. This cannot be undone.
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" className="el-cancel-btn" onClick={() => setConfirmingDelete(false)} disabled={deleting}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="el-save-btn"
                      style={{ background: "#dc2626", boxShadow: "none" }}
                      onClick={handleDelete}
                      disabled={deleting}
                    >
                      {deleting ? "Deleting…" : "Delete Listing"}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    className="el-icon-btn danger"
                    onClick={() => setConfirmingDelete(true)}
                    disabled={saving}
                    aria-label="Delete listing"
                    style={{ borderRadius: "1rem", width: "auto", padding: "0 0.9rem", fontSize: "0.82rem", fontWeight: 700 }}
                  >
                    Delete
                  </button>
                  <button type="button" className="el-cancel-btn" onClick={onClose} disabled={saving} style={{ marginLeft: "auto" }}>
                    Cancel
                  </button>
                  <button type="button" className="el-save-btn" onClick={is3d ? handleSave3d : handleSave} disabled={saving || successMsg}>
                    {saving ? "Saving…" : "Save Changes"}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CharCount({ value, min, max }: { value: string; min: number; max: number }) {
  const len = value.trim().length;
  const ok = len >= min && len <= max;
  return <div className="el-hint" style={{ color: ok ? undefined : "#f87171" }}>{len} / {max} characters (min {min})</div>;
}
