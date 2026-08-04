"use client";

import { useRef, useState } from "react";
import { doc, updateDoc, serverTimestamp, collection, query, where, getDocs, limit, arrayUnion } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type { SettingsState } from "@/lib/useSettingsState";
import { useSrToast } from "@/components/system/SrToastProvider";
import { useLimits } from "@/lib/useLimits";

// Imgur Client-ID used specifically by the Account panel's avatar upload
// in the original support-modals.js. Note: other parts of the original
// codebase (group-chat.js, inbox.js, listing-form-game.js) use a
// *different* Imgur Client-ID (546c25a59c58ad7) for their own uploads —
// that's a pre-existing inconsistency in the original app, not something
// introduced here. Worth reconciling to one ID at some point, but this
// panel is ported faithfully to what support-modals.js itself used.
const IMGUR_CLIENT_ID = "891e5bb4aa94282";

const TIMEZONES = [
  { value: "America/New_York", label: "Eastern (US) — UTC-5" },
  { value: "America/Chicago", label: "Central (US) — UTC-6" },
  { value: "America/Denver", label: "Mountain (US) — UTC-7" },
  { value: "America/Los_Angeles", label: "Pacific (US) — UTC-8" },
  { value: "Europe/London", label: "London — UTC+0" },
  { value: "Europe/Berlin", label: "Berlin — UTC+1" },
  { value: "Asia/Tokyo", label: "Tokyo — UTC+9" },
];

// Live username rules now come from useLimits() (GET /api/limits,
// LIMITS.username) inside the component below. FALLBACK_USERNAME_LIMITS
// is used only until that fetch resolves — same numbers as the
// original's own `_uLim2` default, for the same "instant client-side
// validation before hitting the network" reason (the original doesn't
// call the server for length/pattern either, only for uniqueness via a
// direct Firestore query, which this file still does the same way).
const FALLBACK_USERNAME_LIMITS = { minLength: 5, maxLength: 15 };

const SaveIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <path d="M19 21H5C3.89543 21 3 20.1046 3 19V5C3 3.89543 3.89543 3 5 3H16L21 8V19C21 20.1046 20.1046 21 19 21Z" />
  </svg>
);

