"use client";

import { useState } from "react";
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "firebase/auth";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type { SettingsState } from "@/lib/useSettingsState";
import { useSrToast } from "@/components/system/SrToastProvider";

const SaveIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <path d="M19 21H5C3.89543 21 3 20.1046 3 19V5C3 3.89543 3.89543 3 5 3H16L21 8V19C21 20.1046 20.1046 21 19 21Z" />
  </svg>
);

// Toggle switch is a bare <input type="checkbox"> styled via .toggle-switch
// .slider in globals.css — matches the original's markup exactly (no
// custom component needed, the CSS already does the visual work).
function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="toggle-switch">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="slider" />
    </label>
  );
}

export default function SecurityPanel({
  state,
  setState,
}: {
  state: SettingsState;
  setState: React.Dispatch<React.SetStateAction<SettingsState>>;
}) {
  const { show: toast } = useSrToast();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwFeedback, setPwFeedback] = useState<{ text: string; ok: boolean } | null>(null);
  const [pwSaving, setPwSaving] = useState(false);

  const [twoFactorEnabled, setTwoFactorEnabled] = useState(state.twoFactorEnabled);
  const [loginAlerts, setLoginAlerts] = useState(state.loginAlerts);

  // Ports savePasswordBtn: reauthenticate with current password, then
  // updatePassword via Firebase Auth, then stamp passwordChangedAt.
  async function handlePasswordSave() {
    const user = auth.currentUser;
    if (!user) {
      toast("Not signed in.", "error");
      return;
    }
    if (!currentPassword) {
      setPwFeedback({ text: "Enter your current password.", ok: false });
      return;
    }
    if (!newPassword) {
      setPwFeedback({ text: "Enter a new password.", ok: false });
      return;
    }
    if (newPassword.length < 8) {
      setPwFeedback({ text: "Password must be at least 8 characters.", ok: false });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwFeedback({ text: "Passwords do not match.", ok: false });
      return;
    }

    setPwSaving(true);
    try {
      if (!user.email) throw new Error("Account has no email on file.");
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword));
      await updatePassword(user, newPassword);
      await updateDoc(doc(db, "users", user.uid), { passwordChangedAt: serverTimestamp() });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPwFeedback({ text: "Password updated.", ok: true });
    } catch (err: any) {
      const code = err?.code;
      const text =
        code === "auth/wrong-password" || code === "auth/invalid-credential"
          ? "Current password is incorrect."
          : code === "auth/too-many-requests"
          ? "Too many attempts. Try again later."
          : `Error: ${err?.message || code}`;
      setPwFeedback({ text, ok: false });
    } finally {
      setPwSaving(false);
    }
  }

  // Toggles auto-save on change — no separate save button, matches original.
  async function handleTwoFactorChange(checked: boolean) {
    const user = auth.currentUser;
    if (!user) return;
    setTwoFactorEnabled(checked);
    setState((prev) => ({ ...prev, twoFactorEnabled: checked }));
    try {
      await updateDoc(doc(db, "users", user.uid), { twoFactorEnabled: checked });
      toast(`2FA ${checked ? "enabled" : "disabled"}.`, "success");
    } catch {
      toast("Save failed.", "error");
    }
  }

  async function handleLoginAlertsChange(checked: boolean) {
    const user = auth.currentUser;
    if (!user) return;
    setLoginAlerts(checked);
    setState((prev) => ({ ...prev, loginAlerts: checked }));
    try {
      await updateDoc(doc(db, "users", user.uid), { loginAlerts: checked });
      toast(`Login alerts ${checked ? "on" : "off"}.`, "success");
    } catch {
      toast("Save failed.", "error");
    }
  }

  return (
    <>
      <div className="detail-panel-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <h3>Security</h3>
      </div>
      <p className="detail-panel-desc">Change your password and manage security preferences. Toggles save instantly.</p>
      <hr className="detail-divider" />

      <div style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#555", marginBottom: "0.75rem" }}>
        Change Password
      </div>
      <div className="input-group">
        <label>Current Password</label>
        <input
          className="input-field"
          type="password"
          placeholder="••••••••"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
      </div>
      <div className="input-group">
        <label>New Password</label>
        <input
          className="input-field"
          type="password"
          placeholder="At least 8 characters"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
      </div>
      <div className="input-group">
        <label>Confirm New Password</label>
        <input
          className="input-field"
          type="password"
          placeholder="Re-type new password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
      </div>
      <button className="save-btn" onClick={handlePasswordSave} disabled={pwSaving}>
        <SaveIcon />
        {pwSaving ? "Updating…" : "Update Password"}
      </button>
      <div
        style={{
          fontSize: "0.82rem",
          marginTop: "0.5rem",
          minHeight: "1.1rem",
          color: pwFeedback ? (pwFeedback.ok ? "#a3e635" : "#f87171") : undefined,
        }}
      >
        {pwFeedback?.text || ""}
      </div>

      <hr className="detail-divider" style={{ marginTop: "1.25rem" }} />
      <div style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#555", marginBottom: "0.75rem" }}>
        Security Preferences
      </div>

      <div className="toggle-item">
        <div className="toggle-label-wrap">
          <span className="toggle-label">Two-Factor Authentication (2FA)</span>
          <span className="toggle-sublabel">Require a code from your authenticator app.</span>
        </div>
        <Toggle checked={twoFactorEnabled} onChange={handleTwoFactorChange} />
      </div>
      <div className="toggle-item">
        <div className="toggle-label-wrap">
          <span className="toggle-label">Login Alerts</span>
          <span className="toggle-sublabel">Get notified of new sign-ins to your account.</span>
        </div>
        <Toggle checked={loginAlerts} onChange={handleLoginAlertsChange} />
      </div>

    </>
  );
}
