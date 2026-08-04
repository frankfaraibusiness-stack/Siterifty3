// /api/webhooks.js — Siterifty outbound webhook management + delivery + logs
// ─────────────────────────────────────────────────────────────────────────────
// This is a SENDER, not a receiver. Sellers register a URL on THEIR OWN
// server (their own domain, their own backend); when something happens on
// Siterifty (deal accepted, listing sold, etc.) we POST an event payload to
// that URL. We never host or run the seller's endpoint — that's on them,
// same model as Stripe/GitHub/Shopify webhooks. No 24/7 process required on
// our side either: delivery is just a fetch() call from inside a normal
// serverless invocation, fired from whichever action (deal.js, listings.js)
// triggered the event.
//
// POST /api/webhooks  { action, idToken, ...params }
//
//   action: 'webhook.list'   { idToken }
//                            → { ok: true, data: { webhooks: [...] } }
//                            Returns the caller's own registered webhooks.
//
//   action: 'webhook.add'    { idToken, url, events? }
//                            → { ok: true, data: { webhook } }
//                            `events` is a comma-separated string or array
//                            of event names, or omitted/blank for "all".
//                            URL is validated (https, not localhost/private
//                            IP — basic SSRF guard) before being stored.
//
//   action: 'webhook.delete' { idToken, id }
//                            → { ok: true, data: {} }
//
//   action: 'webhook.test'   { idToken, id }
//                            → { ok: true, data: { delivery } }
//                            Sends a synthetic `webhook.test` event to the
//                            given webhook immediately and returns the
//                            delivery result (status code, ok/fail, latency).
//
//   action: 'webhook.logs'   { idToken, id?, limit? }
//                            → { ok: true, data: { logs } }
//                            Delivery history for the caller's webhooks,
//                            newest first. `id` filters to one webhook.
//
// ── Internal (non-HTTP) export for other API files ──────────────────────────
//   import { dispatchWebhook } from './webhooks.js';
//   dispatchWebhook(uid, 'deal.accepted', { dealId, listingId, ... });
//
//   Fire-and-forget: looks up the user's active webhooks matching this
//   event, POSTs the payload to each (5s timeout), and writes one
//   `webhookDeliveries` doc per attempt regardless of outcome. Never throws
//   — a delivery failure must never break the caller's real operation.
//
// Firestore paths touched:
//   users/{uid}.webhooks               (array of { id, url, events, active, addedAt })
//   webhookDeliveries/{deliveryId}     (one doc per delivery attempt, any outcome)
//
// Response envelope (HTTP actions only): { ok: true, data } | { ok: false, error: { message, code } }
// ─────────────────────────────────────────────────────────────────────────────

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import crypto from 'crypto';

// ── Firebase Admin singleton — same pattern as deal.js/listings.js ──────────
function getAdminDb() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
  }
  return getFirestore();
}

// ── Firebase ID token verification — same pattern as deal.js/listings.js ───
const FIREBASE_WEB_API_KEY = 'AIzaSyCMdI_bIYse6j3GyGDBnbE6FoGNnPKaMao';

async function verifyFirebaseToken(idToken) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_WEB_API_KEY}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ idToken }),
    }
  );
  if (!res.ok) throw new ApiError('Invalid Firebase token', 'AUTH_INVALID', 401);
  const data = await res.json();
  const user = data.users?.[0];
  if (!user) throw new ApiError('User not found', 'AUTH_USER_NOT_FOUND', 401);
  return user; // { localId, email, ... }
}

class ApiError extends Error {
  constructor(message, code = 'INTERNAL', statusCode = 500) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

function ok(res, data = {}) {
  return res.status(200).json({ ok: true, data });
}
function fail(res, err) {
  const statusCode = err.statusCode || 500;
  const code = err.code || 'INTERNAL';
  const message = err.message || 'Internal error';
  return res.status(statusCode).json({ ok: false, error: { message, code } });
}

// ── Known event names — informational allow-list, not strictly enforced.
// A webhook can subscribe to 'all' or a comma-separated subset of these.
export const WEBHOOK_EVENTS = [
  'deal.created',
  'deal.accepted',
  'deal.rejected',
  'deal.cancelled',
  'escrow.funded',
  'escrow.delivered',
  'escrow.released',
  'escrow.refunded',
  'escrow.disputed',
  'listing.sold',
  'webhook.test',
];

const MAX_WEBHOOKS_PER_USER = 10;
const DELIVERY_TIMEOUT_MS = 5000;
const DELIVERY_LOG_RETENTION_DAYS = 30; // logs older than this are safe to prune (not auto-pruned yet — see note near handleLogs)

// ── Basic SSRF guard ─────────────────────────────────────────────────────────
// This is a best-effort check, not a complete SSRF defense (DNS rebinding
// can bypass a pure string check like this) — but it stops the obvious cases
// (localhost, private ranges, link-local) from ever being stored, which
// covers the overwhelming majority of accidental/malicious misconfigurations
// for a feature like this.
const BLOCKED_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);
function _isPrivateHost(hostname) {
  if (BLOCKED_HOSTS.has(hostname)) return true;
  // IPv4 private/link-local ranges
  const m = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [parseInt(m[1]), parseInt(m[2])];
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
  }
  return false;
}

