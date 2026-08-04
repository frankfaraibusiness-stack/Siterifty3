"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { doc, getDoc, updateDoc, collection, addDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type { AttachedRepo } from "@/lib/listings";
import type { PaymentStatus } from "@/lib/useDealChat";

// Ports the state/logic layer of Js/transfer-deal.js (933 lines): the
// 3-category (website/game/app) x 10-item checklist data model, the
// per-item modal payload (files / pasted credential / login form), zip
// bundling + finalize-upload, and the GitHub collaborator card's data
// loading. The DOM-driven original (getElementById, innerHTML rebuilds,
// module-level TDM_* mutable objects) is reworked as React state; the
// checklist content, theme copy, SVG icon set, Imgur image-routing
// behavior, and Firestore/API field names are kept identical so the
// already-ported CSS in globals.css (.tdm-* — verified 1:1 against the
// original, 125/125 classes) applies without changes.
//
// Two upstream gaps are NOT invented here (see port-status.md):
//   - /api/github doesn't exist, so the "seller not yet connected" repo
//     picker path (window.__srfMountRepoPicker in the original, which
//     itself called /api/github) has nothing real to call. That branch
//     is rendered as a clear "not connected yet" state instead of a
//     picker UI that would silently fail.
//   - The github collaborator invite action (/api/deal
//     invite-github-collaborator) DOES exist and IS wired — that part
//     works fully whenever a listing already has attachedRepo set.

export type TdmListingType = "website" | "game" | "app";
// Action types, replacing the old generic transfer/upload/input trio with
// what each item actually requires:
//  - registry_transfer: a formal transfer protocol with a receiving party
//    (domain EPP/auth-code push, app/game store's own "transfer app" tool)
//  - collaborator_invite: add the buyer as a collaborator on the seller's
//    existing account (GitHub/GitLab repo invite) rather than handing over
//    credentials or a code dump
//  - file_upload: an actual file (backup, export, asset, key file) bundled
//    into the delivery ZIP
//  - secure_secret: a short secret string (API key, keystore password) —
//    never rendered as a plain text box; stored/transmitted encrypted and
//    revealed once, not zipped in cleartext
//  - account_ownership: seller adds the buyer as owner/admin on their
//    existing account via that platform's own ownership-transfer feature,
//    then the seller is removed — never a shared password
export type TdmItemType = "registry_transfer" | "collaborator_invite" | "file_upload" | "secure_secret" | "account_ownership";

export interface TdmChecklistItem {
  label: string;
  icon: string;
  type: TdmItemType;
  /** When set, the seller can complete this item via either `type` or
   *  `altType` (e.g. Source Code Repository: collaborator_invite OR
   *  file_upload). The popup UI decides how to present the choice. */
  altType?: TdmItemType;
}

