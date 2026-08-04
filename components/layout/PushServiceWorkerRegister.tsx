"use client";

import { useEffect } from "react";
import { registerServiceWorker, isPushSupported } from "@/lib/push";

// Ports the service-worker registration block from core-early.js (which
// ran inline in <head>, before body/scripts existed, so the registration
// promise was ready as early as possible). This app doesn't have a
// pre-hydration <head> script slot for arbitrary JS the way a static
// index.html does, so the earliest equivalent is a client component
// mounted at the root layout — it fires once on first paint, well before
// any push toggle (NavDrawer, NotificationsPanel) could plausibly be
// clicked. Renders nothing; registerServiceWorker() caches its own
// promise, so this is the "prime the cache" call and every toggle's own
// call into the same helper is instant after this resolves.
export default function PushServiceWorkerRegister() {
  useEffect(() => {
    if (!isPushSupported()) return;
    registerServiceWorker().catch((err) => {
      console.error("[sw] registration failed:", err);
    });
  }, []);

  return null;
}
