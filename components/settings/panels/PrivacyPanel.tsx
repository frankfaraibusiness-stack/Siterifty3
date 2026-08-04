"use client";

import { useState } from "react";
import { auth } from "@/lib/firebase";
import type { SettingsState } from "@/lib/useSettingsState";
import { useSrToast } from "@/components/system/SrToastProvider";

const SaveIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <path d="M19 21H5C3.89543 21 3 20.1046 3 19V5C3 3.89543 3.89543 3 5 3H16L21 8V19C21 20.1046 20.1046 21 19 21Z" />
  </svg>
);

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle-switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="slider" />
    </label>
  );
}

export default function PrivacyPanel({
  state,
  setState,
}: {
  state: SettingsState;
  setState: React.Dispatch<React.SetStateAction<SettingsState>>;
}) {
  const { show: toast } = useSrToast();

  const [profileVisibility, setProfileVisibility] = useState(state.profileVisibility);
  const [showEmail, setShowEmail] = useState(state.showEmail);
  const [showSocial, setShowSocial] = useState(state.showSocial);
  const [dataCollection, setDataCollection] = useState(state.dataCollection);
  const [saving, setSaving] = useState(false);

  // Private profiles are a paid-plan perk — mirrors the original's
  // window.__fbUserData.plan check (defaults to 'free').
  const canGoPrivate = state.plan !== "free";

  // Ports savePrivacyBtn's handler, including the client-side guard that
  // mirrors the disabled <option>. The real enforcement lives server-side
  // in /api/account's setPrivacy action, which re-checks plan before
  // writing — this client check is just a snappier early exit.
  async function handleSave() {
    const user = auth.currentUser;
    if (!user) {
      toast("Not signed in.", "error");
      return;
    }
    if (profileVisibility === "private" && !canGoPrivate) {
      toast("Private profiles are available on paid plans. Upgrade to unlock.", "error");
      return;
    }
    setSaving(true);
    const priv = { profileVisibility, showEmail, showSocial, dataCollection };
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/account?action=setPrivacy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken, ...priv }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || "Save failed");
      setState((prev) => ({ ...prev, ...priv }));
      toast("Privacy settings saved.", "success");
    } catch (err: any) {
      toast(`Save failed: ${err.message}`, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="detail-panel-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
        <h3>Privacy & Data</h3>
      </div>
      <p className="detail-panel-desc">Control your privacy and how your data is handled.</p>
      <hr className="detail-divider" />

      <div className="input-group">
        <label>Profile Visibility</label>
        <select
          className="select-field"
          value={profileVisibility}
          onChange={(e) => setProfileVisibility(e.target.value)}
        >
          <option value="public">Public — Everyone can see</option>
          <option value="members">Followers Only</option>
          <option value="private" disabled={!canGoPrivate}>
            Private — Only you{canGoPrivate ? "" : " (paid plans only)"}
          </option>
        </select>
        {!canGoPrivate ? (
          <p className="input-hint" style={{ marginTop: "0.4rem", color: "var(--mp-text-sec, #888)", fontSize: "0.78rem" }}>
            Private profiles are available on Starter, Growth, and Pro plans.{" "}
            <a
              href="#"
              style={{ color: "var(--mp-accent, #a3e635)", fontWeight: 600, textDecoration: "none" }}
              onClick={(e) => {
                e.preventDefault();
                toast("Plans modal isn't built yet — this is a placeholder.", "info");
              }}
            >
              Upgrade to unlock
            </a>
            .
          </p>
        ) : null}
      </div>

      <div className="toggle-item">
        <div className="toggle-label-wrap">
          <span className="toggle-label">Show email on profile</span>
          <span className="toggle-sublabel">Display your email publicly on your profile page.</span>
        </div>
        <Toggle checked={showEmail} onChange={setShowEmail} />
      </div>

      <div className="toggle-item">
        <div className="toggle-label-wrap">
          <span className="toggle-label">Show social links</span>
        </div>
        <Toggle checked={showSocial} onChange={setShowSocial} />
      </div>

      <div className="toggle-item">
        <div className="toggle-label-wrap">
          <span className="toggle-label">Usage Data Collection</span>
          <span className="toggle-sublabel">Help improve Siterifty with anonymous usage data.</span>
        </div>
        <Toggle checked={dataCollection} onChange={setDataCollection} />
      </div>

      <button className="save-btn" onClick={handleSave} disabled={saving}>
        <SaveIcon />
        {saving ? "Saving…" : "Save Privacy Settings"}
      </button>

    </>
  );
}
