"use client";

import { useCallback, useEffect, useState } from "react";
import { doc, getDoc, getDocs, collection } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useAuth } from "@/lib/AuthContext";

export interface ApiKey {
  id: string;
  [key: string]: unknown;
}

export interface Webhook {
  id?: string;
  url?: string;
  events?: string;
  [key: string]: unknown;
}

// Mirrors the `state` object in support-modals.js exactly — same fields,
// same defaults. Kept as one flat object (rather than 14 separate slices)
// because that's how the original modeled it and every panel's save
// function only ever touches its own handful of fields anyway.
export interface SettingsState {
  // Account
  displayName: string;
  username: string;
  email: string;
  profilePic: string;
  timezone: string;
  language: string;
  // Security
  twoFactorEnabled: boolean;
  loginAlerts: boolean;
  // Notifications
  emailNotifs: boolean;
  pushNotifs: boolean;
  inAppNotifs: boolean;
  marketingEmails: boolean;
  dealAlerts: boolean;
  // Appearance
  theme: string;
  fontSize: "small" | "medium" | "large";
  compactMode: boolean;
  // Billing
  plan: string;
  billingCycle: string;
  // Payments
  paypalEmail: string;
  // Privacy
  profileVisibility: string;
  showEmail: boolean;
  showSocial: boolean;
  dataCollection: boolean;
  // Sessions — loaded lazily when the Sessions panel opens, not here
  currentSession: unknown | null;
  // API keys
  apiKeys: ApiKey[];
  externalApiKeys: unknown[];
  // Webhooks
  webhooks: Webhook[];
  webhookLogs: unknown[];
  webhooksLoaded: boolean;
}

export const DEFAULT_SETTINGS_STATE: SettingsState = {
  displayName: "",
  username: "",
  email: "",
  profilePic: "",
  timezone: "America/New_York",
  language: "en",
  twoFactorEnabled: false,
  loginAlerts: true,
  emailNotifs: true,
  pushNotifs: true,
  inAppNotifs: true,
  marketingEmails: false,
  dealAlerts: true,
  theme: "dark",
  fontSize: "medium",
  compactMode: false,
  plan: "free",
  billingCycle: "monthly",
  paypalEmail: "",
  profileVisibility: "public",
  showEmail: false,
  showSocial: true,
  dataCollection: true,
  currentSession: null,
  apiKeys: [],
  externalApiKeys: [],
  webhooks: [],
  webhookLogs: [],
  webhooksLoaded: false,
};

const FONT_SIZE_PX: Record<string, string> = { small: "13px", medium: "15px", large: "17px" };

interface UseSettingsStateResult {
  state: SettingsState;
  setState: React.Dispatch<React.SetStateAction<SettingsState>>;
  loading: boolean;
  reload: () => void;
}

// Ports loadStateFromFirebase() — reads users/{uid}, plus the apiKeys
// collection for any IDs listed on the user doc. Also applies font-size
// and compact-mode to <body> on load, same as the original (these are
// document-wide visual effects, not scoped to the settings modal itself).
export function useSettingsState(): UseSettingsStateResult {
  const { user } = useAuth();
  const [state, setState] = useState<SettingsState>(DEFAULT_SETTINGS_STATE);
  const [loading, setLoading] = useState(true);
  const [reloadTick, setReloadTick] = useState(0);

  const load = useCallback(async () => {
    const current = auth.currentUser;
    if (!current) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const snap = await getDoc(doc(db, "users", current.uid));
      if (snap.exists()) {
        const d = snap.data() as any;
        const notifPrefs = d.notificationPrefs || {};

        let apiKeys: ApiKey[] = [];
        if (d.apiKeyIds && d.apiKeyIds.length) {
          const keySnaps = await Promise.all(
            (d.apiKeyIds as string[]).map((id) => getDoc(doc(db, "apiKeys", id)))
          );
          apiKeys = keySnaps.filter((s) => s.exists()).map((s) => ({ id: s.id, ...s.data() }));
        }

        const next: SettingsState = {
          displayName: d.displayName || d.username || current.displayName || "",
          username: d.username || d.displayName || "",
          email: current.email || "",
          profilePic: d.profilePic || current.photoURL || "",
          timezone: d.timezone || "America/New_York",
          language: d.language || "en",
          twoFactorEnabled: d.twoFactorEnabled || false,
          loginAlerts: d.loginAlerts !== false,
          emailNotifs: notifPrefs.emailNotifs !== false,
          pushNotifs: notifPrefs.pushNotifs !== false,
          inAppNotifs: notifPrefs.inAppNotifs !== false,
          marketingEmails: notifPrefs.marketingEmails || false,
          dealAlerts: notifPrefs.dealAlerts !== false,
          theme: d.theme?.name || "dark",
          fontSize: d.fontSize || "medium",
          compactMode: d.compactMode || false,
          plan: d.plan || "free",
          billingCycle: d.billingCycle || "monthly",
          paypalEmail: d.paypalEmail || "",
          profileVisibility: d.profileVisibility || "public",
          showEmail: d.showEmail || false,
          showSocial: d.showSocial !== false,
          dataCollection: d.dataCollection !== false,
          currentSession: null,
          apiKeys,
          externalApiKeys: d.externalApiKeys || [],
          webhooks: d.webhooks || [],
          webhookLogs: [],
          webhooksLoaded: false,
        };
        setState(next);

        // Apply font size + compact mode globally, same as the original.
        if (typeof document !== "undefined") {
          document.body.style.fontSize = FONT_SIZE_PX[next.fontSize] || "15px";
          if (next.compactMode) {
            document.body.classList.add("compact-mode");
            try {
              localStorage.setItem("srf_compactMode", "1");
            } catch {}
          } else {
            document.body.classList.remove("compact-mode");
            try {
              localStorage.removeItem("srf_compactMode");
            } catch {}
          }
        }
      }
    } catch (err) {
      console.error("[useSettingsState] load failed", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) load();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, reloadTick]);

  const reload = useCallback(() => setReloadTick((t) => t + 1), []);

  return { state, setState, loading, reload };
}

// Sessions are fetched lazily only when the Sessions panel is opened —
// ports the same "not loaded in loadStateFromFirebase" comment/behavior.
export async function fetchSessions(uid: string) {
  const snap = await getDocs(collection(db, "users", uid, "sessions"));
  return snap.docs.map((s) => ({ id: s.id, ...s.data() }));
}
