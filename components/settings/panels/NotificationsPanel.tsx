"use client";

import { useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type { SettingsState } from "@/lib/useSettingsState";
import { useSrToast } from "@/components/system/SrToastProvider";
import { subscribeToPush, unsubscribeFromPush, isPushSupported } from "@/lib/push";

const SaveIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <path d="M19 21H5C3.89543 21 3 20.1046 3 19V5C3 3.89543 3.89543 3 5 3H16L21 8V19C21 20.1046 20.1046 21 19 21Z" />
  </svg>
);

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="toggle-switch">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="slider" />
    </label>
  );
}

// Keys of SettingsState whose value is a boolean — restricts
// saveSimpleToggle's setStateKey param so the dynamic assignment below
// type-checks (only boolean fields are ever toggled this way).
type BooleanSettingsKey = {
  [K in keyof SettingsState]: SettingsState[K] extends boolean ? K : never;
}[keyof SettingsState];

export default function NotificationsPanel({
  state,
  setState,
}: {
  state: SettingsState;
  setState: React.Dispatch<React.SetStateAction<SettingsState>>;
}) {
  const { show: toast } = useSrToast();

  const [emailNotifs, setEmailNotifs] = useState(state.emailNotifs);
  const [pushNotifs, setPushNotifs] = useState(state.pushNotifs);
  const [inAppNotifs, setInAppNotifs] = useState(state.inAppNotifs);
  const [dealAlerts, setDealAlerts] = useState(state.dealAlerts);
  const [marketingEmails, setMarketingEmails] = useState(state.marketingEmails);
  const [pushBusy, setPushBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  // Shared instant-save for the four simple toggles — ports the
  // simpleNotifMap loop exactly (each writes its own
  // notificationPrefs.<key> field immediately on change).
  async function saveSimpleToggle(key: string, value: boolean, setLocal: (v: boolean) => void, setStateKey: BooleanSettingsKey) {
    const user = auth.currentUser;
    if (!user) return;
    setLocal(value);
    setState((prev) => ({ ...prev, [setStateKey]: value }));
    try {
      await updateDoc(doc(db, "users", user.uid), { [`notificationPrefs.${key}`]: value });
    } catch {
      toast("Save failed.", "error");
    }
  }

  // Ports the push toggle handler from support-modals.js: subscribe/
  // unsubscribe via the Push API (shared lib/push.ts helpers, same ones
  // NavDrawer's notification row uses) + save the Firestore preference
  // flag either way, matching the original's behavior even when the
  // enable path fails partway through.
  async function handlePushChange(checked: boolean) {
    const user = auth.currentUser;
    if (!user) return;
    setPushBusy(true);
    try {
      if (checked) {
        if (!isPushSupported()) {
          toast("Push not supported in this browser.", "error");
          setPushBusy(false);
          return;
        }
        const result = await subscribeToPush(user.uid);
        if (!result.ok) {
          toast(result.message, "error");
          setPushBusy(false);
          return;
        }
        toast(result.message, "success");
      } else {
        const result = await unsubscribeFromPush(user.uid);
        toast(result.message || "Push notifications disabled.", "info");
      }
      setPushNotifs(checked);
      setState((prev) => ({ ...prev, pushNotifs: checked }));
      await updateDoc(doc(db, "users", user.uid), { "notificationPrefs.pushNotifs": checked });
    } catch (err) {
      console.error("[push toggle]", err);
      toast("Could not update push notifications.", "error");
    } finally {
      setPushBusy(false);
    }
  }

  // Ports saveNotifsBtn — batch-saves all five prefs at once (redundant
  // with the instant-save toggles above, but that's how the original
  // works too: both paths write to the same notificationPrefs field).
  async function handleSaveAll() {
    const user = auth.currentUser;
    if (!user) {
      toast("Not signed in.", "error");
      return;
    }
    setSaving(true);
    const prefs = { emailNotifs, pushNotifs, inAppNotifs, dealAlerts, marketingEmails };
    try {
      await updateDoc(doc(db, "users", user.uid), { notificationPrefs: prefs });
      setState((prev) => ({ ...prev, ...prefs }));
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
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        <h3>Notification Preferences</h3>
      </div>
      <p className="detail-panel-desc">Control how and when we reach out to you.</p>
      <hr className="detail-divider" />

      <div className="toggle-item">
        <div className="toggle-label-wrap">
          <span className="toggle-label">Email Notifications</span>
          <span className="toggle-sublabel">Receive updates via email.</span>
        </div>
        <Toggle checked={emailNotifs} onChange={(v) => saveSimpleToggle("emailNotifs", v, setEmailNotifs, "emailNotifs")} />
      </div>
      <div className="toggle-item">
        <div className="toggle-label-wrap">
          <span className="toggle-label">Push Notifications</span>
          <span className="toggle-sublabel">Receive push alerts on your device.</span>
        </div>
        <Toggle checked={pushNotifs} onChange={handlePushChange} disabled={pushBusy} />
      </div>
      <div className="toggle-item">
        <div className="toggle-label-wrap">
          <span className="toggle-label">In-App Notifications</span>
          <span className="toggle-sublabel">Show notifications inside the platform.</span>
        </div>
        <Toggle checked={inAppNotifs} onChange={(v) => saveSimpleToggle("inAppNotifs", v, setInAppNotifs, "inAppNotifs")} />
      </div>
      <div className="toggle-item">
        <div className="toggle-label-wrap">
          <span className="toggle-label">Deal &amp; Offer Alerts</span>
          <span className="toggle-sublabel">Get notified about new deals matching your interests.</span>
        </div>
        <Toggle checked={dealAlerts} onChange={(v) => saveSimpleToggle("dealAlerts", v, setDealAlerts, "dealAlerts")} />
      </div>
      <div className="toggle-item">
        <div className="toggle-label-wrap">
          <span className="toggle-label">Marketing Emails</span>
          <span className="toggle-sublabel">Receive tips, product updates, and promotional offers.</span>
        </div>
        <Toggle checked={marketingEmails} onChange={(v) => saveSimpleToggle("marketingEmails", v, setMarketingEmails, "marketingEmails")} />
      </div>

      <button className="save-btn" onClick={handleSaveAll} disabled={saving}>
        <SaveIcon />
        {saving ? "Saving…" : "Save Notification Settings"}
      </button>

    </>
  );
}