function _validateWebhookUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new ApiError('Missing webhook URL', 'MISSING_URL', 400);
  }
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ApiError('Invalid URL', 'INVALID_URL', 400);
  }
  if (parsed.protocol !== 'https:') {
    throw new ApiError('Webhook URL must use https://', 'INVALID_URL_SCHEME', 400);
  }
  if (_isPrivateHost(parsed.hostname)) {
    throw new ApiError('Webhook URL cannot point to a private/local address', 'INVALID_URL_HOST', 400);
  }
  return parsed.toString();
}

function _parseEvents(events) {
  if (!events) return 'all';
  if (Array.isArray(events)) return events.filter(Boolean).join(',') || 'all';
  if (typeof events === 'string') {
    const trimmed = events.trim();
    return trimmed || 'all';
  }
  return 'all';
}

function _eventMatches(subscribed, event) {
  if (!subscribed || subscribed === 'all') return true;
  return subscribed.split(',').map(s => s.trim()).filter(Boolean).includes(event);
}

// ─────────────────────────────────────────────────────────────────────────────
// webhook.list / webhook.add / webhook.delete / webhook.test / webhook.logs
// ─────────────────────────────────────────────────────────────────────────────
async function handleList(idToken) {
  const fbUser = await verifyFirebaseToken(idToken);
  const db = getAdminDb();
  const snap = await db.collection('users').doc(fbUser.localId).get();
  const webhooks = snap.exists ? (snap.data().webhooks || []) : [];
  return { webhooks };
}

async function handleAdd(body, idToken) {
  const fbUser = await verifyFirebaseToken(idToken);
  const uid = fbUser.localId;
  const url = _validateWebhookUrl(body?.url);
  const events = _parseEvents(body?.events);

  const db = getAdminDb();
  const userRef = db.collection('users').doc(uid);

  const result = await db.runTransaction(async tx => {
    const snap = await tx.get(userRef);
    if (!snap.exists) throw new ApiError('User not found', 'USER_NOT_FOUND', 404);
    const existing = snap.data().webhooks || [];
    if (existing.length >= MAX_WEBHOOKS_PER_USER) {
      throw new ApiError(`You can register up to ${MAX_WEBHOOKS_PER_USER} webhooks`, 'WEBHOOK_LIMIT', 400);
    }
    if (existing.some(w => w.url === url)) {
      throw new ApiError('This URL is already registered', 'DUPLICATE_WEBHOOK', 400);
    }
    const webhook = {
      id: crypto.randomUUID(),
      url,
      events,
      active: true,
      addedAt: Date.now(),
    };
    tx.update(userRef, { webhooks: [...existing, webhook] });
    return { webhook };
  });

  return result;
}

async function handleDelete(body, idToken) {
  const fbUser = await verifyFirebaseToken(idToken);
  const uid = fbUser.localId;
  const { id } = body || {};
  if (!id) throw new ApiError('Missing webhook id', 'MISSING_ID', 400);

  const db = getAdminDb();
  const userRef = db.collection('users').doc(uid);

  await db.runTransaction(async tx => {
    const snap = await tx.get(userRef);
    if (!snap.exists) throw new ApiError('User not found', 'USER_NOT_FOUND', 404);
    const existing = snap.data().webhooks || [];
    const updated = existing.filter(w => w.id !== id);
    if (updated.length === existing.length) {
      throw new ApiError('Webhook not found', 'WEBHOOK_NOT_FOUND', 404);
    }
    tx.update(userRef, { webhooks: updated });
  });

  return {};
}

async function handleTest(body, idToken) {
  const fbUser = await verifyFirebaseToken(idToken);
  const uid = fbUser.localId;
  const { id } = body || {};
  if (!id) throw new ApiError('Missing webhook id', 'MISSING_ID', 400);

  const db = getAdminDb();
  const snap = await db.collection('users').doc(uid).get();
  const webhooks = snap.exists ? (snap.data().webhooks || []) : [];
  const webhook = webhooks.find(w => w.id === id);
  if (!webhook) throw new ApiError('Webhook not found', 'WEBHOOK_NOT_FOUND', 404);

  const delivery = await _deliver(uid, webhook, 'webhook.test', {
    message: 'This is a test event from Siterifty.',
    sentAt: Date.now(),
  });

  return { delivery };
}