export default function AccountPanel({
  state,
  setState,
}: {
  state: SettingsState;
  setState: React.Dispatch<React.SetStateAction<SettingsState>>;
}) {
  const { show: toast } = useSrToast();
  const { limits } = useLimits();
  const USERNAME_LIMITS = {
    minLength: limits.username.minLength ?? FALLBACK_USERNAME_LIMITS.minLength,
    maxLength: limits.username.maxLength ?? FALLBACK_USERNAME_LIMITS.maxLength,
  };
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState(state.displayName);
  const [username, setUsername] = useState(state.username);
  const [contactEmail, setContactEmail] = useState(state.email);
  const [timezone, setTimezone] = useState(state.timezone);

  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{ text: string; error: boolean } | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const initial = (state.displayName || state.username || "U").charAt(0).toUpperCase();

  // Ports the pfpFileInput 'change' handler: validate → upload to Imgur →
  // write profilePic to Firestore → sync local state + nav avatar.
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast("Please choose an image file.", "error");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast("Image must be under 10MB.", "error");
      return;
    }
    const user = auth.currentUser;
    if (!user) {
      toast("Not signed in.", "error");
      return;
    }

    setUploading(true);
    setUploadStatus({ text: "Uploading…", error: false });
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("https://api.imgur.com/3/image", {
        method: "POST",
        headers: { Authorization: `Client-ID ${IMGUR_CLIENT_ID}` },
        body: fd,
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.data?.error || "Imgur upload failed");
      const url = json.data.link as string;

      await updateDoc(doc(db, "users", user.uid), {
        profilePic: url,
        updatedAt: serverTimestamp(),
      });

      setState((prev) => ({ ...prev, profilePic: url }));
      setUploadStatus({ text: "Updated!", error: false });
      setTimeout(() => setUploadStatus(null), 2000);
      // Nav avatar / profile modal sync (window.__updateLoginBtn,
      // window.__pmUpdateAvatar in the original) happens automatically
      // here since AuthContext's profile listener is a live onSnapshot —
      // no manual cross-component sync call needed like the original.
    } catch (err: any) {
      setUploadStatus({ text: `Upload failed: ${err.message}`, error: true });
    } finally {
      setUploading(false);
    }
  }

  // Ports the saveAccountBtn click handler exactly: validate → uniqueness
  // check (direct Firestore query, same as original — no server round
  // trip) → updateDoc.
  async function handleSave() {
    const user = auth.currentUser;
    if (!user) {
      toast("Not signed in.", "error");
      return;
    }
    const dispName = displayName.trim();
    const uname = username.trim();

    if (!dispName) {
      toast("Display name cannot be empty.", "error");
      return;
    }
    if (uname) {
      if (uname.length < USERNAME_LIMITS.minLength) {
        toast(`Username must be at least ${USERNAME_LIMITS.minLength} characters.`, "error");
        return;
      }
      if (uname.length > USERNAME_LIMITS.maxLength) {
        toast(`Username cannot exceed ${USERNAME_LIMITS.maxLength} characters.`, "error");
        return;
      }
      if (!new RegExp(limits.username.pattern || "^[a-zA-Z0-9_.-]+$").test(uname)) {
        toast(limits.username.patternHint || "Username can only contain letters, numbers, underscores, hyphens, and dots.", "error");
        return;
      }
      const lower = uname.toLowerCase().replace(/\s+/g, "_");
      const snap = await getDocs(query(collection(db, "users"), where("usernameLower", "==", lower), limit(2)));
      const takenByOther = !snap.empty && !(snap.docs.length === 1 && snap.docs[0].id === user.uid);
      if (takenByOther) {
        toast("That username is already taken. Please choose another.", "error");
        return;
      }
    }

    const email = contactEmail.trim();
    const usernameChanged = uname !== state.username;
    const emailChanged = email !== state.email;

    // Server is the source of truth for both cooldowns — same
    // check-username-change / check-email-change pattern used by the
    // profile modal's saveAccount (lib/useProfileData.ts).
    const idToken = await user.getIdToken();
    if (usernameChanged) {
      const checkRes = await fetch("/api/limits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check-username-change", idToken }),
      });
      const checkJson = await checkRes.json().catch(() => ({}));
      if (!checkRes.ok) {
        toast(checkJson.error || "Couldn't check your username cooldown — try again.", "error");
        return;
      }
      if (!checkJson.allowed) {
        const d = checkJson.daysLeft;
        toast(`You can change your username again in ${d} day${d !== 1 ? "s" : ""}.`, "error");
        return;
      }
    }
    if (emailChanged) {
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        toast("Enter a valid email address.", "error");
        return;
      }
      const checkRes = await fetch("/api/limits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check-email-change", idToken }),
      });
      const checkJson = await checkRes.json().catch(() => ({}));
      if (!checkRes.ok) {
        toast(checkJson.error || "Couldn't check your email change limit — try again.", "error");
        return;
      }
      if (!checkJson.allowed) {
        const d = checkJson.daysLeft;
        toast(`You've used all your contact email changes for this period. Try again in ${d} day${d !== 1 ? "s" : ""}.`, "error");
        return;
      }
    }

    setSaveState("saving");
    try {
      const updates: Record<string, unknown> = {
        displayName: dispName,
        username: uname || dispName,
        usernameLower: (uname || dispName).toLowerCase().replace(/\s+/g, "_"),
        timezone,
        language: "en",
        updatedAt: serverTimestamp(),
        profileUpdatedAt: serverTimestamp(), // feeds the "Update Your Profile" daily objective
      };
      if (usernameChanged) updates.usernameChangedAt = serverTimestamp();
      if (emailChanged) {
        updates.contactEmail = email;
        updates.contactEmailChanges = arrayUnion(Date.now());
      }
      await updateDoc(doc(db, "users", user.uid), updates);
      setState((prev) => ({ ...prev, displayName: dispName, username: uname || dispName, email, timezone, language: "en" }));
      setSaveState("saved");
    } catch (err: any) {
      toast(`Save failed: ${err.message}`, "error");
      setSaveState("error");
    }
  }

  return (
    <>
      <div className="detail-panel-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="8" r="4" />
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        </svg>
        <h3>Account Settings</h3>
      </div>
      <p className="detail-panel-desc">Manage your personal account details and preferences.</p>
      <hr className="detail-divider" />

      <div className="input-group">
        <label>Profile Picture</label>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <button
            type="button"
            title="Tap to change your profile picture"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            style={{
              width: 72,
              height: 72,
              borderRadius: "50%",
              overflow: "hidden",
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              position: "relative",
              padding: 0,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {state.profilePic ? (
                <img src={state.profilePic} alt="Profile picture" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              ) : (
                <span style={{ fontSize: 26, fontWeight: 700, color: "rgba(255,255,255,0.4)" }}>{initial}</span>
              )}
            </div>
          </button>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="hint">Tap your picture to change it. JPG, PNG, GIF, or WEBP.</span>
            {uploadStatus ? (
              <span className="hint" style={{ color: uploadStatus.error ? "#f87171" : "rgba(255,255,255,0.5)" }}>
                {uploadStatus.text}
              </span>
            ) : null}
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          style={{ display: "none" }}
          onChange={handleFileChange}
        />
      </div>

      <div className="input-group">
        <label>Display Name</label>
        <input
          className="input-field"
          type="text"
          value={displayName}
          placeholder="Your display name"
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </div>

      <div className="input-group">
        <label>Username</label>
        <input className="input-field" type="text" value={username} placeholder="Username" onChange={(e) => setUsername(e.target.value)} />
        <span className="hint">
          Can be changed once every {Math.round((limits.username.changeCooldownMs ?? 0) / (24 * 60 * 60 * 1000))} days.
        </span>
      </div>

      <div className="input-group">
        <label>Email Address</label>
        <input
          className="input-field"
          type="email"
          value={contactEmail}
          placeholder="you@example.com"
          onChange={(e) => setContactEmail(e.target.value)}
        />
        <span className="hint">
          Up to {limits.contactEmail.maxChangesPerPeriod ?? 2} changes every{" "}
          {Math.round((limits.contactEmail.periodMs ?? 0) / (24 * 60 * 60 * 1000))} days.
        </span>
      </div>

      <div className="input-group">
        <label>Timezone</label>
        <select className="select-field" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
          {TIMEZONES.map((tz) => (
            <option key={tz.value} value={tz.value}>
              {tz.label}
            </option>
          ))}
        </select>
      </div>

      <div className="input-group">
        <label>
          Language{" "}
          <span
            style={{
              fontSize: "0.66rem",
              fontWeight: 700,
              background: "rgba(139,156,247,0.15)",
              color: "#8b9cf7",
              padding: "2px 7px",
              borderRadius: 20,
              letterSpacing: "0.04em",
              verticalAlign: "middle",
            }}
          >
            Coming soon
          </span>
        </label>
        <select className="select-field" disabled style={{ opacity: 0.5, cursor: "not-allowed" }} defaultValue="en">
          <option value="en">English</option>
        </select>
        <span className="hint">Multi-language support is coming soon. The app is English-only for now.</span>
      </div>

      <button className="save-btn" onClick={handleSave} disabled={saveState === "saving"}>
        <SaveIcon />
        {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "Save Account Changes"}
      </button>

    </>
  );
}
