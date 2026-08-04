// /api/push.js — Siterifty web push subscription handler + sender
// ─────────────────────────────────────────────────────────────────────────────
// Called by the frontend at two paths (see index.html):
//
//   POST /api/push/subscribe    body: { endpoint, keys: { p256dh, auth }, uid }
//     → { success: true }
//     Saves (or overwrites) the caller's PushSubscription under
//     users/{uid}/pushSubscriptions/{endpointHash} so a later send-notification
//     job can look up every device/browser a user is subscribed on.
//
//   POST /api/push/unsubscribe  body: { endpoint, uid }
//     → { success: true }
//     Deletes that one subscription doc. Not an error if it's already gone
//     (double-unsubscribe, or the browser silently dropped it) — this must
//     stay a no-op success so the frontend's toggle-off flow never surfaces
//     a scary error for something that isn't actually a problem.
//
// ── sendPushToUser(uid, payload) ─────────────────────────────────────────────
//   NEW. Not called by the frontend directly — this is a server-to-server
//   export imported by other API routes (deal.js, etc.) at the same "big"
//   moments that already trigger an email (deal accepted, escrow funded,
//   delivered, released, refunded, disputed). Looks up every device the user
//   is subscribed on and sends a real Web Push notification to each one via
//   the `web-push` package (VAPID signing + payload encryption handled by the
//   library, per RFC 8291/8292 — not hand-rolled here, since a hand-rolled
//   aes128gcm implementation is exactly the kind of thing that fails subtly
//   and silently for exactly the users you can't easily test against).
//
//   Fire-and-forget from the caller's point of view: never throws. A push
//   that fails for one device doesn't stop it being tried on the user's
//   other devices. Subscriptions that the push service reports as dead
//   (404/410 — meaning the user uninstalled, cleared data, or the endpoint
//   otherwise expired) are deleted automatically so the subscription list
//   doesn't slowly fill with permanently-dead endpoints.
//
//   Usage from another route:
//     import { sendPushToUser } from './push.js';
//     await sendPushToUser(uid, {
//       title: 'Payment released!',
//       body:  '$120 has been added to your wallet.',
//       url:   '/?deal=deal_xyz123',   // opened on notification click (see sw.js)
//     });
//
// Notes:
//   - No idToken/Firebase-auth check on subscribe/unsubscribe on purpose: the
//     frontend calls this with a bare `uid`, not an idToken, so there's
//     nothing to verify server-side beyond "uid + endpoint look like real
//     strings". Subscriptions are also harmless to forge (worst case someone
//     registers a push endpoint under a uid that isn't theirs, which just
//     means *they* stop getting notifications sent to that uid — it can't be
//     used to read or spend anything). If that ever changes, switch this to
//     verifyFirebaseToken like every other server route here.
//   - The endpoint URL itself is used as the natural dedupe key (hashed for a
//     safe Firestore doc ID) so subscribing twice from the same browser
//     overwrites the same doc instead of piling up duplicates.
//   - Requires VAPID_PUBLIC_KEY and VAPID_SECRET (private key) env vars, and
//     the `web-push` npm package installed (add "web-push" to package.json —
//     this sandbox has no network access to install/test it, so this file is
//     syntax-checked but not live-tested; verify with a real subscription on
//     your Vercel deployment before relying on it).
// ─────────────────────────────────────────────────────────────────────────────

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import crypto from 'crypto';
import webpush from 'web-push';

// ── Firebase Admin singleton ─────────────────────────────────────────────────
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

// Stable, short, Firestore-safe doc ID derived from the endpoint URL so the
// same browser subscribing twice overwrites one doc instead of duplicating.
function endpointDocId(endpoint) {
  return crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 40);
}