async function handleLogs(body, idToken) {
  const fbUser = await verifyFirebaseToken(idToken);
  const uid = fbUser.localId;
  const { id, limit } = body || {};
  const size = Math.min(200, Math.max(1, Number(limit) || 50));

  const db = getAdminDb();
  // NOTE: delivery logs are not currently auto-pruned past
  // DELIVERY_LOG_RETENTION_DAYS — this constant is a documented intent, not
  // an enforced TTL yet. If log volume becomes a storage concern, wire a
  // scheduled cleanup (Vercel Cron, same pattern as deal.js's expiry sweep)
  // that deletes webhookDeliveries docs older than the retention window.
  let query = db.collection('webhookDeliveries')
    .where('uid', '==', uid)
    .orderBy('createdAt', 'desc')
    .limit(size);
  if (id) query = query.where('webhookId', '==', id);

  const querySnap = await query.get();
  const logs = querySnap.docs.map(d => ({ id: d.id, ...d.data() }));
  return { logs };
}

// ─────────────────────────────────────────────────────────────────────────────
// dispatchWebhook — internal export, called by deal.js/listings.js on real
// events. NEVER throws — a webhook delivery problem must never break the
// caller's actual operation (accepting a deal, marking a listing sold, etc).
// Fire-and-forget from the caller's side (caller should NOT await this in
// its critical path — call it and let it run, same as notifyDeal/
// triggerAiCheck elsewhere in this codebase).
// ─────────────────────────────────────────────────────────────────────────────
export async function dispatchWebhook(uid, event, payload) {
  try {
    if (!uid || !event) return;
    const db = getAdminDb();
    const snap = await db.collection('users').doc(uid).get();
    if (!snap.exists) return;
    const webhooks = snap.data().webhooks || [];
    const targets = webhooks.filter(w => w.active && _eventMatches(w.events, event));
    if (!targets.length) return;

    await Promise.all(targets.map(w => _deliver(uid, w, event, payload).catch(err => {
      console.error('[webhooks.js] dispatch failed (non-fatal)', uid, event, w.id, err.message);
    })));
  } catch (err) {
    console.error('[webhooks.js] dispatchWebhook error (non-fatal)', uid, event, err.message);
  }
}

// ── Actual HTTP delivery + logging, shared by dispatchWebhook and webhook.test ──
async function _deliver(uid, webhook, event, payload) {
  const startedAt = Date.now();
  const body = JSON.stringify({ event, data: payload, sentAt: startedAt });

  // Basic signature so the receiver can verify the payload actually came
  // from Siterifty, not a forged POST from anywhere else. Sellers verify by
  // recomputing HMAC-SHA256 over the raw body using a shared secret; since
  // we don't currently issue per-webhook secrets, this uses a stable server
  // secret — good enough for "did this come from us" but NOT per-webhook
  // secret rotation. Upgrade path: generate+store a random secret per
  // webhook at creation time (webhook.secret field) and sign with that
  // instead, returning the secret to the user once at creation.
  const signature = crypto
    .createHmac('sha256', process.env.WEBHOOK_SIGNING_SECRET || 'siterifty-default-signing-secret')
    .update(body)
    .digest('hex');

  let statusCode = null;
  let ok = false;
  let errorMessage = null;

  try {
    const res = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Siterifty-Event': event,
        'X-Siterifty-Signature': signature,
      },
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    statusCode = res.status;
    ok = res.status >= 200 && res.status < 300;
    if (!ok) errorMessage = `Received HTTP ${res.status}`;
  } catch (err) {
    errorMessage = err.name === 'TimeoutError' ? 'Request timed out' : (err.message || 'Delivery failed');
  }

  const latencyMs = Date.now() - startedAt;

  const delivery = {
    uid,
    webhookId: webhook.id,
    url: webhook.url,
    event,
    ok,
    statusCode,
    errorMessage,
    latencyMs,
    createdAt: FieldValue.serverTimestamp(),
  };

  try {
    const db = getAdminDb();
    await db.collection('webhookDeliveries').add(delivery);
  } catch (err) {
    // Logging failure should never mask the delivery result itself.
    console.error('[webhooks.js] failed to write delivery log (non-fatal)', uid, webhook.id, err.message);
  }

  return { ok, statusCode, errorMessage, latencyMs, event };
}

// ─────────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: { message: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' } });
  }

  const { action, idToken } = req.body || {};
  if (!idToken) {
    return fail(res, new ApiError('Missing auth token', 'AUTH_MISSING', 401));
  }

  try {
    switch (action) {
      case 'webhook.list':   return ok(res, await handleList(idToken));
      case 'webhook.add':    return ok(res, await handleAdd(req.body, idToken));
      case 'webhook.delete': return ok(res, await handleDelete(req.body, idToken));
      case 'webhook.test':   return ok(res, await handleTest(req.body, idToken));
      case 'webhook.logs':   return ok(res, await handleLogs(req.body, idToken));
      default:
        return fail(res, new ApiError('Unknown action', 'UNKNOWN_ACTION', 400));
    }
  } catch (err) {
    console.error('[webhooks.js]', action, err.message);
    return fail(res, err);
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
};