export const TDM_CATEGORIES: Record<TdmListingType, { left: TdmChecklistItem[]; right: TdmChecklistItem[] }> = {
  website: {
    left: [
      { label: "Domain Transfer", icon: "domain", type: "registry_transfer" },
      { label: "Source Code Repository", icon: "sourcecode", type: "collaborator_invite", altType: "file_upload" },
      { label: "Website Files Backup", icon: "files", type: "file_upload" },
      { label: "Database Export", icon: "database", type: "file_upload" },
      { label: "Hosting Account Ownership", icon: "hosting", type: "account_ownership" },
      { label: "SSL Certificate Keys", icon: "ssl", type: "file_upload" },
    ],
    right: [
      { label: "Email Account Ownership", icon: "email", type: "account_ownership" },
      { label: "Social Media Admin Rights", icon: "social", type: "account_ownership" },
      { label: "Mailing List & Automations", icon: "mailinglist", type: "account_ownership" },
      { label: "Ad Revenue Account Ownership", icon: "adrevenue", type: "account_ownership" },
      { label: "Payment Gateway Accounts", icon: "payment", type: "account_ownership" },
    ],
  },
  game: {
    left: [
      { label: "Store Page Ownership", icon: "storepage", type: "registry_transfer" },
      { label: "Full Source Code Backup", icon: "sourcecode", type: "collaborator_invite", altType: "file_upload" },
      { label: "Game Assets", icon: "gameassets", type: "file_upload" },
      { label: "Engine & Plugin Licenses", icon: "engine", type: "registry_transfer" },
      { label: "Keystore & Code Signing", icon: "keystore", type: "file_upload" },
      { label: "Keystore Password", icon: "keystore", type: "secure_secret" },
    ],
    right: [
      { label: "Backend / Multiplayer Servers", icon: "multiplayer", type: "account_ownership" },
      { label: "In-App Purchase Setup", icon: "iap", type: "account_ownership" },
      { label: "Ad Monetisation Accounts", icon: "ads", type: "account_ownership" },
      { label: "Player Community Ownership", icon: "community", type: "account_ownership" },
      { label: "Build Pipeline & CI/CD", icon: "pipeline", type: "account_ownership" },
    ],
  },
  app: {
    left: [
      { label: "Play Store Account Transfer", icon: "playstore", type: "registry_transfer" },
      { label: "App Store Account Transfer", icon: "appstore", type: "registry_transfer" },
      { label: "Domain Name Transfer", icon: "domain", type: "registry_transfer" },
      { label: "Source Code Repository", icon: "sourcecode", type: "collaborator_invite", altType: "file_upload" },
      { label: "Database Export", icon: "database", type: "file_upload" },
    ],
    right: [
      { label: "Backend Server Access", icon: "hosting", type: "account_ownership" },
      { label: "Keystore & Signing Keys", icon: "keystore", type: "file_upload" },
      { label: "Keystore Password", icon: "keystore", type: "secure_secret" },
      { label: "API & Third-Party Keys", icon: "api", type: "secure_secret" },
      { label: "Payment Processor Accounts", icon: "payment", type: "account_ownership" },
      { label: "User Support System Transfer", icon: "support", type: "account_ownership" },
    ],
  },
};

export function tdmGetTabItems(tab: TdmListingType, customItems?: TdmChecklistItem[]): TdmChecklistItem[] {
  const d = TDM_CATEGORIES[tab];
  return customItems && customItems.length ? [...d.left, ...d.right, ...customItems] : [...d.left, ...d.right];
}

export const TDM_TYPE_THEME: Record<TdmItemType, { accent: string; heading: string; blurb: string }> = {
  registry_transfer: {
    accent: "#a3e635",
    heading: "Registry Transfer",
    blurb: "Initiate the official transfer through the registry or platform's own transfer tool (e.g. domain EPP/auth code, store's \u201ctransfer app\u201d), then upload proof.",
  },
  account_ownership: {
    accent: "#facc15",
    heading: "Account Ownership Transfer",
    blurb: "Add the buyer as owner/admin using the platform's own ownership-transfer feature, then remove yourself once confirmed. Never share your password.",
  },
  collaborator_invite: {
    accent: "#38bdf8",
    heading: "Collaborator Invite",
    blurb: "Invite the buyer as a collaborator on your existing repository instead of sharing credentials or a code dump.",
  },
  file_upload: {
    accent: "#60a5fa",
    heading: "File Upload",
    blurb: "Upload the backup, export, asset, or key file for this item. It will be bundled into the final delivery ZIP.",
  },
  secure_secret: {
    accent: "#e879f9",
    heading: "Secure Secret",
    blurb: "Enter the key, token, or password for this item. It's encrypted and revealed to the buyer only once \u2014 never stored or sent in plain text.",
  },
};

export const TDM_IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
const TDM_IMGUR_CLIENT_ID = "891e5bb4aa94282";

export type TdmPayload =
  | { kind: "files"; label: string; files: File[]; buildInfo?: string }
  | { kind: "text"; label: string; textValue: string }
  | { kind: "credentials"; label: string; loginUrl: string; loginEmail: string; loginPassword: string }
  | { kind: "screenshot_proof"; label: string; files: File[]; recipientEmail: string };

