"use client";

import { useState } from "react";
import { EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";
import { collection, doc, getDoc, getDocs, query, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type { SettingsState } from "@/lib/useSettingsState";
import { useSrToast } from "@/components/system/SrToastProvider";

const AlertIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e74c3c" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

const DownloadIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#aaa" strokeWidth="2">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const DownloadIconBtn = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

declare global {
  interface Window {
    JSZip?: any;
  }
}

// Loads JSZip from the same CDN the original uses, only when the export
// button is actually clicked — matches the original's lazy load-on-demand
// (it doesn't bundle JSZip up front either).
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

function isoOrNull(v: any): string | null {
  return typeof v?.toDate === "function" ? v.toDate().toISOString() : null;
}

// Ports renderDanger() + its `case 'danger':` handler: the "Export All
// Data" ZIP download and the "Delete Account" flow (confirm toggle gates
// the button, click triggers an inline password re-auth prompt, then a
// real Firestore flag write + Firebase Auth user.delete()). Both actions
// are destructive/irreversible in the original — ported carefully,
// without adding any extra confirmation steps beyond what the source has
// and without removing any either.
export default function DangerZonePanel({}: {
  state: SettingsState;
  setState: React.Dispatch<React.SetStateAction<SettingsState>>;
}) {
  const { show: toast } = useSrToast();

  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<string | null>(null);

  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showReauth, setShowReauth] = useState(false);
  const [reauthPassword, setReauthPassword] = useState("");
  const [reauthError, setReauthError] = useState<string | null>(null);
  const [deleteStage, setDeleteStage] = useState<"idle" | "verifying" | "deleting">("idle");

  // ── Export All Data ──────────────────────────────────────────────
  async function handleExport() {
    const user = auth.currentUser;
    if (!user) return;
    setExporting(true);
    setExportProgress("Collecting your data from Firebase…");
    try {
      setExportProgress("Loading profile…");
      const profileSnap = await getDoc(doc(db, "users", user.uid));
      const profile: any = profileSnap.exists() ? profileSnap.data() : {};

      setExportProgress("Loading transactions…");
      const txSnap = await getDocs(collection(db, "users", user.uid, "transactions"));
      const transactions = txSnap.docs.map((d) => ({ id: d.id, ...d.data(), createdAt: isoOrNull((d.data() as any).createdAt) }));

      setExportProgress("Loading listings…");
      let listings: any[] = [];
      try {
        const lSnap = await getDocs(query(collection(db, "listings"), where("ownerUid", "==", user.uid)));
        listings = lSnap.docs.map((d) => ({ id: d.id, ...d.data(), createdAt: isoOrNull((d.data() as any).createdAt) }));
      } catch {
        // silent, same as original
      }

      setExportProgress("Loading webhooks & API keys…");
      let apiKeys: any[] = [];
      try {
        const akSnap = await getDocs(query(collection(db, "apiKeys"), where("ownerUid", "==", user.uid)));
        apiKeys = akSnap.docs.map((d) => {
          const data: any = d.data();
          return { id: d.id, label: data.label, prefix: data.prefix, active: data.active, createdAt: isoOrNull(data.createdAt) };
        });
      } catch {
        // silent, same as original
      }

      setExportProgress("Building ZIP archive…");
      const JSZip = await loadJSZip();
      const zip = new JSZip();

      const cleanProfile: any = { ...profile };
      delete cleanProfile.passwordHash;
      delete cleanProfile.token;
      if (cleanProfile.createdAt?.toDate) cleanProfile.createdAt = cleanProfile.createdAt.toDate().toISOString();
      if (cleanProfile.updatedAt?.toDate) cleanProfile.updatedAt = cleanProfile.updatedAt.toDate().toISOString();

      zip.file("profile.json", JSON.stringify({ uid: user.uid, email: user.email, ...cleanProfile }, null, 2));
      zip.file("transactions.json", JSON.stringify(transactions, null, 2));
      zip.file("listings.json", JSON.stringify(listings, null, 2));
      zip.file("api_keys.json", JSON.stringify(apiKeys, null, 2));
      zip.file("webhooks.json", JSON.stringify(profile.webhooks || [], null, 2));
      zip.file(
        "README.txt",
        "Siterifty Data Export\n" +
          "Exported: " +
          new Date().toISOString() +
          "\nUser: " +
          user.email +
          "\n\nFiles:\n" +
          "- profile.json: account settings and preferences\n" +
          "- transactions.json: wallet transaction history\n" +
          "- listings.json: your marketplace listings\n" +
          "- api_keys.json: API key metadata (keys not included for security)\n" +
          "- webhooks.json: registered webhooks and domains"
      );

      setExportProgress("Generating download…");
      const blob: Blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `siterifty-data-${user.uid.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
      }, 2000);
      setExportProgress("✓ Download started!");
      setTimeout(() => setExportProgress(null), 3000);
      toast("Data export downloaded successfully.", "success");
    } catch (err: any) {
      setExportProgress(null);
      toast(`Export failed: ${err.message}`, "error");
    } finally {
      setExporting(false);
    }
  }

  // ── Delete Account ───────────────────────────────────────────────
  function openReauth() {
    setReauthPassword("");
    setReauthError(null);
    setShowReauth(true);
  }

  async function confirmReauthAndDelete() {
    const user = auth.currentUser;
    if (!user) return;
    if (!reauthPassword) {
      setReauthError("Enter your password.");
      return;
    }
    setDeleteStage("verifying");
    try {
      if (!user.email) throw new Error("Account has no email on file.");
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, reauthPassword));
      setShowReauth(false);
      setDeleteStage("deleting");
      await updateDoc(doc(db, "users", user.uid), {
        scheduledDelete: true,
        deleteAt: Date.now(),
        deletionConfirmedAt: serverTimestamp(),
      });
      await user.delete();
      toast("Account permanently deleted. Goodbye.", "success");
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (err: any) {
      const code = err?.code;
      if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
        setReauthError("Incorrect password.");
      } else if (showReauth || code) {
        // Reauth itself failed with some other auth error — stay on the
        // password prompt, same as the original's inline overlay.
        setReauthError("Authentication failed.");
      } else {
        toast(`Deletion failed: ${err.message}`, "error");
      }
      setDeleteStage("idle");
    }
  }

  return (
    <>
      <div className="detail-panel-header">
        <AlertIcon />
        <h3 style={{ color: "#e74c3c" }}>Danger Zone</h3>
      </div>
      <p className="detail-panel-desc" style={{ color: "#e74c3c" }}>
        Irreversible actions. Proceed with extreme caution.
      </p>
      <hr className="detail-divider" />

      <div className="info-card" style={{ borderColor: "rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.02)" }}>
        <DownloadIcon />
        <span className="info-text">
          <strong>Export All Data</strong>
          <br />
          <span style={{ color: "#777", fontSize: "0.8rem" }}>
            Downloads your profile, listings, transactions, messages and settings as a ZIP archive.
          </span>
        </span>
      </div>
      <button
        className="save-btn"
        style={{ background: "#fff", color: "#000", marginBottom: "0.5rem" }}
        onClick={handleExport}
        disabled={exporting}
      >
        <DownloadIconBtn /> {exporting ? "Gathering data…" : "Download My Data (ZIP)"}
      </button>
      {exportProgress ? (
        <div style={{ fontSize: "0.78rem", color: "#888", marginBottom: "0.5rem" }}>{exportProgress}</div>
      ) : null}

      <hr className="detail-divider" style={{ marginTop: "1rem" }} />

      <div className="info-card" style={{ borderColor: "rgba(231,76,60,0.35)", background: "rgba(231,76,60,0.04)" }}>
        <AlertIcon />
        <span className="info-text" style={{ color: "#e74c3c" }}>
          <strong>Delete Account</strong>
          <br />
          <span style={{ fontSize: "0.8rem", color: "#a55" }}>
            Permanently deletes your account, listings, messages, and wallet. Cannot be undone.
          </span>
        </span>
      </div>

      <div style={{ background: "rgba(231,76,60,0.05)", border: "1px solid rgba(231,76,60,0.2)", borderRadius: "0.9rem", padding: "1rem", marginBottom: "0.75rem" }}>
        <div className="toggle-item" style={{ marginBottom: "0.75rem" }}>
          <div className="toggle-label-wrap">
            <span className="toggle-label" style={{ color: "#e74c3c" }}>
              I understand this cannot be undone
            </span>
            <span className="toggle-sublabel">All data, listings, and wallet balance will be erased.</span>
          </div>
          <label className="toggle-switch">
            <input type="checkbox" checked={deleteConfirmed} onChange={(e) => setDeleteConfirmed(e.target.checked)} />
            <span className="slider" />
          </label>
        </div>
        <button
          className="danger-btn"
          style={{ borderColor: "#e74c3c", color: "#fff", background: "rgba(231,76,60,0.8)", width: "100%" }}
          disabled={!deleteConfirmed || deleteStage !== "idle"}
          onClick={openReauth}
        >
          <TrashIcon /> {deleteStage === "deleting" ? "Deleting…" : "Delete Account"}
        </button>
      </div>

      {/* Inline password re-auth overlay — ports the dynamically-built
          overlay from the original's deleteAccountBtn handler exactly
          (same copy, same required-before-delete step). */}
      {showReauth ? (
        <div id="srf-modal-overlay" className="visible" onClick={() => deleteStage !== "verifying" && setShowReauth(false)}>
          <div id="srf-modal-box" onClick={(e) => e.stopPropagation()}>
            <div id="srf-modal-icon-wrap">
              <div id="srf-modal-icon" className="theme-danger">
                <AlertIcon />
              </div>
            </div>
            <div id="srf-modal-body">
              <div id="srf-modal-title">Confirm your password</div>
              <div id="srf-modal-msg">Required to permanently delete your account.</div>
            </div>
            <div id="srf-modal-input-wrap" style={{ display: "block" }}>
              <input
                id="srf-modal-input"
                type="password"
                placeholder="Current password"
                autoComplete="current-password"
                autoFocus
                value={reauthPassword}
                onChange={(e) => setReauthPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") confirmReauthAndDelete();
                }}
              />
              {reauthError ? (
                <div style={{ color: "#f87171", fontSize: "0.75rem", marginTop: 8 }}>{reauthError}</div>
              ) : null}
            </div>
            <div id="srf-modal-actions">
              <button className="srf-modal-btn cancel" onClick={() => setShowReauth(false)} disabled={deleteStage === "verifying"}>
                Cancel
              </button>
              <button className="srf-modal-btn confirm-danger" onClick={confirmReauthAndDelete} disabled={deleteStage === "verifying"}>
                {deleteStage === "verifying" ? "Verifying…" : "Delete Account"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

    </>
  );
}
