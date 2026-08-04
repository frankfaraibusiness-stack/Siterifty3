// Ports the "── PUSH NOTIFICATIONS (VAPID) ──" setup from core-early.js
// (service worker registration + VAPID key/base64 helper, previously run
// inline in <head> before body/scripts existed) plus the subscribe/
// unsubscribe logic duplicated across auth-modal.js's nav drawer toggle
// and support-modals.js's Settings → Notifications panel toggle — both
// call the exact same three steps (permission → pushManager.subscribe →
// POST /api/push/subscribe), so this file is the single shared
// implementation both NavDrawer and NotificationsPanel import instead of
// re-duplicating it a third time.
//
// Same public key the original hardcoded in core-early.js — a VAPID
// *public* key is safe to ship client-side by design (same reasoning as
// Firebase's public client config in lib/firebase.ts): it only lets a
// browser lock a subscription to this server's private key, it can't be
// used to send anything or read anything on its own.
export const VAPID_PUBLIC_KEY =
  "BKOnoHtW3YHbUmreywtakPiimC7NGiCPPfNd24kOACD2G8xwsJ9FI6AsUtGzgdIRpwCNO9mc2pSBnkHWymTEBhw";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return new Uint8Array([...rawData].map((c) => c.charCodeAt(0)));
}

// Module-level cache so every caller (NavDrawer, NotificationsPanel,
// anything else) shares one registration promise instead of each
// registering /sw.js separately — mirrors window.__swReady being set
// once in core-early.js and read everywhere else.
let swReady: Promise<ServiceWorkerRegistration> | null = null;

export function isPushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
}

// Ports navigator.serviceWorker.register('/sw.js') from core-early.js.
// Call this once, early (see PushSwRegister below) — every other push
// helper here awaits this same cached promise rather than re-registering.
export function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  if (!isPushSupported()) {
    return Promise.reject(new Error("serviceWorker not supported"));
  }
  if (!swReady) {
    swReady = navigator.serviceWorker.register("/sw.js").catch((err) => {
      swReady = null; // allow a retry on next call instead of caching a permanent rejection
      throw err;
    });
  }
  return swReady;
}

export async function getCurrentPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  try {
    const reg = await registerServiceWorker();
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

export interface PushToggleResult {
  ok: boolean;
  message: string;
}

// Ports the subscribe() function shared by both the nav drawer toggle
// (auth-modal.js) and the Settings panel toggle (support-modals.js):
// request permission → pushManager.subscribe → POST the subscription +
// uid to /api/push/subscribe. Server save failures are non-fatal in the
// original (logged, not thrown) — the browser subscription itself is
// what matters for the toggle's own state; a failed server save just
// means this device won't receive pushes until the next successful sync,
// which callers can't do much about beyond surfacing the message.
export async function subscribeToPush(uid: string): Promise<PushToggleResult> {
  if (!isPushSupported()) {
    return { ok: false, message: "Push not supported in this browser." };
  }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") {
    return { ok: false, message: "Notification permission denied." };
  }
  const reg = await registerServiceWorker();
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
  });
  try {
    await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...sub.toJSON(), uid }),
    });
  } catch (err) {
    console.warn("[push] server save failed (non-fatal):", err);
  }
  return { ok: true, message: "Push notifications enabled." };
}

// Ports the unsubscribe() function shared by both toggles: read the
// current subscription, unsubscribe it in the browser, then tell the
// server so it stops trying to send to a now-dead endpoint.
export async function unsubscribeFromPush(uid: string): Promise<PushToggleResult> {
  if (!isPushSupported()) return { ok: true, message: "" };
  try {
    const reg = await registerServiceWorker();
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      try {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint, uid }),
        });
      } catch (err) {
        console.warn("[push] server unsubscribe failed (non-fatal):", err);
      }
    }
    return { ok: true, message: "Push notifications disabled." };
  } catch (err) {
    console.error("[push] unsubscribe error:", err);
    return { ok: false, message: "Could not disable notifications." };
  }
}