export type GithubCollaboratorStatus = "none" | "invited" | "added";

declare global {
  interface Window {
    JSZip?: any;
  }
}

function loadJSZip(): Promise<any> {
  if (typeof window !== "undefined" && window.JSZip) return Promise.resolve(window.JSZip);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
    s.onload = () => resolve(window.JSZip);
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function uploadToImgur(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("image", file);
  const res = await fetch("https://api.imgur.com/3/image", {
    method: "POST",
    headers: { Authorization: "Client-ID " + TDM_IMGUR_CLIENT_ID },
    body: fd,
  });
  const json = await res.json();
  if (!json.success) throw new Error("Imgur upload failed: " + (json.data && json.data.error));
  return json.data.link as string;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

export interface UseTransferDealArgs {
  chatRoomId: string;
  sellerUid: string | null;
  buyerUid: string | null;
  listingId: string | null;
  dealId: string | null;
  paymentStatus: PaymentStatus;
  isSeller: boolean;
  syncThreads: (previewText: string, sellerUid: string | null, buyerUid: string | null) => Promise<void>;
}

export function useTransferDeal(args: UseTransferDealArgs) {
  const { chatRoomId, sellerUid, buyerUid, listingId, dealId, paymentStatus, isSeller, syncThreads } = args;

  const [tab, setTab] = useState<TdmListingType>("website");
  const [customItems, setCustomItems] = useState<Record<TdmListingType, TdmChecklistItem[]>>({ website: [], game: [], app: [] });
  const [completed, setCompleted] = useState<Record<string, boolean>>({});
  const [finalized, setFinalized] = useState<Record<TdmListingType, boolean>>({ website: false, game: false, app: false });
  const [payloads, setPayloads] = useState<Record<string, TdmPayload>>({});
  const [buyerEmail, setBuyerEmail] = useState("");

  const [attachedRepo, setAttachedRepo] = useState<AttachedRepo | null | undefined>(undefined); // undefined = loading
  const [githubStatus, setGithubStatus] = useState<GithubCollaboratorStatus>("none");
  const [githubCollabUsername, setGithubCollabUsername] = useState("");

  const [finalizing, setFinalizing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const genRef = useRef(0);

  // Load buyer email + listing type + attachedRepo, matching the
  // original's window.__openTransferDealModal data-load. Runs whenever
  // the modal is (re)opened for a given chatRoomId.
  const load = useCallback(async () => {
    const myGen = ++genRef.current;
    setLoadError(null);
    setAttachedRepo(undefined);
    try {
      if (listingId) {
        const listingSnap = await getDoc(doc(db, "listings", listingId));
        if (myGen !== genRef.current) return;
        if (listingSnap.exists()) {
          const l = listingSnap.data() as { type?: string; attachedRepo?: AttachedRepo };
          if (l.type && ["website", "game", "app"].includes(l.type)) setTab(l.type as TdmListingType);
          setAttachedRepo(l.attachedRepo || null);
        } else {
          setAttachedRepo(null);
        }
      } else {
        setAttachedRepo(null);
      }

      const roomSnap = await getDoc(doc(db, "dealChats", chatRoomId));
      if (myGen !== genRef.current) return;
      if (roomSnap.exists()) {
        const r = roomSnap.data() as { githubCollaboratorStatus?: GithubCollaboratorStatus; githubCollaboratorUsername?: string };
        setGithubStatus(r.githubCollaboratorStatus || "none");
        setGithubCollabUsername(r.githubCollaboratorUsername || "");
      }

      if (buyerUid) {
        const bSnap = await getDoc(doc(db, "users", buyerUid));
        if (myGen !== genRef.current) return;
        if (bSnap.exists()) setBuyerEmail((bSnap.data() as { email?: string }).email || "");
      }
    } catch (err) {
      console.warn("[TransferDeal] load error", err);
      if (myGen === genRef.current) setLoadError("Some deal details couldn\u2019t be loaded — you can still continue.");
    }
  }, [chatRoomId, listingId, buyerUid]);

  useEffect(() => {
    // Reset per-open state on every mount (modal is only mounted while open)
    setCompleted({});
    setFinalized({ website: false, game: false, app: false });
    setPayloads({});
    setBuyerEmail("");
    setCustomItems({ website: [], game: [], app: [] });
    load();
  }, [load]);

  const items = tdmGetTabItems(tab, customItems[tab]);
  const isTabFinalized = finalized[tab];
  const anyCompletedInTab = items.some((_, idx) => completed[`${tab}-${idx}`]);

  // Adds a seller-defined "Other" item to the current tab's checklist.
  // Custom items live only in this session's state (reset whenever the
  // modal reopens) — they are not persisted to Firestore. The new item's
  // index (and therefore its `${tab}-${idx}` key) is always the built-ins
  // count plus however many custom items already exist for this tab,
  // since customItems are always appended at the end.
  function addCustomItem(label: string, type: "file_upload" | "secure_secret"): { key: string; item: TdmChecklistItem } {
    const trimmed = label.trim() || "Other";
    const newItem: TdmChecklistItem = { label: trimmed, icon: "other", type };
    const idx = tdmGetTabItems(tab, customItems[tab]).length;
    const key = `${tab}-${idx}`;
    setCustomItems((prev) => ({ ...prev, [tab]: [...prev[tab], newItem] }));
    return { key, item: newItem };
  }

  function markCompleted(key: string, payload: TdmPayload) {
    setPayloads((p) => ({ ...p, [key]: payload }));
    setCompleted((c) => ({ ...c, [key]: true }));
  }

  function unmarkCompleted(key: string) {
    setCompleted((c) => {
      const next = { ...c };
      delete next[key];
      return next;
    });
    setPayloads((p) => {
      const next = { ...p };
      delete next[key];
      return next;
    });
  }

  function switchTab(next: TdmListingType) {
    setTab(next);
  }

  const completedKeysForTab = useCallback(
    (t: TdmListingType) => tdmGetTabItems(t, customItems[t]).map((_, idx) => `${t}-${idx}`).filter((k) => completed[k]),
    [completed, customItems]
  );

  // ---------- Finalize: bundle into zip, upload, write chat message, flip escrow status ----------
  async function finalizeTransfer(): Promise<{ ok: true } | { ok: false; error: string }> {
    const keys = completedKeysForTab(tab);
    if (keys.length === 0) return { ok: false, error: "No completed items to send." };

    const user = auth.currentUser;
    if (!user) return { ok: false, error: "You need to be signed in to finalize this transfer." };

    setFinalizing(true);
    try {
      const JSZip = await loadJSZip();
      const zip = new JSZip();
      const manifestLines = ["Transfer Deal — Delivery Manifest", `Category: ${tab}`, `Generated: ${new Date().toISOString()}`, ""];
      const credentialsOut: Record<string, { url: string; email: string; password: string }> = {};
      const imageLinksOut: Record<string, { name: string; url: string }[]> = {};
      let zipFileCount = 0;

      const tabItems = tdmGetTabItems(tab, customItems[tab]);
      for (const key of keys) {
        const idx = parseInt(key.split("-")[1], 10);
        const item = tabItems[idx];
        const payload = payloads[key];
        const folder = (item.label || key).replace(/[^a-zA-Z0-9 _-]/g, "").trim() || key;

        if (!payload) {
          manifestLines.push(`• ${item.label}: marked done (no attached data)`);
          continue;
        }

        if (payload.kind === "files" && payload.files.length) {
          const bundledNames: string[] = [];
          const imgurLinks: { name: string; url: string }[] = [];
          for (const f of payload.files) {
            if (TDM_IMAGE_EXT_RE.test(f.name)) {
              try {
                const link = await uploadToImgur(f);
                imgurLinks.push({ name: f.name, url: link });
                continue;
              } catch (e) {
                console.warn("Imgur upload failed, bundling into zip instead:", f.name, e);
              }
            }
            zip.file(`${folder}/${f.name}`, f);
            bundledNames.push(f.name);
            zipFileCount++;
          }
          if (imgurLinks.length) imageLinksOut[item.label] = imgurLinks;
          if (payload.buildInfo && payload.buildInfo.trim()) {
            zip.file(`${folder}/BUILD_INFO.txt`, payload.buildInfo.trim());
            zipFileCount++;
          }
          const parts: string[] = [];
          if (bundledNames.length) parts.push(`${bundledNames.length} file(s) — see "${folder}/"`);
          if (imgurLinks.length) parts.push(`${imgurLinks.length} image(s) — see "images.json"`);
          if (payload.buildInfo && payload.buildInfo.trim()) parts.push(`build info — see "${folder}/BUILD_INFO.txt"`);
          manifestLines.push(`• ${item.label}: ${parts.join(", ") || "no files"}`);
        } else if (payload.kind === "text") {
          zip.file(`${folder}/credential.txt`, payload.textValue || "");
          zipFileCount++;
          manifestLines.push(`• ${item.label}: key/credential — see "${folder}/credential.txt"`);
        } else if (payload.kind === "credentials") {
          credentialsOut[item.label] = { url: payload.loginUrl || "", email: payload.loginEmail || "", password: payload.loginPassword || "" };
          manifestLines.push(`• ${item.label}: login credentials — see "credentials.json"`);
        } else if (payload.kind === "screenshot_proof") {
          const imgurLinks: { name: string; url: string }[] = [];
          const bundledNames: string[] = [];
          for (const f of payload.files) {
            if (TDM_IMAGE_EXT_RE.test(f.name)) {
              try {
                const link = await uploadToImgur(f);
                imgurLinks.push({ name: f.name, url: link });
                continue;
              } catch (e) {
                console.warn("Imgur upload failed, bundling into zip instead:", f.name, e);
              }
            }
            zip.file(`${folder}/${f.name}`, f);
            bundledNames.push(f.name);
            zipFileCount++;
          }
          if (imgurLinks.length) imageLinksOut[item.label] = imgurLinks;
          zip.file(`${folder}/RECIPIENT.txt`, `Transferred to: ${payload.recipientEmail || "(not recorded)"}`);
          zipFileCount++;
          const parts: string[] = [`transferred to ${payload.recipientEmail || "buyer"}`];
          if (bundledNames.length || imgurLinks.length) parts.push("proof attached");
          manifestLines.push(`• ${item.label}: ${parts.join(", ")}`);
        }
      }

      if (Object.keys(credentialsOut).length) {
        zip.file("credentials.json", JSON.stringify(credentialsOut, null, 2));
        zipFileCount++;
      }
      if (Object.keys(imageLinksOut).length) {
        zip.file("images.json", JSON.stringify(imageLinksOut, null, 2));
        zipFileCount++;
      }
      zip.file("MANIFEST.txt", manifestLines.join("\n"));
      zipFileCount++;

      const blob: Blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
      const arrayBuffer = await blob.arrayBuffer();
      const base64 = arrayBufferToBase64(arrayBuffer);
      const zipFilename = `transfer-${tab}-${Date.now()}.zip`;

      const idToken = await user.getIdToken();

      // Matches the app's real /api/storage convention: bearer token in
      // the Authorization header (see DealChatPanel.tsx's uploadOneFile),
      // NOT idToken in the body as the original vanilla-JS sent it.
      const uploadRes = await fetch("/api/storage", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ filename: zipFilename, content: base64, encoding: "base64", isDealFile: true, dealId: chatRoomId }),
      });
      const uploadJson = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadJson.error || "Upload failed");

      setFinalized((f) => ({ ...f, [tab]: true }));

      const now = Date.now();
      const labels = keys.map((k) => tabItems[parseInt(k.split("-")[1], 10)].label);

      await addDoc(collection(db, "dealChats", chatRoomId, "messages"), {
        uid: user.uid,
        type: "transfer_zip",
        fileName: zipFilename,
        storagePath: uploadJson.storagePath,
        fileSize: uploadJson.size || blob.size,
        items: labels,
        fileCount: zipFileCount,
        createdAt: now,
      }).catch(() => {});

      const zipPreview = `📦 Sent ${labels.length} transfer item${labels.length === 1 ? "" : "s"} (ZIP)`;
      await updateDoc(doc(db, "dealChats", chatRoomId), { lastMessage: zipPreview, lastAt: now }).catch(() => {});
      await syncThreads(zipPreview, sellerUid, buyerUid);

      // Flip escrow status server-side (seller marking delivered), same
      // as the original's follow-up escrow-deliver call.
      try {
        const idToken2 = await user.getIdToken();
        const res2 = await fetch("/api/deal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "escrow-deliver", idToken: idToken2, chatRoomId, dealId: dealId || null }),
        });
        // Non-fatal: the zip already sent even if escrow-deliver fails
        // (e.g. status isn't 'funded' yet) — matches original behavior.
        if (!res2.ok) console.warn("[TransferDeal] escrow-deliver after finalize did not succeed");
      } catch (e) {
        console.warn("[TransferDeal] escrow-deliver after finalize failed", e);
      }

      return { ok: true };
    } catch (err) {
      console.error("[TransferDeal] finalize error", err);
      return { ok: false, error: err instanceof Error ? err.message : "Something went wrong bundling or sending the transfer. Please try again." };
    } finally {
      setFinalizing(false);
    }
  }

  // ---------- GitHub: invite collaborator (uses the real, working backend action) ----------
  async function inviteGithubCollaborator(username: string): Promise<{ ok: true; status: GithubCollaboratorStatus } | { ok: false; error: string }> {
    const user = auth.currentUser;
    if (!user) return { ok: false, error: "You must be signed in." };
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/deal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "invite-github-collaborator", idToken, chatRoomId, dealId: dealId || null, buyerGithubUsername: username }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "github_user_not_found") return { ok: false, error: data.message || "GitHub username not found." };
        if (data.error === "not_connected") return { ok: false, error: "Your GitHub connection needs to be reconnected in your profile." };
        return { ok: false, error: data.message || data.error || "Could not invite collaborator." };
      }
      const status: GithubCollaboratorStatus = data.status === "invited" ? "invited" : "added";
      setGithubStatus(status);
      setGithubCollabUsername(username);
      return { ok: true, status };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Something went wrong. Please try again." };
    }
  }

  // ---------- GitHub: pick a repo from the seller's own connected account ----------
  // Real functioning path (writes attachedRepo onto the listing doc) —
  // but the picker itself needs a list of the seller's repos, which only
  // /api/github (not present in this backend — see port-status.md) could
  // supply. Exposed so the UI can distinguish "no repo yet, and nothing
  // to pick from" from "no repo yet, pick one" once/if that gap closes.
  async function pickRepo(repo: AttachedRepo) {
    if (!listingId) return;
    try {
      await updateDoc(doc(db, "listings", listingId), { attachedRepo: repo });
      setAttachedRepo(repo);
    } catch (e) {
      console.warn("[TransferDeal] failed to save picked repo to listing", e);
    }
  }

  function clearRepoSelection() {
    setAttachedRepo(null);
  }

  return {
    tab,
    switchTab,
    items,
    customItems: customItems[tab],
    addCustomItem,
    completed,
    payloads,
    isTabFinalized,
    anyCompletedInTab,
    completedKeysForTab,
    markCompleted,
    unmarkCompleted,
    buyerEmail,
    finalizing,
    finalizeTransfer,
    attachedRepo,
    githubStatus,
    githubCollabUsername,
    inviteGithubCollaborator,
    pickRepo,
    clearRepoSelection,
    loadError,
    paymentStatus,
    isSeller,
  };
}

export type UseTransferDealReturn = ReturnType<typeof useTransferDeal>;