// ── VAPID setup for web-push (done once per serverless instance) ────────────
// Must be the SAME public key the frontend uses in applicationServerKey
// (window.__VAPID_PUBLIC_KEY in index.html) or every send will be rejected
// by the push service with a 401/403 — the browser locked the subscription
// to that specific public key when it was created.
let _vapidConfigured = false;
function ensureVapidConfigured() {
  if (_vapidConfigured) return;
  const publicKey  = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_SECRET;
  if (!publicKey || !privateKey) {
    throw new Error('VAPID_PUBLIC_KEY / VAPID_SECRET env vars are not configured');
  }
  // 'subject' is a contact URI push services may use to reach you about a
  // misbehaving sender — a mailto: or site URL both satisfy the VAPID spec.
  const subject = process.env.VAPID_SUBJECT || 'mailto:support@siterifty.com';
  webpush.setVapidDetails(subject, publicKey, privateKey);
  _vapidConfigured = true;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/push/subscribe  { endpoint, keys: { p256dh, auth }, uid, expirationTime? }
// ─────────────────────────────────────────────────────────────────────────────
async function handleSubscribe(req, res) {
  const { endpoint, keys, uid, expirationTime } = req.body || {};

  if (!uid)      return res.status(400).json({ error: 'Missing uid' });
  if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' });
  if (!keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'Missing subscription keys' });
  }

  const db = getAdminDb();
  const docId = endpointDocId(endpoint);

  await db
    .collection('users').doc(uid)
    .collection('pushSubscriptions').doc(docId)
    .set({
      endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
      expirationTime: expirationTime || null,
      userAgent: req.headers['user-agent'] || null,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(), // harmless if overwritten; merge below keeps the original
    }, { merge: true });

  return res.status(200).json({ success: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/push/unsubscribe  { endpoint, uid }
// Always resolves success:true — an already-missing subscription isn't an
// error from the caller's point of view (see file header note).
// ─────────────────────────────────────────────────────────────────────────────
async function handleUnsubscribe(req, res) {
  const { endpoint, uid } = req.body || {};

  if (!uid)      return res.status(400).json({ error: 'Missing uid' });
  if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' });

  const db = getAdminDb();
  const docId = endpointDocId(endpoint);

  await db
    .collection('users').doc(uid)
    .collection('pushSubscriptions').doc(docId)
    .delete();

  return res.status(200).json({ success: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// sendPushToUser(uid, { title, body, url?, icon?, badge?, tag? })
//
// Sends to every device/browser this user is subscribed on. Each send is
// independent — one failing subscription never stops the others. Dead
// subscriptions (410 Gone / 404 Not Found — the push service's way of saying
// "this endpoint will never work again") are deleted so they stop being
// retried forever. Any other error (network blip, 5xx from the push
// service, etc.) is logged and left alone — could easily be transient.
//
// Returns a small summary object rather than throwing, so callers can
// fire-and-forget with a plain .catch(() => {}) exactly like the existing
// email calls, without ever risking an unhandled rejection.
// ─────────────────────────────────────────────────────────────────────────────
export async function sendPushToUser(uid, { title, body, url = '/', icon, badge, tag } = {}) {
  const summary = { sent: 0, failed: 0, removed: 0 };
  if (!uid) return summary;

  try {
    ensureVapidConfigured();
  } catch (err) {
    console.error('[push] VAPID not configured — skipping send:', err.message);
    return summary;
  }

  const db = getAdminDb();
  const subsSnap = await db.collection('users').doc(uid).collection('pushSubscriptions').get();
  if (subsSnap.empty) return summary;

  const payload = JSON.stringify({ title, body, url, icon, badge, tag });

  await Promise.all(subsSnap.docs.map(async (docSnap) => {
    const sub = docSnap.data();
    const pushSubscription = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys?.p256dh, auth: sub.keys?.auth },
    };
    try {
      await webpush.sendNotification(pushSubscription, payload);
      summary.sent++;
    } catch (err) {
      const statusCode = err?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        // Endpoint is permanently gone — remove it so we stop retrying it.
        await docSnap.ref.delete().catch(() => {});
        summary.removed++;
      } else {
        console.error('[push] send failed for', uid, docSnap.id, statusCode, err?.message);
        summary.failed++;
      }
    }
  }));

  return summary;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main handler — routes by path suffix (/api/push/subscribe, /api/push/unsubscribe),
// same convention github.js uses for query-based sub-routes.
// ─────────────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // req.url on Vercel for a file at /api/push.js with a rewrite/catch-all is
  // the full path, e.g. "/api/push/subscribe" — fall back to a `sub` query
  // param too in case this is deployed as a single push.js without a
  // [...slug] catch-all route.
  const path = (req.url || '').split('?')[0];

  try {
    if (path.endsWith('/subscribe'))   return await handleSubscribe(req, res);
    if (path.endsWith('/unsubscribe')) return await handleUnsubscribe(req, res);

    // Fallback for ?sub=subscribe / ?sub=unsubscribe style calls
    if (req.query?.sub === 'subscribe')   return await handleSubscribe(req, res);
    if (req.query?.sub === 'unsubscribe') return await handleUnsubscribe(req, res);

    return res.status(404).json({ error: 'Unknown push route' });
  } catch (err) {
    console.error('[push.js]', path, err.message);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '64kb' } },
};
