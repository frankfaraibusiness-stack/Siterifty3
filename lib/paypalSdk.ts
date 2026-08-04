// Ports window.__loadPaypalSdk / window.__paypalNamespaceFor from
// Js/paypal.js (index.html lines 1352-1393).
//
// IMPORTANT: every PayPal SDK <script> tag defines the SAME global,
// window.paypal, by default — regardless of its query params. Since this
// app needs two incompatible configs on the same page (wallet deposit
// uses intent=capture, plan subscriptions need intent=subscription&
// vault=true), loading both as plain script tags means whichever one
// finishes loading LAST silently overwrites window.paypal, and the other
// flow's buttons render broken/blank. PayPal's own SDK also rejects
// loading the *same* client-id twice as bare script tags with a 400.
//
// Fix: give every config *except* the default capture one its own
// window global via data-namespace, so each caller reads from the right
// place instead of racing for window.paypal.
//
// Kept as a plain module-scope cache (not React state) since it's a
// browser-global side effect by nature — same shape as the original.

export const PAYPAL_CLIENT_ID =
  "BAA7e7yB7T4iXJXNnBYSZk2soa7xnchIK1HVrBZE04tvmrM-gtDHXjGz4QMB3eN1CP9Dt4382aDBAf_hPo";

declare global {
  interface Window {
    paypal?: any;
    paypalSubscriptions?: any;
    [key: string]: any;
  }
}

const _sdkPromises: Record<string, Promise<any>> = {};

function namespaceFor(querySuffix: string): string {
  if (querySuffix.includes("intent=subscription")) return "paypalSubscriptions";
  return "paypal"; // default capture/deposit flow keeps window.paypal
}

// Returns a promise that resolves once the SDK is ready to use with that
// config. Safe to call multiple times with the same suffix — later
// callers just await the same in-flight/resolved load.
export function loadPaypalSdk(querySuffix: string): Promise<any> {
  if (_sdkPromises[querySuffix]) return _sdkPromises[querySuffix];
  const ns = namespaceFor(querySuffix);
  _sdkPromises[querySuffix] = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://www.paypal.com/sdk/js?client-id=${PAYPAL_CLIENT_ID}&${querySuffix}`;
    if (ns !== "paypal") s.setAttribute("data-namespace", ns);
    s.onload = () => resolve(window[ns]);
    s.onerror = () => reject(new Error("Failed to load PayPal SDK"));
    document.head.appendChild(s);
  });
  return _sdkPromises[querySuffix];
}
