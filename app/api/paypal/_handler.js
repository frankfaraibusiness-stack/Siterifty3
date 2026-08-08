// /api/paypal.js — Siterifty server-side PayPal handler
// All money operations go through here. Frontend never touches Firestore for money.
//
// Actions (POST body: { action, ...params }):
//   create-order   → DISABLED. PayPal deposits are no longer offered — Siterifty
//                    holds user balances (escrow, wallet), and running that kind
//                    of money transmission through PayPal's standard checkout
//                    violates their acceptable-use terms for platforms holding
//                    customer funds. PayPal is still used for the Pro
//                    subscription only (get-plan-id/activate-sub/cancel-sub
//                    below), which is a normal recurring charge to Siterifty,
//                    not custody of user funds. See handleCreateOrder for the
//                    stub response. A new deposit provider will replace this.
//   capture-order  → DISABLED, same reasoning as create-order. Also stops
//                    issuing/saving PayPal vault tokens — Auto Top-Up (which
//                    depended on the vault) is removed along with it.
//   get-plan-id    → subscription: return plan_id (never exposed in HTML)
//   activate-sub   → subscription: verify ACTIVE with PayPal, write plan to Firestore
//   cancel-sub     → subscription: cancel PayPal billing + downgrade to free
//   withdraw       → wallet: debit balance, write pending withdrawal record.
//                    method is 'paypal' | 'bank' | 'bitcoin' — payout itself is
//                    always a manual step done outside this codebase (see
//                    handleWithdraw's own comment); this just validates the
//                    right fields for the chosen method and records the request.
//   lookup-recipient → wallet: resolve a user by email for P2P transfer (server-side only —
//                      the client never queries the users collection directly for this)
//   transfer       → wallet: server-validated P2P balance transfer between two users
//   boost-listing  → marketplace: debit wallet, set listings/{id}.boostedUntil so the
//                     listing surfaces first in its type group in the feed algorithm.
//                     Price is looked up server-side from BOOST_PLANS — the client only
//                     ever sends `days`, never a price, so it cannot pay less than listed.
//   [webhook]      → PayPal billing events: renewals, cancellations, payment failures
//
// ── Auto Top-Up ────────────────────────────────────────────────────────────
//   REMOVED. Auto Top-Up charged a saved PayPal vault token whenever the
//   balance dropped below a threshold — it only made sense while PayPal
//   deposits existed. autotopup-get/autotopup-save actions and
//   maybeAutoTopUp are gone (call sites that used to await maybeAutoTopUp
//   after a debit now simply don't — nothing else depended on its return
//   value, since it was always fire-and-forget).
//
// ── Auto Send (recurring P2P payments) ────────────────────────────────────
//   autosend-create   → schedule a repeating transfer to another user every
//                        N days (1, 3, 7, 14, 21, or 30) until cancelled
//   autosend-list     → list the caller's active/paused/cancelled schedules
//   autosend-cancel   → cancel a schedule (no further charges)
//   autosend-run      → cron entry point (see config.autoSendCronSecret) —
//                        processes every schedule whose nextRunAt is due,
//                        deducts from the payer, credits the payee, and logs
//                        success/failure (insufficient balance, missing
//                        recipient, etc.) to both users' transaction logs
//
// ── Auto Withdrawal (wallet settings) ─────────────────────────────────────
//   autowithdraw-get   → read the caller's auto withdrawal settings
//   autowithdraw-save  → enable/disable + set threshold/keepBalance/payout
//                         method (PayPal email, bank details, or BTC address
//                         on file)
//   Like auto top-up used to, auto withdrawal is not a separate action the
//   client calls to "run" it — it runs server-side (maybeAutoWithdraw) right
//   after any successful credit to withdrawableBalance (referral bonus, P2P
//   transfer received, auto send received — and escrow release, called from
//   /api/deal). If the resulting withdrawable balance is at/above the user's
//   threshold, it automatically files a payout request for everything above
//   their configured "keep" floor, using the exact same pending-withdrawal
//   pipeline as a manual withdraw request (same `withdrawals` collection,
//   same transaction record shape) — it just skips the manual button tap.
//
// ── Escrow actions ──────────────────────────────────────────────────────────
// escrow-pay / escrow-deliver / escrow-release / escrow-refund / escrow-dispute
// have been moved to /api/deal (deal.js) alongside the deal lifecycle actions.
// Update frontend callers to POST to /api/deal for all escrow actions.

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from '../../../lib/server/adminDb';
import { LIMITS } from '../_lib/limits.js';
import crypto from 'crypto';

// ── Plan IDs hardcoded here (private repo) — not in frontend HTML ────────────
// Replace these with your real PayPal plan IDs from developer.paypal.com
const PLAN_IDS = {
  starter: 'P-1PS58089939783309NJRHMJQ',
  growth:  'P-5DY44028H9297735ENJRHNNA',
  pro:     'P-3W326687TA376614CNJRHOJQ',
};

// ── Boost Listing pricing — single source of truth is LIMITS.boost.plans in
//    limits.js (mirrored to frontend for display only; this file is still
//    what actually gets enforced — it never trusts a client-sent price).
//    Reshaped here into a days -> price lookup map for handleBoostListing. ───
const BOOST_PLANS = Object.fromEntries(LIMITS.boost.plans.map(p => [p.days, p.price]));

// ── Auto Send: allowed recurring intervals, in days — from limits.js ────────
const AUTOSEND_INTERVALS = LIMITS.autoSend.intervals;

// Auto Top-Up (and its bounds constants) removed along with PayPal deposits.

// ── Auto Withdrawal: sane server-side bounds, mirroring auto top-up's
//    pattern. Ideally sourced from LIMITS.autoWithdraw in limits.js (add it
//    there alongside autoTopUp/autoSend for a single source of truth shared
//    with the frontend); falls back to reasonable defaults if that block
//    doesn't exist yet so this doesn't hard-crash on deploy. ─────────────────
const AUTOWITHDRAW_MIN_THRESHOLD = LIMITS.autoWithdraw?.minThreshold ?? 10;
const AUTOWITHDRAW_MAX_THRESHOLD = LIMITS.autoWithdraw?.maxThreshold ?? 10000;
const AUTOWITHDRAW_MIN_KEEP      = LIMITS.autoWithdraw?.minKeepBalance ?? 0;
const AUTOWITHDRAW_MAX_KEEP      = LIMITS.autoWithdraw?.maxKeepBalance ?? 10000;
// Debounce window, same idea as autoTopUp.lastAttemptAt — stops several
// credits landing in quick succession from firing overlapping payouts.
const AUTOWITHDRAW_DEBOUNCE_MS = 2 * 60 * 1000;

// ── Cron secret for the autosend-run sweep. Set AUTOSEND_CRON_SECRET in env
//    and point your scheduler (Vercel Cron / cron-job.org / etc.) at
//    POST /api/paypal { action: 'autosend-run', cronSecret }
//    on whatever cadence you like (hourly is plenty since nextRunAt is
//    checked against "now" — a schedule only actually fires once it's due).
const AUTOSEND_CRON_SECRET = process.env.AUTOSEND_CRON_SECRET || null;


// ── Firebase Admin singleton ─────────────────────────────────────────────────
// Shared init — see lib/server/adminDb.ts.

// ── Admin session verification ───────────────────────────────────────────────
// Mirrors admin.js's cookie sign/verify exactly (same COOKIE_NAME, same
// SESSION_SECRET, same HMAC-SHA256 format: base64url(payload) + "." + hex
// sig) so a session created by logging into admin.html is valid here too,
// without needing a second login or a cross-file import (each Vercel
// function is bundled independently). Used to gate admin-only actions in
// this file (payout approve/reject) that must NOT be reachable with a
// regular user's Firebase idToken.
const ADMIN_COOKIE_NAME = 'admin_session';
function verifyAdminSession(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) cookies[k] = decodeURIComponent(v);
  });
  const raw = cookies[ADMIN_COOKIE_NAME];
  if (!raw) return null;
  const dotIdx = raw.lastIndexOf('.');
  if (dotIdx === -1) return null;
  const payloadB64 = raw.slice(0, dotIdx);
  const sig = raw.slice(dotIdx + 1);
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  const expectedSig = crypto.createHmac('sha256', secret).update(payloadB64).digest('hex');
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expectedSig, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload.exp || Date.now() > payload.exp) return null;
  return payload; // { email, iat, exp }
}

// ── PayPal OAuth token (cached per cold-start) ───────────────────────────────
let _ppToken = null;
let _ppTokenExp = 0;

async function getPayPalToken() {
  if (_ppToken && Date.now() < _ppTokenExp) return _ppToken;
  const base = ppBase();
  const res = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(
        `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
      ).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`PayPal OAuth failed: ${res.status}`);
  const data = await res.json();
  _ppToken    = data.access_token;
  _ppTokenExp = Date.now() + (data.expires_in - 60) * 1000;
  return _ppToken;
}

function ppBase() {
  return 'https://api-m.paypal.com';
}

// ── Firebase ID token verification via REST ──────────────────────────────────
// Using the public web API key — already hardcoded in index.html, not a secret
const FIREBASE_WEB_API_KEY = 'AIzaSyCMdI_bIYse6j3GyGDBnbE6FoGNnPKaMao';

async function verifyFirebaseToken(idToken) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_WEB_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    }
  );
  if (!res.ok) throw new Error('Invalid Firebase token');
  const data = await res.json();
  const user = data.users?.[0];
  if (!user) throw new Error('User not found');
  return user; // { localId, email, ... }
}

// ── Platform fee recipient (P2P transfer fee, donations) ─────────────────────
// handleTransfer's TRANSFER_FEE_RATE cut (and handleDonate's flat rate) is
// credited to this account's wallet rather than just being deducted and
// going nowhere. The account is identified by email, set via the
// ADMIN_EMAIL environment variable (set in Vercel → Project → Settings →
// Environment Variables) — never hardcoded here, so the fee recipient can
// be changed without touching code or redeploying from source.
// Resolved once by email and cached in memory for the life of the serverless
// instance — same pattern used for the escrow platform fee in deal.js. A
// query-by-email has no place inside the money-moving transaction below, so
// this resolves ahead of time instead.
//
// Lowercased at read time: Firebase Auth normalizes user emails to lowercase
// on the users/{uid} doc, but there's nothing stopping ADMIN_EMAIL from being
// entered with different casing in Vercel (e.g. 'Siterifty@gmail.com') — a
// Firestore '==' query is case-sensitive, so that mismatch alone silently
// fails the lookup even though the account exists. Normalizing here means
// casing in the env var can never cause this again. Same fix as deal.js —
// both files must stay in sync on this.
//
// Returns null (does NOT throw) if ADMIN_EMAIL is unset or the account can't
// be found — transfers/donations must never block over a platform
// misconfiguration. Callers fall back to crediting the fee into the
// platformFeesUnclaimed ledger (see _ledgerUnclaimedFee below) instead of a
// live wallet when this returns null, so the fee is still deducted and
// fully accounted for per-user, just not yet delivered anywhere — nothing
// is silently discarded.
const PLATFORM_FEE_ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase() || null;
let _platformFeeAdminUidCache = null;

async function getPlatformFeeAdminUid(db) {
  if (_platformFeeAdminUidCache) return _platformFeeAdminUidCache;
  if (!PLATFORM_FEE_ADMIN_EMAIL) {
    console.error('[paypal.js] ADMIN_EMAIL is not set — platform fees will be ledgered as unclaimed instead of credited live. Set it in Vercel → Project → Settings → Environment Variables.');
    return null;
  }
  const snap = await db.collection('users')
    .where('email', '==', PLATFORM_FEE_ADMIN_EMAIL)
    .limit(1)
    .get();
  if (snap.empty) {
    console.error(`[paypal.js] Platform fee admin account (${PLATFORM_FEE_ADMIN_EMAIL}) not found — platform fees will be ledgered as unclaimed instead of credited live.`);
    return null;
  }
  _platformFeeAdminUidCache = snap.docs[0].id;
  return _platformFeeAdminUidCache;
}

// ── Unclaimed platform fees ledger ───────────────────────────────────────────
// Used whenever a platform fee is correctly computed and deducted from the
// paying party, but there's nowhere to credit it live (ADMIN_EMAIL unset or
// unresolvable). The fee is NEVER silently discarded and the payer's own
// transaction record always shows the real amount they were charged — this
// ledger exists purely so the *platform's* side of that same fee isn't lost
// while the admin account is misconfigured. Each doc is one such instance,
// fully attributed (who, what transfer/donation, how much, when) so a
// follow-up script can sweep platformFeesUnclaimed into the real admin
// wallet once ADMIN_EMAIL is fixed, crediting the exact right historical
// amount. Same shape/collection as deal.js's copy of this helper — both
// files write into the same 'platformFeesUnclaimed' collection.
async function _ledgerUnclaimedFee(db, { amount, source, sourceId, payerUid, counterpartyUid, note }) {
  try {
    await db.collection('platformFeesUnclaimed').add({
      amount,
      source,          // 'p2p_transfer' | 'donation' | 'escrow_release'
      sourceId,
      payerUid,
      counterpartyUid,
      note,
      claimed: false,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    // Ledger write is best-effort logging on top of a fee that's already
    // been correctly deducted inside the real transaction — never let a
    // ledger failure retroactively break or reverse that.
    console.error('[paypal.js] failed to write unclaimed-fee ledger entry (non-fatal)', err.message);
  }
}

// ── PayPal webhook signature verification ────────────────────────────────────
async function verifyWebhookSignature(headers, rawBody) {
  const token = await getPayPalToken();
  const res = await fetch(`${ppBase()}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      auth_algo:         headers['paypal-auth-algo'],
      cert_url:          headers['paypal-cert-url'],
      transmission_id:   headers['paypal-transmission-id'],
      transmission_sig:  headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'],
      webhook_id:        process.env.PAYPAL_WEBHOOK_ID,
      webhook_event:     JSON.parse(rawBody),
    }),
  });
  if (!res.ok) return false;
  const data = await res.json();
  return data.verification_status === 'SUCCESS';
}

// ── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // PayPal webhook calls arrive without an action field but with PayPal headers
  if (req.headers['paypal-transmission-id']) {
    return handleWebhook(req, res);
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action } = req.body || {};

  try {
    switch (action) {
      case 'create-order':      return await handleCreateOrder(req, res);
      case 'capture-order':     return await handleCaptureOrder(req, res);
      case 'get-plan-id':       return await handleGetPlanId(req, res);
      case 'activate-sub':      return await handleActivateSub(req, res);
      case 'cancel-sub':        return await handleCancelSub(req, res);
      case 'withdraw':          return await handleWithdraw(req, res);
      case 'admin-resolve-withdrawal': return await handleAdminResolveWithdrawal(req, res);
      case 'lookup-recipient':  return await handleLookupRecipient(req, res);
      case 'transfer':          return await handleTransfer(req, res);
      case 'donate':            return await handleDonate(req, res);
      case 'get-donations':     return await handleGetDonations(req, res);
      case 'boost-listing':     return await handleBoostListing(req, res);
      case 'wallet-summary':    return await handleWalletSummary(req, res);
      // autotopup-get / autotopup-save removed — Auto Top-Up depended on the
      // PayPal vault, which no longer exists now that deposits are disabled.
      case 'autowithdraw-get':  return await handleAutoWithdrawGet(req, res);
      case 'autowithdraw-save': return await handleAutoWithdrawSave(req, res);
      case 'autosend-create':   return await handleAutoSendCreate(req, res);
      case 'autosend-list':     return await handleAutoSendList(req, res);
      case 'autosend-cancel':   return await handleAutoSendCancel(req, res);
      case 'autosend-run':      return await handleAutoSendRun(req, res);
      default:
        return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (err) {
    console.error('[paypal.js]', action, err.message);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// create-order  { idToken, amount, useVault? }  →  { orderID, usedVault }
//
// Two paths:
//   A) Normal (first deposit or no vault on file):
//      Creates order with store_in_vault: "ON_SUCCESS" so PayPal silently vaults
//      the payment method if the buyer consents. No extra friction for the buyer.
//      The vault ID (if issued) is saved during capture-order.
//
//   B) Vault token reuse (repeat deposits, useVault: true):
//      If paypalVaultId is stored on the user doc, we pass it directly as
//      payment_source.token — the buyer skips the PayPal popup entirely.
//      Falls back to path A if the stored token is stale or invalid.
// ─────────────────────────────────────────────────────────────────────────────
// PayPal deposits are disabled — see the top-of-file comment. Left as a
// named stub (rather than deleting the case label) so a re-enable, or
// swapping in the new deposit provider, is a small diff instead of
// reconstructing routing/validation from scratch.
async function handleCreateOrder(req, res) {
  return res.status(410).json({
    error: 'PayPal deposits are no longer available. Adding funds will use a new payment provider — check back soon.',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// capture-order  { idToken, orderID }  →  { success, amount, newBalance, vaultSaved? }
//
// After a successful capture we check the PayPal response for a vault token.
// PayPal includes payment_source.paypal.attributes.vault.id when it has vaulted
// the buyer's payment method (i.e. the buyer consented during checkout).
// We save paypalVaultId + paypalVaultEmail on the user doc so future deposits
// can use Path B in create-order (no popup, instant charge).
// ─────────────────────────────────────────────────────────────────────────────
// PayPal deposits are disabled — see the top-of-file comment.
async function handleCaptureOrder(req, res) {
  return res.status(410).json({
    error: 'PayPal deposits are no longer available. Adding funds will use a new payment provider — check back soon.',
  });
}

// maybeAutoTopUp (and the PayPal vault it charged) has been removed along
// with PayPal deposits — see the top-of-file comment. Its former call
// sites (withdraw, transfer, donate, autosend-run, boost-listing) simply
// no longer call it; none of them used its return value.

// ─────────────────────────────────────────────────────────────────────────────
// maybeAutoWithdraw(db, uid)
//
// The credit-side mirror of maybeAutoTopUp. Called (awaited, but never
// allowed to throw back to the caller) right after any successful credit to
// withdrawableBalance — referral bonus (activate-sub), P2P transfer received
// (transfer), auto send received (autosend-run), and escrow release (called
// from /api/deal's handleEscrowRelease — see note in handleWithdraw's doc
// comment above). Checks whether the resulting withdrawable balance is at or
// above the user's configured threshold, and if so, automatically files a
// payout request for the amount above their configured "keep" floor.
//
// This deliberately reuses the exact same mechanics as a manual withdraw
// request (handleWithdraw): debit walletBalance/withdrawableBalance, credit
// pendingBalance, write a `withdraw` transaction record, and write a
// `withdrawals` collection doc with status 'pending' — so an auto-filed
// withdrawal is indistinguishable from a manual one anywhere downstream
// (admin payout tooling, History list, etc.) except for its `auto: true`
// flag and `autowithdraw` transaction type.
//
// Settings live at users/{uid}.autoWithdraw =
//   { enabled, threshold, keepBalance, method, paypalEmail }
// Runs OUTSIDE the caller's transaction (own fresh read + own transaction),
// same reasoning as maybeAutoTopUp — an auto-withdraw failure must never
// roll back the credit that triggered it. Every attempt is logged to the
// transactions subcollection so History shows exactly what happened.
// ─────────────────────────────────────────────────────────────────────────────
async function maybeAutoWithdraw(db, uid) {
  try {
    const userRef  = db.collection('users').doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) return;
    const data = userSnap.data();

    const cfg = data.autoWithdraw;
    if (!cfg || !cfg.enabled) return;

    const threshold   = Number(cfg.threshold || 0);
    const keepBalance = Number(cfg.keepBalance || 0);
    const paypalEmail = cfg.paypalEmail;
    const method      = cfg.method === 'bank' ? 'bank' : 'paypal';
    if (!threshold || !paypalEmail) return;

    const withdrawable = Number(data.withdrawableBalance || 0);
    if (withdrawable < threshold) return; // below threshold — nothing to do

    // Debounce: don't fire again within the window of the last attempt, in
    // case several credits land in quick succession before the first
    // auto-withdrawal has finished writing.
    const lastAttempt = cfg.lastAttemptAt?.toMillis?.() || 0;
    if (Date.now() - lastAttempt < AUTOWITHDRAW_DEBOUNCE_MS) return;

    await userRef.update({ 'autoWithdraw.lastAttemptAt': FieldValue.serverTimestamp() });

    // Withdraw everything above the configured "keep" floor.
    const amt = parseFloat((withdrawable - keepBalance).toFixed(2));
    if (!amt || amt < 1) return; // not enough above the floor to bother with

    const fee     = parseFloat((amt * 0.05).toFixed(2));
    const receive = parseFloat((amt - fee).toFixed(2));

    await db.runTransaction(async tx => {
      const freshSnap = await tx.get(userRef);
      if (!freshSnap.exists) return;
      const freshData = freshSnap.data();

      const bal            = parseFloat((freshData.walletBalance || 0).toFixed(2));
      const freshWithdrawable = parseFloat((freshData.withdrawableBalance || 0).toFixed(2));

      // Re-check against the fresh read — balance may have moved between
      // the initial check above and this transaction acquiring its lock.
      if (amt > freshWithdrawable || amt > bal) return;

      const updatedBal         = parseFloat((bal - amt).toFixed(2));
      const updatedWithdrawable = parseFloat((freshWithdrawable - amt).toFixed(2));
      const pending             = parseFloat(((freshData.pendingBalance || 0) + amt).toFixed(2));

      tx.update(userRef, {
        walletBalance:       updatedBal,
        withdrawableBalance: updatedWithdrawable,
        pendingBalance:      pending,
      });

      tx.set(userRef.collection('transactions').doc(), {
        type:      'autowithdraw',
        amount:    -amt,
        fee,
        label:     `Auto withdrawal via ${method === 'bank' ? 'Bank Transfer' : 'PayPal'}`,
        note:      `Withdrawable balance reached your $${threshold.toFixed(2)} threshold — automatically requested $${amt.toFixed(2)}, keeping $${keepBalance.toFixed(2)} in your wallet.`,
        method,
        auto:      true,
        status:    'pending',
        createdAt: FieldValue.serverTimestamp(),
      });

      tx.set(db.collection('withdrawals').doc(), {
        uid,
        paypalEmail,
        method,
        amount:  amt,
        fee,
        receive,
        auto:    true,
        status:  'pending',
        createdAt: FieldValue.serverTimestamp(),
      });

      tx.set(userRef.collection('notifications').doc(), {
        type:      'auto_withdrawal',
        title:     'Auto withdrawal requested',
        body:      `Your withdrawable balance hit your $${threshold.toFixed(2)} threshold, so we requested a $${amt.toFixed(2)} payout automatically.`,
        read:      false,
        createdAt: Date.now(),
      });
    });

    console.log(`[autowithdraw] Filed $${amt} payout for uid=${uid}`);
  } catch (err) {
    // Never let an auto withdrawal failure surface to or block the caller's
    // original request (transfer/autosend-run/escrow-release) — just log it.
    console.error('[autowithdraw] unexpected error', uid, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// get-plan-id  { idToken, plan }  →  { planId }
// Plan IDs never go in HTML — they live in PLAN_IDS above (private repo)
// ─────────────────────────────────────────────────────────────────────────────
async function handleGetPlanId(req, res) {
  const { idToken, plan } = req.body;
  if (!idToken)         return res.status(401).json({ error: 'Missing auth token' });
  if (!PLAN_IDS[plan])  return res.status(400).json({ error: 'Invalid plan key' });

  await verifyFirebaseToken(idToken);
  return res.status(200).json({ planId: PLAN_IDS[plan] });
}

// ── Referral commission rates (% of plan's first payment) ────────────────────
const REFERRAL_COMMISSION_RATE = 0.30; // 30% flat for all plans
const REFERRAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // referred user must activate a paid plan within 7 days of their own signup

// ── Plan prices (mirror limits.js — single change point if prices change) ────
const PLAN_PRICES = { starter: 10, growth: 20, pro: 30 };

// ─────────────────────────────────────────────────────────────────────────────
// activate-sub  { idToken, plan, subscriptionID }  →  { success }
// ─────────────────────────────────────────────────────────────────────────────
async function handleActivateSub(req, res) {
  const { idToken, plan, subscriptionID } = req.body;
  if (!idToken)        return res.status(401).json({ error: 'Missing auth token' });
  if (!plan)           return res.status(400).json({ error: 'Missing plan' });
  if (!subscriptionID) return res.status(400).json({ error: 'Missing subscriptionID' });
  if (!PLAN_IDS[plan]) return res.status(400).json({ error: 'Invalid plan key' });

  // 1. Verify Firebase identity
  const fbUser = await verifyFirebaseToken(idToken);
  const uid = fbUser.localId;

  // 2. Verify subscription status with PayPal — must be ACTIVE
  const token = await getPayPalToken();
  const subRes = await fetch(`${ppBase()}/v1/billing/subscriptions/${subscriptionID}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });

  if (!subRes.ok) {
    return res.status(502).json({ error: 'Could not verify subscription with PayPal' });
  }

  const sub = await subRes.json();

  if (sub.status !== 'ACTIVE') {
    return res.status(400).json({ error: `Subscription not active (status: ${sub.status})` });
  }

  // 3. Confirm plan_id matches — blocks plan-swapping attacks
  if (sub.plan_id !== PLAN_IDS[plan]) {
    console.error(`Plan ID mismatch: PayPal returned ${sub.plan_id}, expected ${PLAN_IDS[plan]}`);
    return res.status(400).json({ error: 'Plan mismatch. Contact support.' });
  }

  // 4. Write to Firestore via Admin SDK
  const db = getAdminDb();
  const userRef = db.collection('users').doc(uid);
  let paidReferrerUid = null; // set inside the tx if a referral bonus is paid

  await db.runTransaction(async tx => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) throw new Error('User not found');
    const userData = userSnap.data();

    // Guard: only pay referral once (on first-ever paid plan activation)
    const alreadyPaidReferral = userData.referralBonusPaid === true;
    const referredBy = userData.referredBy || null;
    const planPrice  = PLAN_PRICES[plan] || 0;
    const bonus      = parseFloat((planPrice * REFERRAL_COMMISSION_RATE).toFixed(2));
    const oldPlan    = userData.plan || 'free';

    // 7-day referral window: referredAt is set once, at signup (see
    // account.js's actionEnsureAccount), so this measures time since the
    // referred user's OWN account creation — not since the referrer
    // shared the link. A referredBy with no referredAt (accounts created
    // before this field existed) is treated as expired rather than
    // granted an unbounded window.
    const referredAtMillis = userData.referredAt?.toMillis ? userData.referredAt.toMillis() : null;
    const withinReferralWindow = referredAtMillis !== null && (Date.now() - referredAtMillis) <= REFERRAL_WINDOW_MS;

    tx.update(userRef, {
      plan:                 plan,
      paypalSubscriptionId: subscriptionID,
      planActivatedAt:      FieldValue.serverTimestamp(),
      planRenewedAt:        FieldValue.serverTimestamp(),
      planStatus:           'active',
    });

    // Keep planIndex/{free,premium} in sync with the plan write above — see
    // listings.js's handlePremiumSellers, which reads planIndex/premium
    // instead of scanning the whole users collection. starter/growth/pro
    // all share one 'premium' bucket (the strip doesn't distinguish
    // between paid tiers), so a starter→pro upgrade, for example, is a
    // no-op here — the uid was already in planIndex/premium. Only a
    // free→paid transition actually needs to move the uid between docs.
    if (oldPlan === 'free') {
      tx.set(db.collection('planIndex').doc('free'), {
        uids: FieldValue.arrayRemove(uid),
      }, { merge: true });
      tx.set(db.collection('planIndex').doc('premium'), {
        uids: FieldValue.arrayUnion(uid),
      }, { merge: true });
    }

    // ── Pay referrer 30% of plan price (first activation only, within 7 days of the referred user's signup) ──
    if (!alreadyPaidReferral && referredBy && bonus > 0 && !withinReferralWindow) {
      console.warn(`[referral] Window expired for uid=${uid} (referredBy="${referredBy}") — no bonus paid`);
    }
    if (!alreadyPaidReferral && referredBy && bonus > 0 && withinReferralWindow) {
      // Look up referrer by username (stored as usernameLower on signup)
      const refSnap = await db.collection('users')
        .where('usernameLower', '==', referredBy)
        .limit(1)
        .get();

      if (!refSnap.empty) {
        const refDoc  = refSnap.docs[0];
        const refRef  = refDoc.ref;
        const refData = refDoc.data();

        // Credit referrer wallet — referral earnings are withdrawable, so
        // both walletBalance and withdrawableBalance are credited.
        const refBal    = parseFloat((refData.walletBalance || 0).toFixed(2));
        const newRefBal = parseFloat((refBal + bonus).toFixed(2));
        const refWithdrawable    = parseFloat((refData.withdrawableBalance || 0).toFixed(2));
        const newRefWithdrawable = parseFloat((refWithdrawable + bonus).toFixed(2));

        tx.update(refRef, {
          walletBalance:       newRefBal,
          withdrawableBalance: newRefWithdrawable,
          referralCount:       FieldValue.increment(1),
          referralEarned:      FieldValue.increment(bonus),
        });

        // Referrer transaction record
        tx.set(refRef.collection('transactions').doc(), {
          type:      'referral_bonus',
          amount:    bonus,
          label:     `Referral bonus · ${plan} plan (${(REFERRAL_COMMISSION_RATE * 100).toFixed(0)}%)`,
          referredUid: uid,
          status:    'completed',
          createdAt: FieldValue.serverTimestamp(),
        });

        // Notify referrer
        tx.set(refRef.collection('notifications').doc(), {
          type:      'referral_earned',
          title:     'Referral bonus received! 🎉',
          body:      `Someone you referred just subscribed to the ${plan.charAt(0).toUpperCase() + plan.slice(1)} plan. +$${bonus.toFixed(2)} added to your wallet.`,
          read:      false,
          createdAt: FieldValue.serverTimestamp(),
        });

        // Mark bonus as paid on the new subscriber's doc so we never double-pay
        tx.update(userRef, { referralBonusPaid: true });

        paidReferrerUid = refDoc.id;
        console.log(`[referral] Paid $${bonus} to referrer uid=${refDoc.id} for new ${plan} subscriber uid=${uid}`);
      } else {
        console.warn(`[referral] Referrer username="${referredBy}" not found — no bonus paid`);
      }
    }
  });

  if (paidReferrerUid) await maybeAutoWithdraw(db, paidReferrerUid);

  return res.status(200).json({ success: true, plan });
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook — PayPal calls this monthly for renewals, cancellations, failures
// Register URL in PayPal Developer Dashboard: https://siterifty.com/api/paypal
// Events to subscribe: PAYMENT.SALE.COMPLETED, BILLING.SUBSCRIPTION.*
// ─────────────────────────────────────────────────────────────────────────────
async function handleWebhook(req, res) {
  const rawBody = typeof req.body === 'string'
    ? req.body
    : JSON.stringify(req.body);

  const valid = await verifyWebhookSignature(req.headers, rawBody);
  if (!valid) {
    console.warn('[webhook] Invalid PayPal signature — rejected');
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  const event = typeof req.body === 'string' ? JSON.parse(rawBody) : req.body;
  const { event_type, resource } = event;

  console.log('[webhook]', event_type);

  const db = getAdminDb();

  async function findUserBySubId(subId) {
    const snap = await db.collection('users')
      .where('paypalSubscriptionId', '==', subId)
      .limit(1)
      .get();
    return snap.empty ? null : snap.docs[0];
  }

  switch (event_type) {

    // Monthly charge succeeded — keep planRenewedAt fresh
    case 'PAYMENT.SALE.COMPLETED': {
      const subId = resource.billing_agreement_id;
      if (!subId) break;
      const userDoc = await findUserBySubId(subId);
      if (!userDoc) break;
      await db.collection('users').doc(userDoc.id).update({
        planStatus:    'active',
        planRenewedAt: FieldValue.serverTimestamp(),
      });
      await db.collection('users').doc(userDoc.id)
        .collection('transactions').add({
          type:      'plan_renewal',
          amount:    parseFloat(resource.amount?.total || 0),
          label:     `Plan renewal · ${resource.id}`,
          status:    'completed',
          createdAt: FieldValue.serverTimestamp(),
        });
      break;
    }

    // Cancelled or expired — drop back to free
    case 'BILLING.SUBSCRIPTION.CANCELLED':
    case 'BILLING.SUBSCRIPTION.EXPIRED': {
      const userDoc = await findUserBySubId(resource.id);
      if (!userDoc) break;
      const uid = userDoc.id;
      const batch = db.batch();
      batch.update(db.collection('users').doc(uid), {
        plan:            'free',
        planStatus:      'cancelled',
        planCancelledAt: FieldValue.serverTimestamp(),
      });
      // Keep planIndex/{free,premium} in sync — see handleActivateSub's
      // comment on this same scheme. userDoc here already came from the
      // findUserBySubId query above, so no extra read is needed to know
      // this user was on a paid plan (that's the only way they'd have a
      // paypalSubscriptionId to have matched that query in the first
      // place).
      batch.set(db.collection('planIndex').doc('premium'), {
        uids: FieldValue.arrayRemove(uid),
      }, { merge: true });
      batch.set(db.collection('planIndex').doc('free'), {
        uids: FieldValue.arrayUnion(uid),
      }, { merge: true });
      await batch.commit();
      break;
    }

    // Payment failed — mark so UI can warn the user
    case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED': {
      const userDoc = await findUserBySubId(resource.id);
      if (!userDoc) break;
      await db.collection('users').doc(userDoc.id).update({
        planStatus: 'payment_failed',
      });
      break;
    }

    // Re-activated after lapse
    case 'BILLING.SUBSCRIPTION.ACTIVATED':
    case 'BILLING.SUBSCRIPTION.RE-ACTIVATED': {
      const userDoc = await findUserBySubId(resource.id);
      if (!userDoc) break;
      await db.collection('users').doc(userDoc.id).update({
        planStatus:    'active',
        planRenewedAt: FieldValue.serverTimestamp(),
      });
      break;
    }

    default:
      break;
  }

  // PayPal retries if it doesn't get a 200
  return res.status(200).json({ received: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// cancel-sub  { idToken }  →  { success }
// 1. Cancels the PayPal subscription via API so billing actually stops.
// 2. Updates Firestore via Admin SDK — frontend never touches it.
// ─────────────────────────────────────────────────────────────────────────────
async function handleCancelSub(req, res) {
  const { idToken } = req.body;
  if (!idToken) return res.status(401).json({ error: 'Missing auth token' });

  // 1. Verify Firebase identity
  const fbUser = await verifyFirebaseToken(idToken);
  const uid = fbUser.localId;

  // 2. Look up the stored PayPal subscription ID
  const db = getAdminDb();
  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });

  const { paypalSubscriptionId, plan } = userSnap.data();

  if (!paypalSubscriptionId) {
    return res.status(400).json({ error: 'No active subscription found' });
  }
  if (plan === 'free') {
    return res.status(400).json({ error: 'Already on the free plan' });
  }

  // 3. Cancel with PayPal — this stops future billing
  const token = await getPayPalToken();
  const cancelRes = await fetch(
    `${ppBase()}/v1/billing/subscriptions/${paypalSubscriptionId}/cancel`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ reason: 'Customer requested cancellation' }),
    }
  );

  // PayPal returns 204 No Content on success
  if (!cancelRes.ok && cancelRes.status !== 204) {
    const err = await cancelRes.text();
    console.error('PayPal cancel-sub error:', cancelRes.status, err);
    return res.status(502).json({ error: 'PayPal cancellation failed' });
  }

  // 4. Update Firestore via Admin SDK
  const batch = db.batch();
  batch.update(db.collection('users').doc(uid), {
    plan:            'free',
    planStatus:      'cancelled',
    planCancelledAt: FieldValue.serverTimestamp(),
  });
  // Keep planIndex/{free,premium} in sync — see handleActivateSub's comment
  // on this scheme. The plan==='free' check above already guarantees this
  // uid was on a paid plan, so this is always a premium→free move, no
  // branching needed.
  batch.set(db.collection('planIndex').doc('premium'), {
    uids: FieldValue.arrayRemove(uid),
  }, { merge: true });
  batch.set(db.collection('planIndex').doc('free'), {
    uids: FieldValue.arrayUnion(uid),
  }, { merge: true });
  await batch.commit();

  return res.status(200).json({ success: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// withdraw  { idToken, amount, method?, scheduledFor?, ...method-specific fields }
//   method: 'paypal'  → paypalEmail
//   method: 'bank'    → bankAccountName, bankAccountNumber, bankRoutingNumber, bankAccountType
//   method: 'bitcoin' → bitcoinAddress
//   →  { success, newBalance, newWithdrawable, fee, receive }
//
// Withdrawable balance is tracked SEPARATELY from walletBalance
// (withdrawableBalance on the user doc). Only money that entered the wallet
// from a sale/escrow-release, a P2P transfer receive, or a referral bonus is
// withdrawable — deposited funds are spendable inside Siterifty (boosts,
// escrow, sending to others) but can never be cashed back out, so
// walletBalance always stays >= withdrawableBalance and this endpoint checks
// withdrawableBalance specifically rather than the combined total.
//
// No payout is actually sent from here for any method, including Bitcoin —
// this only validates the request, debits the balance, and files a pending
// `withdrawals` doc with the payout details attached. Sending the money
// (PayPal payout, bank ACH, or a BTC transfer) is a manual step done outside
// this codebase; see handleAdminResolveWithdrawal for how a completed/failed
// outcome gets marked afterward.
//
// `scheduledFor` (optional ISO date string) lets the user pick a future
// payout date from the wallet UI; if omitted or in the past we process
// against "as soon as possible" and store scheduledFor = null.
//
// NOTE — deal.js integration: escrow release (handleEscrowRelease in
// /api/deal) also credits withdrawableBalance directly, outside this file.
// To make auto withdrawal fire on that credit too, import maybeAutoWithdraw
// from this module in deal.js and call `await maybeAutoWithdraw(db, sellerUid)`
// right after a successful escrow release commits, the same way it's called
// here after transfer/autosend-run/referral credits.
// ─────────────────────────────────────────────────────────────────────────────
async function handleWithdraw(req, res) {
  const {
    idToken,
    amount,
    method = 'paypal',
    scheduledFor,
    // PayPal
    paypalEmail,
    // Bank (US ACH)
    bankAccountName,
    bankAccountNumber,
    bankRoutingNumber,
    bankAccountType, // 'checking' | 'savings'
    // Bitcoin — payouts are sent manually; we just need a valid-looking address.
    bitcoinAddress,
  } = req.body;

  if (!idToken) return res.status(401).json({ error: 'Missing auth token' });
  if (!['paypal', 'bank', 'bitcoin'].includes(method)) {
    return res.status(400).json({ error: 'Invalid payment method' });
  }

  // Per-method payout details — each method collects the fields that
  // actually let a human being pay the person, not a one-size-fits-all
  // email address.
  let payoutDetails;
  if (method === 'paypal') {
    if (!paypalEmail || !paypalEmail.includes('@')) {
      return res.status(400).json({ error: 'Enter a valid PayPal email address.' });
    }
    payoutDetails = { paypalEmail: paypalEmail.trim() };
  } else if (method === 'bank') {
    const name    = (bankAccountName || '').trim();
    const acct    = (bankAccountNumber || '').trim();
    const routing = (bankRoutingNumber || '').trim();
    const type    = bankAccountType === 'savings' ? 'savings' : bankAccountType === 'checking' ? 'checking' : null;

    if (!name) return res.status(400).json({ error: 'Enter the account holder name.' });
    if (!/^\d{4,17}$/.test(acct)) return res.status(400).json({ error: 'Enter a valid account number.' });
    if (!/^\d{9}$/.test(routing)) return res.status(400).json({ error: 'Enter a valid 9-digit routing number.' });
    if (!type) return res.status(400).json({ error: 'Select an account type (checking or savings).' });

    payoutDetails = {
      bankAccountName:   name,
      bankAccountNumber: acct,
      bankRoutingNumber: routing,
      bankAccountType:   type,
    };
  } else {
    // Bitcoin — Siterifty never processes the payout itself (see
    // handleWithdraw's top comment: payouts are always a manual step done
    // outside this codebase); this just needs an address that's plausibly
    // a real BTC address so it can be sent to manually. Covers legacy
    // (1...), P2SH (3...), and bech32 (bc1...) formats without pulling in
    // a full base58/bech32 checksum library.
    const addr = (bitcoinAddress || '').trim();
    const looksValid = /^(1[a-km-zA-HJ-NP-Z1-9]{25,34}|3[a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-z0-9]{25,59})$/.test(addr);
    if (!looksValid) {
      return res.status(400).json({ error: 'Enter a valid Bitcoin wallet address.' });
    }
    payoutDetails = { bitcoinAddress: addr };
  }

  const amt = parseFloat(amount);
  if (!amt || amt < 1 || amt > 10000 || !isFinite(amt)) {
    return res.status(400).json({ error: 'Amount must be between $1 and $10,000' });
  }

  // Validate the optional scheduled date — must be a real date, not in the past,
  // and not more than 90 days out (avoid indefinite-hold scheduling abuse).
  let scheduledTs = null;
  if (scheduledFor) {
    const d = new Date(scheduledFor);
    if (isNaN(d.getTime())) return res.status(400).json({ error: 'Invalid scheduled date' });
    const now = new Date();
    const maxOut = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    if (d.getTime() < now.getTime() - 24 * 60 * 60 * 1000) {
      return res.status(400).json({ error: 'Scheduled date cannot be in the past' });
    }
    if (d.getTime() > maxOut.getTime()) {
      return res.status(400).json({ error: 'Scheduled date cannot be more than 90 days out' });
    }
    scheduledTs = Timestamp.fromDate(d);
  }

  // 1. Verify Firebase identity
  const fbUser = await verifyFirebaseToken(idToken);
  const uid = fbUser.localId;

  const fee     = parseFloat((amt * 0.05).toFixed(2));
  const receive = parseFloat((amt - fee).toFixed(2));

  // 2. Run everything in a Firestore transaction via Admin SDK
  const db = getAdminDb();
  const userRef = db.collection('users').doc(uid);

  // Resolved ahead of the transaction — a query-by-email has no place inside
  // a Firestore transaction alongside doc gets/sets. Same pattern as
  // handleTransfer/handleDonate: null means ADMIN_EMAIL is unset/
  // unresolvable, NOT "no fee owed" — the fee is still taken from the
  // withdrawing user's balance below either way; this only decides whether
  // it's credited to a live admin wallet or held in the unclaimed-fees
  // ledger until ADMIN_EMAIL is fixed.
  const adminUid = await getPlatformFeeAdminUid(db);
  const feeOwedButUnroutable = fee > 0 && uid !== adminUid && !adminUid;
  const creditAdmin = fee > 0 && uid !== adminUid && !!adminUid;
  const adminRef = creditAdmin ? db.collection('users').doc(adminUid) : null;
  let ledgerEntry = null;

  const methodLabel = method === 'bank' ? 'Bank Transfer' : method === 'bitcoin' ? 'Bitcoin' : 'PayPal';
  const noteDetail =
    method === 'paypal'   ? `PayPal: ${payoutDetails.paypalEmail}` :
    method === 'bitcoin'  ? `BTC address: ${payoutDetails.bitcoinAddress}` :
    `Bank: ${payoutDetails.bankAccountName} · ${payoutDetails.bankAccountType} · routing ${payoutDetails.bankRoutingNumber} · acct ****${payoutDetails.bankAccountNumber.slice(-4)}`;

  const result = await db.runTransaction(async tx => {
    const [snap, adminSnap] = await Promise.all([
      tx.get(userRef),
      adminRef ? tx.get(adminRef) : Promise.resolve(null),
    ]);
    if (!snap.exists) throw new Error('User document not found');
    if (adminRef && !adminSnap.exists) throw new Error('Platform fee admin account not found');

    const data = snap.data();
    const bal      = parseFloat((data.walletBalance || 0).toFixed(2));
    const withdrawable = parseFloat((data.withdrawableBalance || 0).toFixed(2));

    // Server-side balance check — client cannot spoof this. Checked against
    // withdrawableBalance specifically: deposited-only funds cannot be cashed out.
    if (amt > withdrawable) {
      throw new Error(
        withdrawable <= 0
          ? 'You have no withdrawable balance. Deposited funds can be spent on Siterifty but not withdrawn — only earnings from sales, transfers received, or referral bonuses qualify.'
          : `You can only withdraw up to $${withdrawable.toFixed(2)} — the rest of your balance came from deposits, which aren't withdrawable.`
      );
    }
    // Defensive: withdrawable should never exceed total, but never let the
    // total balance go negative even if that invariant is ever violated.
    if (amt > bal) throw new Error('Insufficient balance');

    // The withdrawing user's wallet is debited the FULL amt (not just
    // `receive`) — the 5% fee is real money leaving their balance, same as
    // any other platform fee, and pendingBalance tracks the full hold until
    // the downstream payout process (outside this file) actually sends
    // `receive` to their PayPal/bank/BTC wallet. The fee itself is credited
    // to the admin account (or ledgered) right here, at request time — it
    // must not be left as inert metadata on the transaction/withdrawals
    // docs with nothing ever actually collecting it.
    const updatedBal         = parseFloat((bal - amt).toFixed(2));
    const updatedWithdrawable = parseFloat((withdrawable - amt).toFixed(2));
    const pending             = parseFloat(((data.pendingBalance || 0) + amt).toFixed(2));

    tx.update(userRef, {
      walletBalance:       updatedBal,
      withdrawableBalance: updatedWithdrawable,
      pendingBalance:      pending,
    });

    tx.set(userRef.collection('transactions').doc(), {
      type:         'withdraw',
      amount:       -amt,
      fee,
      receive,      // net amount that will actually be paid out once approved
      label:        `Withdrawal via ${methodLabel}`,
      note:         noteDetail + (feeOwedButUnroutable ? ' (fee pending platform reconciliation)' : ''),
      method,
      scheduledFor: scheduledTs,
      status:       'pending',
      createdAt:    FieldValue.serverTimestamp(),
    });

    tx.set(db.collection('withdrawals').doc(), {
      uid,
      email:  fbUser.email,
      method,
      ...payoutDetails,
      amount:       amt,
      fee,
      receive,
      scheduledFor: scheduledTs,
      status:       'pending',
      createdAt:    FieldValue.serverTimestamp(),
    });

    // Credit the platform fee to the admin account right now, same as
    // transfer/donate/escrow-release — a fee that's computed and shown to
    // the user but never actually collected anywhere is the exact bug this
    // whole pass is fixing. Skipped only if the withdrawing user IS the
    // admin account (fee <=0 already returns early via the guard above in
    // that edge case is moot since fee is always >0 for amt>=1 at 5%).
    if (creditAdmin) {
      const adminBal    = parseFloat((adminSnap.data().walletBalance || 0).toFixed(2));
      const newAdminBal = parseFloat((adminBal + fee).toFixed(2));
      const adminWithdrawable    = parseFloat((adminSnap.data().withdrawableBalance || 0).toFixed(2));
      const newAdminWithdrawable = parseFloat((adminWithdrawable + fee).toFixed(2));

      tx.update(adminRef, { walletBalance: newAdminBal, withdrawableBalance: newAdminWithdrawable });

      tx.set(adminRef.collection('transactions').doc(), {
        type:      'platform_fee',
        amount:    fee,
        label:     'Platform fee · Withdrawal',
        note:      `5% of $${amt.toLocaleString()} withdrawn by ${fbUser.email || uid}`,
        withdrawerUid: uid,
        status:    'completed',
        createdAt: FieldValue.serverTimestamp(),
      });
    } else if (feeOwedButUnroutable) {
      ledgerEntry = {
        amount: fee,
        source: 'withdrawal',
        sourceId: null,
        payerUid: uid,
        counterpartyUid: null,
        note: `5% of $${amt.toLocaleString()} withdrawn by ${fbUser.email || uid} — deducted from withdrawer, held pending ADMIN_EMAIL fix`,
      };
    }

    return { updatedBal, updatedWithdrawable };
  });

  if (ledgerEntry) {
    await _ledgerUnclaimedFee(db, ledgerEntry);
  }

  return res.status(200).json({
    success:         true,
    newBalance:      result.updatedBal,
    newWithdrawable: result.updatedWithdrawable,
    fee,
    receive,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// admin-resolve-withdrawal  { withdrawalId, outcome: 'completed' | 'failed' }
// ADMIN-ONLY — gated by the admin_session cookie (verifyAdminSession), not a
// user idToken. This never sends money itself: actual PayPal/bank payouts
// are a manual step done outside this codebase (see handleWithdraw's doc
// comment — "the downstream payout process (outside this file) actually
// sends `receive`"). This action only finalizes the bookkeeping once that
// manual step has happened (or been declined):
//
//   outcome: 'completed' — admin has already sent the real payout via
//     PayPal/bank themselves. Marks the withdrawal + its transaction record
//     completed and clears the amount out of pendingBalance (it's no longer
//     "pending", it's done — walletBalance/withdrawableBalance were already
//     debited at request time by handleWithdraw and stay debited).
//
//   outcome: 'failed' — admin is declining the payout (bad PayPal email,
//     fraud check, etc.). Marks it failed, clears pendingBalance, AND
//     refunds the full original amount back to walletBalance +
//     withdrawableBalance — undoing the debit handleWithdraw made upfront.
//     Without this refund the user's money would simply vanish.
// ─────────────────────────────────────────────────────────────────────────────
async function handleAdminResolveWithdrawal(req, res) {
  const session = verifyAdminSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated as admin' });

  const { withdrawalId, outcome } = req.body || {};
  if (!withdrawalId) return res.status(400).json({ error: 'Missing withdrawalId' });
  if (!['completed', 'failed'].includes(outcome)) {
    return res.status(400).json({ error: 'outcome must be "completed" or "failed"' });
  }

  const db = getAdminDb();
  const withdrawalRef = db.collection('withdrawals').doc(withdrawalId);

  const result = await db.runTransaction(async tx => {
    const wSnap = await tx.get(withdrawalRef);
    if (!wSnap.exists) throw new Error('Withdrawal not found');
    const w = wSnap.data();

    if (w.status !== 'pending') {
      throw new Error(`Cannot resolve — withdrawal status is already "${w.status}"`);
    }

    const uid = w.uid;
    const amt = parseFloat(w.amount || 0);
    if (!uid || !amt) throw new Error('Withdrawal record is missing uid/amount');

    const userRef = db.collection('users').doc(uid);
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) throw new Error('User not found');
    const userData = userSnap.data();

    // Clear the hold either way — it's no longer pending once resolved.
    const currentPending = parseFloat((userData.pendingBalance || 0).toFixed(2));
    const newPending = Math.max(0, parseFloat((currentPending - amt).toFixed(2)));

    const userUpdate = { pendingBalance: newPending };

    if (outcome === 'failed') {
      // Refund exactly what was debited at request time — the full amt
      // (not `receive`), matching how handleWithdraw took it out.
      const currentBal = parseFloat((userData.walletBalance || 0).toFixed(2));
      const currentWithdrawable = parseFloat((userData.withdrawableBalance || 0).toFixed(2));
      userUpdate.walletBalance = parseFloat((currentBal + amt).toFixed(2));
      userUpdate.withdrawableBalance = parseFloat((currentWithdrawable + amt).toFixed(2));
    }

    tx.update(userRef, userUpdate);
    tx.update(withdrawalRef, {
      status: outcome,
      resolvedAt: FieldValue.serverTimestamp(),
      resolvedBy: session.email,
    });

    // Log a transaction record so this shows up in the user's history —
    // separate from the original 'withdraw' debit record, same pattern as
    // escrow_refund being its own record rather than editing the original.
    if (outcome === 'failed') {
      tx.set(userRef.collection('transactions').doc(), {
        type: 'withdraw_failed',
        amount: amt,
        label: 'Withdrawal declined — refunded',
        note: `Your $${amt.toFixed(2)} withdrawal request was declined and refunded to your wallet.`,
        withdrawalId,
        status: 'completed',
        createdAt: FieldValue.serverTimestamp(),
      });
    } else {
      tx.set(userRef.collection('transactions').doc(), {
        type: 'withdraw_completed',
        amount: -amt,
        label: 'Withdrawal completed',
        note: `Your $${(w.receive ?? amt).toFixed(2)} payout was sent.`,
        withdrawalId,
        status: 'completed',
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    return { uid, amt, refunded: outcome === 'failed' };
  });

  // Notify the user (best-effort, non-blocking of the response)
  try {
    await db.collection('users').doc(result.uid).collection('notifications').add({
      type: outcome === 'failed' ? 'withdrawal_failed' : 'withdrawal_completed',
      title: outcome === 'failed' ? 'Withdrawal declined' : 'Withdrawal completed',
      body: outcome === 'failed'
        ? `Your $${result.amt.toFixed(2)} withdrawal request was declined and refunded to your wallet.`
        : `Your $${result.amt.toFixed(2)} withdrawal has been sent.`,
      read: false,
      createdAt: Date.now(),
    });
  } catch (_) {
    // Non-fatal — the resolution itself already succeeded.
  }

  return res.status(200).json({ success: true, outcome, refunded: result.refunded });
}

// ─────────────────────────────────────────────────────────────────────────────
// lookup-recipient  { idToken, email }  →  { uid, displayName, username, email, profilePic }
//
// Resolves a Siterifty user by email for a P2P transfer. This runs server-side
// (with the Admin SDK) rather than letting the client query the `users`
// collection directly by email — querying by email client-side would let
// anyone enumerate registered accounts and pull back whatever fields
// Firestore rules happen to expose. This endpoint returns only the minimal
// fields the transfer UI actually needs (profilePic included so the wallet's
// Send tab can show a real avatar instead of just initials).
// ─────────────────────────────────────────────────────────────────────────────
async function handleLookupRecipient(req, res) {
  const { idToken, email } = req.body;
  if (!idToken) return res.status(401).json({ error: 'Missing auth token' });

  const cleanEmail = (email || '').trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes('@')) {
    return res.status(400).json({ error: 'Enter a valid email address' });
  }

  const fbUser = await verifyFirebaseToken(idToken);
  if (cleanEmail === (fbUser.email || '').toLowerCase()) {
    return res.status(400).json({ error: 'You cannot send money to yourself' });
  }

  const db = getAdminDb();
  const snap = await db.collection('users')
    .where('email', '==', cleanEmail)
    .limit(1)
    .get();

  if (snap.empty) {
    return res.status(404).json({ error: 'No Siterifty account found with that email' });
  }

  const foundDoc = snap.docs[0];
  const data = foundDoc.data();
  return res.status(200).json({
    uid:         foundDoc.id,
    displayName: data.displayName || '',
    username:    data.username || '',
    email:       data.email || cleanEmail,
    profilePic:  data.profilePic || null,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// transfer  { idToken, recipientUid, amount, note? }  →  { success, newBalance, fee, receiveAmount }
//
// Server-validated P2P wallet transfer. Previously this ran as a client-side
// Firestore transaction with no server involved at all — any tampering with
// client JS could bypass the balance check or the fee calculation entirely.
// Now the sender's balance, the recipient's existence, and the fee math are
// all re-verified here with the Admin SDK inside a single transaction, the
// same pattern as handleWithdraw above.
//
// ── DISABLED (2026-07-25) ────────────────────────────────────────────────────
// User-to-user wallet transfers move real ledger balance between two
// ordinary users with no PayPal (or other licensed) rail in the middle —
// that's custodial money transmission, which Siterifty is not currently
// licensed for. Wallet balance is licensed-safe ONLY as a spend-only credit
// for boosting listings; it must never be sendable to another user or
// cashed out until Siterifty holds (or partners for) a money transmitter
// license. Gated at the top of the handler, not removed — all validation,
// fee-split, and ledgering logic below is untouched and ready to re-enable
// by deleting this early return once licensed. See TransferMethodPicker/
// SendTab.tsx for the matching frontend placeholder.
// ─────────────────────────────────────────────────────────────────────────────
async function handleTransfer(req, res) {
  return res.status(410).json({
    error: 'Sending money to other users isn\'t available yet — Siterifty wallet balance is currently limited to boosting your own listings. This feature will return once Siterifty completes money-transmission licensing. PayPal handles the full escrow-protected marketplace transaction.',
  });
}

// Original implementation kept below, unreachable — see the disabled-notice
// comment above for why, and for exactly what to delete to restore it.
async function _handleTransfer_DISABLED_pendingLicense(req, res) {
  const { idToken, recipientUid, amount, note } = req.body;
  if (!idToken)      return res.status(401).json({ error: 'Missing auth token' });
  if (!recipientUid) return res.status(400).json({ error: 'Missing recipient' });

  const amt = parseFloat(amount);
  if (!amt || amt <= 0 || amt > 10000 || !isFinite(amt)) {
    return res.status(400).json({ error: 'Amount must be between $0.01 and $10,000' });
  }

  const fbUser = await verifyFirebaseToken(idToken);
  const senderUid = fbUser.localId;

  if (senderUid === recipientUid) {
    return res.status(400).json({ error: 'You cannot send money to yourself' });
  }

  const TRANSFER_FEE_RATE = LIMITS.wallet.transferFee;
  // Guard against a missing/misconfigured rate silently sending 100% of the
  // transfer fee-free. A rate must be a finite number in [0, 1) — 0 is a
  // legitimate "no fee" config and is allowed through; anything else
  // (undefined because LIMITS.wallet or .transferFee doesn't exist, NaN,
  // negative, or >=1 i.e. >=100%) means the config itself is broken, and a
  // broken config should fail loudly here rather than quietly waive the fee
  // on every transfer until someone notices real dollars going missing.
  if (typeof TRANSFER_FEE_RATE !== 'number' || !isFinite(TRANSFER_FEE_RATE) || TRANSFER_FEE_RATE < 0 || TRANSFER_FEE_RATE >= 1) {
    console.error('[paypal.js] LIMITS.wallet.transferFee is missing or invalid:', TRANSFER_FEE_RATE);
    return res.status(500).json({ error: 'Transfer fee is not configured correctly. Please try again later.' });
  }
  const fee        = parseFloat((amt * TRANSFER_FEE_RATE).toFixed(2));
  const receiveAmt = parseFloat((amt - fee).toFixed(2));
  const safeNote   = (note || '').slice(0, 200);

  const db         = getAdminDb();
  const senderRef  = db.collection('users').doc(senderUid);
  const recipRef   = db.collection('users').doc(recipientUid);

  // Resolved ahead of the transaction — a query-by-email has no place inside
  // a Firestore transaction alongside doc gets/sets for sender/recipient.
  // null means ADMIN_EMAIL is unset/unresolvable — NOT "no fee owed".
  const adminUid = await getPlatformFeeAdminUid(db);

  // Two DISTINCT reasons the recipient might get the full amount — these
  // must never be conflated:
  //  - noFeeOwed: either party IS the platform admin account, or the fee
  //    rounds to $0. Correctly no fee to collect from anyone.
  //  - feeOwedButUnroutable: a real fee IS owed and IS deducted from the
  //    recipient below, same as normal — there's just nowhere live to
  //    credit it (adminUid is null) because ADMIN_EMAIL is unset/
  //    misconfigured. That fee goes to the unclaimed-fees ledger after
  //    this transaction commits, not to the recipient and not into the void.
  const noFeeOwed = fee <= 0 || senderUid === adminUid || recipientUid === adminUid;
  const feeOwedButUnroutable = !noFeeOwed && !adminUid;
  const applyFeeSplit = !noFeeOwed; // recipient's side pays the fee either way unless noFeeOwed

  // adminRef is resolved (and read, if needed) up front alongside the
  // sender/recipient reads — Firestore transactions require every tx.get()
  // to run before any tx.update()/tx.set(), so this can't be fetched later,
  // conditionally, after the writes below have already been queued.
  const adminRef = (applyFeeSplit && adminUid) ? db.collection('users').doc(adminUid) : null;
  let ledgerEntry = null; // set inside the transaction if we need to ledger post-commit

  const result = await db.runTransaction(async tx => {
    const [senderSnap, recipSnap, adminSnap] = await Promise.all([
      tx.get(senderRef),
      tx.get(recipRef),
      adminRef ? tx.get(adminRef) : Promise.resolve(null),
    ]);

    if (!senderSnap.exists) throw new Error('Your user profile could not be found');
    if (!recipSnap.exists)  throw new Error('Recipient account not found');
    if (adminRef && !adminSnap.exists) throw new Error('Platform fee admin account not found');

    const senderData = senderSnap.data();
    const senderBal = parseFloat((senderData.walletBalance || 0).toFixed(2));
    // Server-side balance check — client cannot spoof this
    if (amt > senderBal) throw new Error('Insufficient balance');

    // Sending money draws down withdrawable dollars first (capped at 0) —
    // this is the conservative choice: it never lets someone end up with
    // more withdrawableBalance than the money they actually earned.
    const senderWithdrawable = parseFloat((senderData.withdrawableBalance || 0).toFixed(2));
    const newSenderWithdrawable = parseFloat(Math.max(0, senderWithdrawable - amt).toFixed(2));

    const recipData = recipSnap.data();
    const recipBal = parseFloat((recipData.walletBalance || 0).toFixed(2));
    const recipWithdrawable = parseFloat((recipData.withdrawableBalance || 0).toFixed(2));
    const newSenderBal = parseFloat((senderBal - amt).toFixed(2));
    const creditToRecip = applyFeeSplit ? receiveAmt : amt;
    const newRecipBal  = parseFloat((recipBal + creditToRecip).toFixed(2));
    // Money received from another user counts as withdrawable — only a
    // straight PayPal deposit is excluded from withdrawableBalance.
    const newRecipWithdrawable = parseFloat((recipWithdrawable + creditToRecip).toFixed(2));

    tx.update(senderRef, { walletBalance: newSenderBal, withdrawableBalance: newSenderWithdrawable });
    tx.update(recipRef,  { walletBalance: newRecipBal,  withdrawableBalance: newRecipWithdrawable });

    const senderName = fbUser.displayName || fbUser.email?.split('@')[0] || 'Someone';
    const recipName  = recipData.displayName || recipData.username || recipData.email?.split('@')[0] || 'User';

    tx.set(senderRef.collection('transactions').doc(), {
      type:      'send',
      amount:    -amt,
      fee:       0,
      receiveAmount: creditToRecip, // what the recipient actually got, net of the fee they paid — shown in the sender's own wallet history so "sent $100" doesn't read as if $100 arrived
      label:     `Sent to ${recipName}`,
      note:      safeNote || `to ${recipData.email || recipientUid}`,
      status:    'completed',
      createdAt: FieldValue.serverTimestamp(),
    });

    // Recipient's own transaction record always shows the REAL fee they
    // were charged, whether or not we could route it to a live admin
    // wallet — this must never disagree with what actually landed in
    // their balance.
    const recipTxRecord = {
      type:      'receive',
      amount:    creditToRecip,
      fee:       applyFeeSplit ? fee : 0,
      label:     `Received from ${senderName}`,
      status:    'completed',
      createdAt: FieldValue.serverTimestamp(),
    };
    recipTxRecord.note = applyFeeSplit
      ? (safeNote ? `"${safeNote}" · ` : '') + `${Math.round(TRANSFER_FEE_RATE * 100)}% fee (${fee.toFixed(2)}) applied`
        + (feeOwedButUnroutable ? ' (fee pending platform reconciliation)' : '')
      : (safeNote || '');
    tx.set(recipRef.collection('transactions').doc(), recipTxRecord);

    // Credit the platform's cut to the admin account — only when a real fee
    // is owed AND we have somewhere live to put it. If a fee is owed but
    // adminUid is null (feeOwedButUnroutable), the fee has still been
    // deducted from the recipient's credit above — it's queued for the
    // unclaimed-fees ledger after the transaction commits, not dropped here.
    if (applyFeeSplit && adminRef) {
      const adminBal    = parseFloat((adminSnap.data().walletBalance || 0).toFixed(2));
      const newAdminBal = parseFloat((adminBal + fee).toFixed(2));
      const adminWithdrawable    = parseFloat((adminSnap.data().withdrawableBalance || 0).toFixed(2));
      const newAdminWithdrawable = parseFloat((adminWithdrawable + fee).toFixed(2));

      tx.update(adminRef, { walletBalance: newAdminBal, withdrawableBalance: newAdminWithdrawable });

      tx.set(adminRef.collection('transactions').doc(), {
        type:      'platform_fee',
        amount:    fee,
        label:     'Platform fee · P2P transfer',
        note:      `${Math.round(TRANSFER_FEE_RATE * 100)}% of $${amt.toLocaleString()} sent from ${senderName} to ${recipName}`,
        senderUid,
        recipientUid,
        status:    'completed',
        createdAt: FieldValue.serverTimestamp(),
      });
    } else if (feeOwedButUnroutable) {
      ledgerEntry = {
        amount: fee,
        source: 'p2p_transfer',
        sourceId: null,
        payerUid: recipientUid, // the fee was deducted from the recipient's credit, same party as before
        counterpartyUid: senderUid,
        note: `${Math.round(TRANSFER_FEE_RATE * 100)}% of $${amt.toLocaleString()} sent from ${senderName} to ${recipName} — deducted from recipient, held pending ADMIN_EMAIL fix`,
      };
    }

    tx.set(recipRef.collection('notifications').doc(), {
      type:      'wallet_transfer',
      title:     'Money received',
      body:      `${senderName} sent you $${creditToRecip.toLocaleString()}${safeNote ? ' — "' + safeNote + '"' : ''}.`,
      read:      false,
      createdAt: Date.now(),
    });

    return { newSenderBal, newSenderWithdrawable, recipName, creditToRecip };
  });

  if (ledgerEntry) {
    await _ledgerUnclaimedFee(db, ledgerEntry);
  }

  // maybeAutoTopUp removed — PayPal deposits/vault no longer exist.
  await maybeAutoWithdraw(db, recipientUid);

  return res.status(200).json({
    success:         true,
    newBalance:      result.newSenderBal,
    newWithdrawable: result.newSenderWithdrawable,
    fee:             applyFeeSplit ? fee : 0,
    receiveAmount:   result.creditToRecip,
    recipientName:   result.recipName,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// donate  { idToken, sellerUid, amount, note? }
//   →  { success, newBalance, newWithdrawable, fee, receiveAmount, sellerName }
//
// Buyer-to-seller wallet donation, shown on the seller's public profile
// modal. Modeled directly on handleTransfer above (same server-verified
// balance check + atomic transaction pattern) with two differences:
//   - Fee is a fixed 15% platform cut, always applied (no plan-based
//     tiers, no admin-account exemption skip — donations are a flat rate
//     regardless of who's receiving them).
//   - Every donation is additionally logged to
//     users/{sellerUid}/donations/{autoId} — a dedicated, append-only
//     record separate from the general transactions subcollection, which
//     is what handleGetDonations reads to power the "total donated" +
//     "last 10 donations" list on the donate modal. Keeping this in its
//     own subcollection means that public read never has to filter a
//     user's full (privacy-sensitive) transaction history down to just
//     donations — it only ever reads donations.
// ─────────────────────────────────────────────────────────────────────────────
const DONATION_FEE_RATE = 0.15;
const DONATION_MIN = 1;
const DONATION_MAX = 2500;

// ── DISABLED (2026-07-25) ─────────────────────────────────────────────────
// Only the money-moving action is gated here — the donate overlay itself
// (summary stats, recent donations list, get-donations) stays fully live.
// Donating drew from the donor's wallet balance and credited the seller's
// wallet balance directly, same as P2P transfer: custodial wallet-to-wallet
// money movement with no PayPal (or other licensed) rail involved, which
// Siterifty isn't currently licensed for. Once licensed, donations will
// move to PayPal split payments (like escrow) instead of wallet balance —
// so this returns a 410 rather than being restored to wallet debits when
// re-enabled. Frontend: DonateOverlay.tsx's submit button is disabled with
// a "coming soon" state; everything else on that overlay is untouched.
// ─────────────────────────────────────────────────────────────────────────
async function handleDonate(req, res) {
  return res.status(410).json({
    error: 'Donations aren\'t available right now — we\'re moving this to PayPal split payments. Check back soon.',
  });
}

// Original implementation kept below, unreachable — see the disabled-notice
// comment above for why, and what replaces it (PayPal split payments, not a
// wallet-debit restore) when this comes back.
async function _handleDonate_DISABLED_pendingPaypalSplit(req, res) {
  const { idToken, sellerUid, amount, note } = req.body;
  if (!idToken)   return res.status(401).json({ error: 'Missing auth token' });
  if (!sellerUid) return res.status(400).json({ error: 'Missing seller' });

  const amt = parseFloat(amount);
  if (!amt || amt < DONATION_MIN || amt > DONATION_MAX || !isFinite(amt)) {
    return res.status(400).json({ error: `Amount must be between $${DONATION_MIN} and $${DONATION_MAX.toLocaleString()}` });
  }

  const fbUser = await verifyFirebaseToken(idToken);
  const donorUid = fbUser.localId;

  if (donorUid === sellerUid) {
    return res.status(400).json({ error: 'You cannot donate to yourself' });
  }

  const fee        = parseFloat((amt * DONATION_FEE_RATE).toFixed(2));
  const receiveAmt = parseFloat((amt - fee).toFixed(2));
  const safeNote    = (note || '').slice(0, 200);

  const db        = getAdminDb();
  const donorRef  = db.collection('users').doc(donorUid);
  const sellerRef = db.collection('users').doc(sellerUid);

  // Resolved ahead of the transaction, same reasoning as handleTransfer —
  // a query has no place inside a transaction alongside doc gets/sets.
  // null means ADMIN_EMAIL is unset/unresolvable.
  const adminUid = await getPlatformFeeAdminUid(db);
  // Unlike handleTransfer, the fee is never waived from the seller's side
  // even if one party is the admin account — donations are a flat 15% by
  // design, not a plan-based/exemptable fee. adminIsParty only controls
  // whether the *admin* gets credited (crediting an account its own fee on
  // a donation to/from itself would just be a no-op double-entry).
  // feeOwedButUnroutable is the DISTINCT case where a real fee is owed and
  // deducted from the seller as normal, but adminUid is null — there's
  // nowhere live to credit it, so it goes to the unclaimed-fees ledger
  // instead. These two must never be conflated: adminIsParty=false but
  // adminUid=null must NOT build a doc(null) reference.
  const adminIsParty = adminUid != null && (donorUid === adminUid || sellerUid === adminUid);
  const feeOwedButUnroutable = !adminIsParty && !adminUid;
  const creditAdmin = !adminIsParty && !!adminUid;

  // adminRef is resolved (and read, if needed) up front alongside the
  // donor/seller reads — Firestore transactions require every tx.get() to
  // run before any tx.update()/tx.set(), so this can't be fetched later,
  // conditionally, after the writes below have already been queued.
  const adminRef = creditAdmin ? db.collection('users').doc(adminUid) : null;
  let ledgerEntry = null; // set inside the transaction if we need to ledger post-commit

  const result = await db.runTransaction(async tx => {
    const [donorSnap, sellerSnap, adminSnap] = await Promise.all([
      tx.get(donorRef),
      tx.get(sellerRef),
      adminRef ? tx.get(adminRef) : Promise.resolve(null),
    ]);

    if (!donorSnap.exists)  throw new Error('Your user profile could not be found');
    if (!sellerSnap.exists) throw new Error('Seller account not found');
    if (adminRef && !adminSnap.exists) throw new Error('Platform fee admin account not found');

    const donorData = donorSnap.data();
    const donorBal = parseFloat((donorData.walletBalance || 0).toFixed(2));
    // Server-side balance check — client cannot spoof this
    if (amt > donorBal) throw new Error('Insufficient balance');

    // Donating draws down withdrawable dollars first (capped at 0), same
    // conservative rule as handleTransfer/escrow-pay.
    const donorWithdrawable = parseFloat((donorData.withdrawableBalance || 0).toFixed(2));
    const newDonorWithdrawable = parseFloat(Math.max(0, donorWithdrawable - amt).toFixed(2));

    const sellerData = sellerSnap.data();
    const sellerBal = parseFloat((sellerData.walletBalance || 0).toFixed(2));
    const sellerWithdrawable = parseFloat((sellerData.withdrawableBalance || 0).toFixed(2));
    const newDonorBal   = parseFloat((donorBal - amt).toFixed(2));
    const newSellerBal  = parseFloat((sellerBal + receiveAmt).toFixed(2));
    // Donations received count as withdrawable, same as P2P transfers.
    const newSellerWithdrawable = parseFloat((sellerWithdrawable + receiveAmt).toFixed(2));

    tx.update(donorRef,  { walletBalance: newDonorBal,  withdrawableBalance: newDonorWithdrawable });
    tx.update(sellerRef, { walletBalance: newSellerBal, withdrawableBalance: newSellerWithdrawable });

    const donorName  = fbUser.displayName || donorData.username || fbUser.email?.split('@')[0] || 'Anonymous';
    const sellerName = sellerData.displayName || sellerData.username || sellerData.email?.split('@')[0] || 'Seller';

    tx.set(donorRef.collection('transactions').doc(), {
      type:      'donate',
      amount:    -amt,
      fee:       0,
      label:     `Donated to ${sellerName}`,
      note:      safeNote,
      sellerUid,
      status:    'completed',
      createdAt: FieldValue.serverTimestamp(),
    });

    tx.set(sellerRef.collection('transactions').doc(), {
      type:      'donation_received',
      amount:    receiveAmt,
      fee,
      label:     `Donation from ${donorName}`,
      note:      (safeNote ? `"${safeNote}" · ` : '') + `15% fee ($${fee.toFixed(2)}) applied`,
      donorUid,
      status:    'completed',
      createdAt: FieldValue.serverTimestamp(),
    });

    // Dedicated donations log — this is what the donate modal's "last 10
    // donations" list and running total read from. donorName/donorPic are
    // denormalized onto the record itself (rather than joined at read
    // time) so the public list never has to look up the donor's user doc.
    tx.set(sellerRef.collection('donations').doc(), {
      donorUid,
      donorName,
      donorPic:  donorData.profilePic || null,
      amount:    receiveAmt,
      grossAmount: amt,
      fee,
      note:      safeNote,
      createdAt: FieldValue.serverTimestamp(),
    });

    if (creditAdmin) {
      const adminBal    = parseFloat((adminSnap.data().walletBalance || 0).toFixed(2));
      const newAdminBal = parseFloat((adminBal + fee).toFixed(2));
      const adminWithdrawable    = parseFloat((adminSnap.data().withdrawableBalance || 0).toFixed(2));
      const newAdminWithdrawable = parseFloat((adminWithdrawable + fee).toFixed(2));

      tx.update(adminRef, { walletBalance: newAdminBal, withdrawableBalance: newAdminWithdrawable });

      tx.set(adminRef.collection('transactions').doc(), {
        type:      'platform_fee',
        amount:    fee,
        label:     'Platform fee · Donation',
        note:      `15% of $${amt.toLocaleString()} donated by ${donorName} to ${sellerName}`,
        donorUid,
        sellerUid,
        status:    'completed',
        createdAt: FieldValue.serverTimestamp(),
      });
    } else if (feeOwedButUnroutable) {
      ledgerEntry = {
        amount: fee,
        source: 'donation',
        sourceId: null,
        payerUid: sellerUid, // the fee was deducted from the seller's receipt, same party as before
        counterpartyUid: donorUid,
        note: `15% of $${amt.toLocaleString()} donated by ${donorName} to ${sellerName} — deducted from seller, held pending ADMIN_EMAIL fix`,
      };
    }

    tx.set(sellerRef.collection('notifications').doc(), {
      type:      'donation_received',
      title:     'You received a donation! 💚',
      body:      `${donorName} donated $${receiveAmt.toLocaleString()}${safeNote ? ' — "' + safeNote + '"' : ''}.`,
      read:      false,
      createdAt: Date.now(),
    });

    return { newDonorBal, newDonorWithdrawable, sellerName };
  });

  if (ledgerEntry) {
    await _ledgerUnclaimedFee(db, ledgerEntry);
  }

  // maybeAutoTopUp removed — PayPal deposits/vault no longer exist.
  await maybeAutoWithdraw(db, sellerUid);

  return res.status(200).json({
    success:         true,
    newBalance:      result.newDonorBal,
    newWithdrawable: result.newDonorWithdrawable,
    fee,
    receiveAmount:   receiveAmt,
    sellerName:      result.sellerName,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// get-donations  { sellerUid }  →  { ok, totalDonated, donationCount, recent: [...] }
//
// Public, read-only aggregate for the donate modal — total lifetime amount
// donated to this seller (net of the 15% fee, i.e. what they actually
// received) and their 10 most recent donations (donor name/pic, amount,
// timestamp). No auth required: this is meant to be visible to anyone
// viewing the seller's profile, same visibility level as their listings
// or follower count. Reads only the dedicated donations subcollection
// (never the general transactions collection), which only ever contains
// the denormalized, already-public-safe fields written by handleDonate.
// ─────────────────────────────────────────────────────────────────────────────
async function handleGetDonations(req, res) {
  const sellerUid = req.body?.sellerUid;
  if (!sellerUid || typeof sellerUid !== 'string') {
    return res.status(400).json({ error: 'Missing sellerUid' });
  }

  const db = getAdminDb();
  const donationsRef = db.collection('users').doc(sellerUid).collection('donations');

  const [recentSnap, allSnap] = await Promise.all([
    donationsRef.orderBy('createdAt', 'desc').limit(10).get(),
    // Lifetime total needs every donation, not just the last 10 — this
    // collection is append-only and per-seller, so a full scan here is
    // cheap even for very active sellers (thousands of donations would
    // still be a fast, single-purpose read).
    donationsRef.get(),
  ]);

  let totalDonated = 0;
  allSnap.forEach(d => {
    const amt = d.data().amount;
    if (typeof amt === 'number') totalDonated += amt;
  });

  const recent = recentSnap.docs.map(d => {
    const don = d.data();
    return {
      donorName: don.donorName || 'Anonymous',
      donorPic:  don.donorPic || null,
      amount:    don.amount || 0,
      note:      don.note || '',
      createdAt: don.createdAt?.toMillis ? don.createdAt.toMillis() : null,
    };
  });

  return res.status(200).json({
    ok: true,
    totalDonated: parseFloat(totalDonated.toFixed(2)),
    donationCount: allSnap.size,
    recent,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// wallet-summary  { idToken }
//   →  { walletBalance, withdrawableBalance, pendingBalance,
//         escrowHeld, escrowIncoming, escrowCount }
//
// Single call the wallet modal uses to paint the balance hero + escrow
// banner accurately. escrowHeld = money THIS user has paid into escrow as a
// buyer on deals that haven't released/refunded yet (still locked, not
// spendable). escrowIncoming = money owed to this user as a seller on
// funded-but-not-yet-released deals (not theirs to spend or withdraw until
// the buyer confirms and the deal actually releases funds into
// walletBalance/withdrawableBalance via /api/deal's escrow-release).
//
// Reads users/{uid}/deals — the same subcollection the chat/deal-status UI
// already reads client-side (see chat room escrow status banner) — so the
// numbers shown here always match what the deal screens show.
// ─────────────────────────────────────────────────────────────────────────────
async function handleWalletSummary(req, res) {
  const { idToken } = req.body;
  if (!idToken) return res.status(401).json({ error: 'Missing auth token' });

  const fbUser = await verifyFirebaseToken(idToken);
  const uid = fbUser.localId;

  const db = getAdminDb();
  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });
  const userData = userSnap.data();

  // Escrow is tracked per-deal on users/{uid}/deals/{dealId}, mirroring the
  // chatRoom doc's paymentStatus/escrowAmount fields (see index.html's chat
  // escrow status banner for the same field names).
  const dealsSnap = await db.collection('users').doc(uid).collection('deals').get();

  let escrowHeld = 0;      // this user is the buyer, funds locked
  let escrowIncoming = 0;  // this user is the seller, funds locked, not theirs yet
  let escrowCount = 0;

  // Field names verified against deal.js: escrow-pay (handleEscrowPay) mirrors
  // paymentStatus + escrowAmount onto users/{uid}/deals/{dealId} for both the
  // buyer and seller copy, and buyerUid/sellerUid are set once at deal
  // creation (handleCreateDeal) and never overwritten afterward, so they're
  // present on both mirror docs for the lifetime of the deal.
  dealsSnap.forEach(d => {
    const deal = d.data();
    if (deal.paymentStatus !== 'funded') return; // only actively-held escrow counts
    const amt = Number(deal.escrowAmount || deal.price || 0);
    if (!amt) return;
    escrowCount++;
    if (deal.buyerUid === uid) escrowHeld += amt;
    else if (deal.sellerUid === uid) escrowIncoming += amt;
  });

  return res.status(200).json({
    walletBalance:       Number(userData.walletBalance || 0),
    withdrawableBalance: Number(userData.withdrawableBalance || 0),
    pendingBalance:       Number(userData.pendingBalance || 0),
    escrowHeld:           parseFloat(escrowHeld.toFixed(2)),
    escrowIncoming:       parseFloat(escrowIncoming.toFixed(2)),
    escrowCount,
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// autowithdraw-get  { idToken }
//   →  { enabled, threshold, keepBalance, method, paypalEmail }
// ─────────────────────────────────────────────────────────────────────────────
async function handleAutoWithdrawGet(req, res) {
  const { idToken } = req.body;
  if (!idToken) return res.status(401).json({ error: 'Missing auth token' });

  const fbUser = await verifyFirebaseToken(idToken);
  const uid = fbUser.localId;

  const db = getAdminDb();
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) return res.status(404).json({ error: 'User not found' });

  const data = snap.data();
  const cfg = data.autoWithdraw || {};

  return res.status(200).json({
    enabled:     Boolean(cfg.enabled),
    threshold:   Number(cfg.threshold || 0),
    keepBalance: Number(cfg.keepBalance || 0),
    method:      cfg.method === 'bank' ? 'bank' : 'paypal',
    paypalEmail: cfg.paypalEmail || '',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// autowithdraw-save  { idToken, enabled, threshold, keepBalance, method, paypalEmail }
//   →  { success, ...settings }
//
// Unlike auto top-up (which needs a saved PayPal vault token to charge),
// auto withdrawal doesn't require anything pre-saved — it just needs a
// payout email, same as a manual withdrawal request. keepBalance defaults to
// 0 (withdraw everything above the threshold down to zero) if omitted.
// ─────────────────────────────────────────────────────────────────────────────
async function handleAutoWithdrawSave(req, res) {
  const { idToken, enabled, threshold, keepBalance = 0, method = 'paypal', paypalEmail } = req.body;
  if (!idToken) return res.status(401).json({ error: 'Missing auth token' });

  const fbUser = await verifyFirebaseToken(idToken);
  const uid = fbUser.localId;

  const db = getAdminDb();
  const userRef = db.collection('users').doc(uid);
  const snap = await userRef.get();
  if (!snap.exists) return res.status(404).json({ error: 'User not found' });

  const wantsEnabled = Boolean(enabled);

  if (wantsEnabled) {
    if (!['paypal', 'bank'].includes(method)) {
      return res.status(400).json({ error: 'Invalid payment method' });
    }
    if (!paypalEmail || !paypalEmail.includes('@')) {
      return res.status(400).json({ error: 'A valid PayPal email is required for auto withdrawal.' });
    }

    const th   = Number(threshold);
    const keep = Number(keepBalance);

    if (!th || th < AUTOWITHDRAW_MIN_THRESHOLD || th > AUTOWITHDRAW_MAX_THRESHOLD) {
      return res.status(400).json({ error: `Threshold must be between $${AUTOWITHDRAW_MIN_THRESHOLD} and $${AUTOWITHDRAW_MAX_THRESHOLD}.` });
    }
    if (keep < AUTOWITHDRAW_MIN_KEEP || keep > AUTOWITHDRAW_MAX_KEEP) {
      return res.status(400).json({ error: `Keep-in-wallet amount must be between $${AUTOWITHDRAW_MIN_KEEP} and $${AUTOWITHDRAW_MAX_KEEP}.` });
    }
    if (keep >= th) {
      return res.status(400).json({ error: 'The amount you keep must be less than your threshold, or auto withdrawal would never have anything to send.' });
    }

    await userRef.set({
      autoWithdraw: {
        enabled:     true,
        threshold:   parseFloat(th.toFixed(2)),
        keepBalance: parseFloat(keep.toFixed(2)),
        method,
        paypalEmail,
        updatedAt:   FieldValue.serverTimestamp(),
      },
    }, { merge: true });

    await userRef.collection('transactions').add({
      type:      'autowithdraw_settings',
      amount:    0,
      label:     'Auto withdrawal enabled',
      note:      `Will withdraw down to $${keep.toFixed(2)} whenever your withdrawable balance reaches $${th.toFixed(2)}.`,
      status:    'completed',
      createdAt: FieldValue.serverTimestamp(),
    });

    // A save can itself push the user over their new threshold immediately
    // (e.g. they already have $200 withdrawable and just set a $100
    // threshold) — check right away instead of waiting for the next credit.
    await maybeAutoWithdraw(db, uid);

    return res.status(200).json({ success: true, enabled: true, threshold: th, keepBalance: keep, method, paypalEmail });
  }

  // Disabling — always allowed, no payout-email requirement
  await userRef.set({
    autoWithdraw: {
      enabled:   false,
      updatedAt: FieldValue.serverTimestamp(),
    },
  }, { merge: true });

  await userRef.collection('transactions').add({
    type:      'autowithdraw_settings',
    amount:    0,
    label:     'Auto withdrawal disabled',
    status:    'completed',
    createdAt: FieldValue.serverTimestamp(),
  });

  return res.status(200).json({ success: true, enabled: false });
}

// ─────────────────────────────────────────────────────────────────────────────
// autosend-create  { idToken, recipientUid, amount, intervalDays, note? }
//   →  { success, schedule }
//
// Schedules a repeating P2P transfer. First run is `intervalDays` from now
// (not immediately) — if the user wants an immediate send too, they can use
// the regular one-off "Send" action alongside this.
// ─────────────────────────────────────────────────────────────────────────────
async function handleAutoSendCreate(req, res) {
  const { idToken, recipientUid, amount, intervalDays, note } = req.body;
  if (!idToken)      return res.status(401).json({ error: 'Missing auth token' });
  if (!recipientUid) return res.status(400).json({ error: 'Missing recipient' });

  const amt = parseFloat(amount);
  if (!amt || amt <= 0 || amt > 10000 || !isFinite(amt)) {
    return res.status(400).json({ error: 'Amount must be between $0.01 and $10,000' });
  }

  const interval = Number(intervalDays);
  if (!AUTOSEND_INTERVALS.includes(interval)) {
    return res.status(400).json({ error: `Interval must be one of: ${AUTOSEND_INTERVALS.join(', ')} days` });
  }

  const fbUser = await verifyFirebaseToken(idToken);
  const senderUid = fbUser.localId;

  if (senderUid === recipientUid) {
    return res.status(400).json({ error: 'You cannot auto-send money to yourself' });
  }

  const db = getAdminDb();

  // Confirm the recipient actually exists before scheduling anything
  const recipSnap = await db.collection('users').doc(recipientUid).get();
  if (!recipSnap.exists) return res.status(404).json({ error: 'Recipient account not found' });
  const recipData = recipSnap.data();
  const recipName = recipData.displayName || recipData.username || recipData.email?.split('@')[0] || 'User';

  const safeNote = (note || '').slice(0, 200);
  const nextRunAt = Timestamp.fromMillis(Date.now() + interval * 24 * 60 * 60 * 1000);

  const scheduleRef = db.collection('users').doc(senderUid).collection('autosends').doc();
  const schedule = {
    id:            scheduleRef.id,
    recipientUid,
    recipientName: recipName,
    recipientEmail: recipData.email || '',
    amount:        amt,
    intervalDays:  interval,
    note:          safeNote,
    status:        'active',
    nextRunAt,
    lastRunAt:     null,
    runCount:      0,
    failCount:     0,
    createdAt:     FieldValue.serverTimestamp(),
  };
  await scheduleRef.set(schedule);

  await db.collection('users').doc(senderUid).collection('transactions').add({
    type:      'autosend_settings',
    amount:    0,
    label:     `Auto send scheduled · every ${interval} day${interval !== 1 ? 's' : ''}`,
    note:      `$${amt.toFixed(2)} to ${recipName} every ${interval} days until cancelled.`,
    status:    'completed',
    createdAt: FieldValue.serverTimestamp(),
  });

  return res.status(200).json({ success: true, schedule: { ...schedule, createdAt: Date.now() } });
}

// ─────────────────────────────────────────────────────────────────────────────
// autosend-list  { idToken }  →  { schedules: [...] }
// ─────────────────────────────────────────────────────────────────────────────
async function handleAutoSendList(req, res) {
  const { idToken } = req.body;
  if (!idToken) return res.status(401).json({ error: 'Missing auth token' });

  const fbUser = await verifyFirebaseToken(idToken);
  const uid = fbUser.localId;

  const db = getAdminDb();
  const snap = await db.collection('users').doc(uid).collection('autosends')
    .orderBy('createdAt', 'desc')
    .get();

  const schedules = snap.docs.map(d => {
    const s = d.data();
    return {
      id:             d.id,
      recipientUid:   s.recipientUid,
      recipientName:  s.recipientName,
      recipientEmail: s.recipientEmail,
      amount:         s.amount,
      intervalDays:   s.intervalDays,
      note:           s.note || '',
      status:         s.status,
      nextRunAt:      s.nextRunAt?.toMillis?.() || null,
      lastRunAt:      s.lastRunAt?.toMillis?.() || null,
      runCount:       s.runCount || 0,
      failCount:      s.failCount || 0,
    };
  });

  return res.status(200).json({ schedules });
}

// ─────────────────────────────────────────────────────────────────────────────
// autosend-cancel  { idToken, scheduleId }  →  { success }
// ─────────────────────────────────────────────────────────────────────────────
async function handleAutoSendCancel(req, res) {
  const { idToken, scheduleId } = req.body;
  if (!idToken)     return res.status(401).json({ error: 'Missing auth token' });
  if (!scheduleId)  return res.status(400).json({ error: 'Missing scheduleId' });

  const fbUser = await verifyFirebaseToken(idToken);
  const uid = fbUser.localId;

  const db = getAdminDb();
  const ref = db.collection('users').doc(uid).collection('autosends').doc(scheduleId);
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ error: 'Schedule not found' });

  await ref.update({ status: 'cancelled', cancelledAt: FieldValue.serverTimestamp() });

  const s = snap.data();
  await db.collection('users').doc(uid).collection('transactions').add({
    type:      'autosend_settings',
    amount:    0,
    label:     'Auto send cancelled',
    note:      `Stopped recurring $${Number(s.amount || 0).toFixed(2)} to ${s.recipientName || 'recipient'}.`,
    status:    'completed',
    createdAt: FieldValue.serverTimestamp(),
  });

  return res.status(200).json({ success: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// autosend-run  { cronSecret }  →  { processed, succeeded, failed }
//
// Cron entry point — no idToken (this isn't called by a logged-in browser).
// Protect it with AUTOSEND_CRON_SECRET in env and point your scheduler here.
// Scans every user doc that has at least one active autosend schedule due
// (nextRunAt <= now) via a collection-group query, and processes each one:
//   - re-verifies the recipient still exists
//   - re-checks the sender's live balance (never trusts cached data)
//   - on success: debits sender, credits recipient (95% after 5% fee, same
//     as one-off Send), advances nextRunAt by intervalDays, logs a normal
//     'send'/'receive' transaction pair on both sides
//   - on failure (insufficient balance, recipient gone, etc.): does NOT
//     advance nextRunAt (retries next sweep), increments failCount, and logs
//     a 'failed' transaction on the sender's side so History shows exactly
//     what happened and why
//   - after 5 consecutive failures, auto-pauses the schedule (status:
//     'paused') so a permanently-broken schedule doesn't spam failed
//     attempts forever; the user can review and cancel/fix it from Send tab
// ─────────────────────────────────────────────────────────────────────────────
const AUTOSEND_MAX_CONSECUTIVE_FAILS = 5;
const TRANSFER_FEE_RATE_AUTOSEND = 0.05;

async function handleAutoSendRun(req, res) {
  const { cronSecret } = req.body || {};
  if (AUTOSEND_CRON_SECRET && cronSecret !== AUTOSEND_CRON_SECRET) {
    return res.status(401).json({ error: 'Invalid cron secret' });
  }

  const db = getAdminDb();
  const now = Date.now();

  // Collection-group query across every user's autosends subcollection
  const dueSnap = await db.collectionGroup('autosends')
    .where('status', '==', 'active')
    .where('nextRunAt', '<=', Timestamp.fromMillis(now))
    .limit(200) // safety cap per sweep
    .get();

  let processed = 0, succeeded = 0, failed = 0;

  for (const scheduleDoc of dueSnap.docs) {
    processed++;
    const schedule = scheduleDoc.data();
    const senderRef = scheduleDoc.ref.parent.parent; // users/{senderUid}
    const senderUid = senderRef.id;
    const scheduleRef = scheduleDoc.ref;

    try {
      const result = await db.runTransaction(async tx => {
        const [senderSnap, recipSnap] = await Promise.all([
          tx.get(senderRef),
          tx.get(db.collection('users').doc(schedule.recipientUid)),
        ]);

        if (!senderSnap.exists) throw { code: 'sender_missing', message: 'Sender account not found' };
        if (!recipSnap.exists)  throw { code: 'recipient_missing', message: 'Recipient account no longer exists' };

        const senderData = senderSnap.data();
        const senderBal = parseFloat((senderData.walletBalance || 0).toFixed(2));
        const amt = Number(schedule.amount);

        if (amt > senderBal) {
          throw {
            code: 'insufficient_balance',
            message: `Insufficient balance — needed $${amt.toFixed(2)}, had $${senderBal.toFixed(2)}`,
          };
        }

        const fee        = parseFloat((amt * TRANSFER_FEE_RATE_AUTOSEND).toFixed(2));
        const receiveAmt = parseFloat((amt - fee).toFixed(2));

        const senderWithdrawable = parseFloat((senderData.withdrawableBalance || 0).toFixed(2));
        const newSenderWithdrawable = parseFloat(Math.max(0, senderWithdrawable - amt).toFixed(2));
        const newSenderBal = parseFloat((senderBal - amt).toFixed(2));

        const recipData = recipSnap.data();
        const recipBal = parseFloat((recipData.walletBalance || 0).toFixed(2));
        const recipWithdrawable = parseFloat((recipData.withdrawableBalance || 0).toFixed(2));
        const newRecipBal = parseFloat((recipBal + receiveAmt).toFixed(2));
        const newRecipWithdrawable = parseFloat((recipWithdrawable + receiveAmt).toFixed(2));

        tx.update(senderRef, { walletBalance: newSenderBal, withdrawableBalance: newSenderWithdrawable });
        tx.update(recipSnap.ref, { walletBalance: newRecipBal, withdrawableBalance: newRecipWithdrawable });

        const nextRunAt = Timestamp.fromMillis(now + schedule.intervalDays * 24 * 60 * 60 * 1000);
        tx.update(scheduleRef, {
          nextRunAt,
          lastRunAt: FieldValue.serverTimestamp(),
          runCount:  FieldValue.increment(1),
          failCount: 0, // reset consecutive-failure counter on success
        });

        tx.set(senderRef.collection('transactions').doc(), {
          type:      'autosend',
          amount:    -amt,
          fee,
          label:     `Auto send to ${schedule.recipientName || 'recipient'}`,
          note:      (schedule.note ? `"${schedule.note}" · ` : '') + `Repeats every ${schedule.intervalDays} days`,
          scheduleId: scheduleRef.id,
          status:    'completed',
          createdAt: FieldValue.serverTimestamp(),
        });

        tx.set(recipSnap.ref.collection('transactions').doc(), {
          type:      'receive',
          amount:    receiveAmt,
          fee,
          label:     `Received from ${senderData.displayName || senderData.username || 'auto send'}`,
          note:      `Recurring payment · ${Math.round(TRANSFER_FEE_RATE_AUTOSEND * 100)}% fee (${fee.toFixed(2)}) applied`,
          status:    'completed',
          createdAt: FieldValue.serverTimestamp(),
        });

        tx.set(recipSnap.ref.collection('notifications').doc(), {
          type:      'wallet_transfer',
          title:     'Money received',
          body:      `You received a recurring payment of $${receiveAmt.toLocaleString()}.`,
          read:      false,
          createdAt: Date.now(),
        });

        return { newSenderBal };
      });

      succeeded++;
      // maybeAutoTopUp removed — PayPal deposits/vault no longer exist.
      await maybeAutoWithdraw(db, schedule.recipientUid);
      console.log(`[autosend] OK schedule=${scheduleRef.id} sender=${senderUid} newBal=${result.newSenderBal}`);

    } catch (err) {
      failed++;
      const code = err?.code || 'unknown_error';
      const message = err?.message || err?.toString?.() || 'Unknown error';
      console.warn(`[autosend] FAILED schedule=${scheduleRef.id} sender=${senderUid} code=${code}: ${message}`);

      // Log the failed attempt on the sender's history — do NOT advance
      // nextRunAt, so the next sweep retries automatically.
      await senderRef.collection('transactions').add({
        type:       'autosend_failed',
        amount:     0,
        label:      'Auto send failed',
        note:       message,
        failReason: code,
        scheduleId: scheduleRef.id,
        status:     'failed',
        createdAt:  FieldValue.serverTimestamp(),
      });

      const newFailCount = (schedule.failCount || 0) + 1;
      const updates = { failCount: newFailCount, lastAttemptAt: FieldValue.serverTimestamp() };

      // Auto-pause after too many consecutive failures so a dead schedule
      // (recipient deleted, permanently broke) doesn't retry forever.
      if (newFailCount >= AUTOSEND_MAX_CONSECUTIVE_FAILS) {
        updates.status = 'paused';
        await senderRef.collection('transactions').add({
          type:      'autosend_settings',
          amount:    0,
          label:     'Auto send paused',
          note:      `Paused after ${newFailCount} failed attempts in a row. Review and resume from the Send tab.`,
          status:    'completed',
          createdAt: FieldValue.serverTimestamp(),
        });
      } else {
        // Retry sooner rather than waiting a full interval again — try
        // again on the next sweep by leaving nextRunAt in the past (no-op),
        // it's already <= now so it'll be picked up next run automatically.
      }

      await scheduleRef.update(updates).catch(e => console.error('[autosend] failed to update failCount', e));
    }
  }

  return res.status(200).json({ processed, succeeded, failed });
}

// Debits the caller's wallet, sets listings/{listingId}.boostedUntil for
// legacy/reference purposes, and — the part that actually drives visible
// placement — writes a denormalized ad record to boostedAds/{listingId}.
// BoostedRow reads that collection live/uncached (listing.boosted-ads in
// app/api/listings/_handler.js), never through the feed's TTL'd pool
// cache, so the purchase is visible on the very next page load. The main
// feed itself stays a plain seeded shuffle and does not rank by boost —
// boosted listings only appear in the dedicated row.
//
// Price is looked up from BOOST_PLANS here — never trusts a client-sent price,
// same principle as PLAN_IDS/PLAN_PRICES above. Caller must own the listing.
// Stacking a boost onto an already-boosted listing extends from whichever is
// later — now or the current boostedUntil — rather than overwriting it, so a
// seller topping up mid-boost doesn't lose remaining paid time.
// ─────────────────────────────────────────────────────────────────────────────
async function handleBoostListing(req, res) {
  const { idToken, listingId, days } = req.body;
  if (!idToken)    return res.status(401).json({ error: 'Missing auth token' });
  if (!listingId)  return res.status(400).json({ error: 'Missing listingId' });

  const d = Number(days);
  const price = BOOST_PLANS[d];
  if (!price) {
    return res.status(400).json({ error: 'Invalid boost duration' });
  }

  // 1. Verify Firebase identity
  const fbUser = await verifyFirebaseToken(idToken);
  const uid = fbUser.localId;

  // 2. Run everything in a single Firestore transaction via Admin SDK —
  //    balance check, listing ownership check, wallet debit, and the
  //    boostedUntil write all succeed or fail together.
  const db         = getAdminDb();
  const userRef    = db.collection('users').doc(uid);
  const listingRef = db.collection('listings').doc(listingId);

  const result = await db.runTransaction(async tx => {
    const [userSnap, listingSnap] = await Promise.all([
      tx.get(userRef),
      tx.get(listingRef),
    ]);

    if (!userSnap.exists)    throw new Error('User document not found');
    if (!listingSnap.exists) throw new Error('Listing not found');

    const listingData = listingSnap.data();
    if (listingData.ownerId !== uid) {
      throw new Error('You can only boost your own listings');
    }

    const bal = parseFloat((userSnap.data().walletBalance || 0).toFixed(2));
    // Server-side balance check — client cannot spoof this
    if (price > bal) throw new Error('Insufficient balance');

    const updatedBal = parseFloat((bal - price).toFixed(2));

    // Extend from the later of "now" or the current boostedUntil, so a
    // top-up on an already-boosted listing adds time instead of wasting it.
    const now = Date.now();
    const currentUntilMs = listingData.boostedUntil?.toMillis?.() || 0;
    const baseMs   = Math.max(now, currentUntilMs);
    const newUntil = baseMs + d * 24 * 60 * 60 * 1000;
    const newUntilTs = Timestamp.fromMillis(newUntil);

    tx.update(userRef, { walletBalance: updatedBal });
    tx.update(listingRef, {
      boostedUntil:   newUntilTs,
      lastBoostedAt:  FieldValue.serverTimestamp(),
      lastBoostDays:  d,
    });

    // Write the paid ad slot itself — a fully self-contained, denormalized
    // doc in its own `boostedAds` collection, NOT just a flag on the
    // listings doc. This is what BoostedRow actually reads, and it reads it
    // live/uncached (see listing.boosted-ads in app/api/listings/
    // _handler.js) — deliberately independent of the feed's 1-hour TTL
    // pool cache, so a boost the seller just paid real money for is
    // visible on the very next page load, not up to an hour later.
    // Same-transaction write means "payment succeeded" and "ad is live"
    // can never drift apart — they commit together or not at all.
    tx.set(db.collection('boostedAds').doc(listingId), {
      listingId,
      type:         listingData.type || 'website',
      ownerId:      listingData.ownerId || null,
      title:        listingData.title || 'Untitled',
      tagline:      listingData.tagline || null,
      url:          listingData.url || null,
      images:       Array.isArray(listingData.images) ? listingData.images.slice(0, 6) : [],
      imageCover:   listingData.imageCover || (listingData.images && listingData.images[0]) || null,
      appIcon:      listingData.appIcon || null,
      category:     listingData.category || null,
      gameType:     listingData.gameType || null,
      financials:   listingData.financials || null,
      settings:     listingData.settings || null,
      verified:     !!listingData.verified,
      boostedUntil: newUntilTs,
    });

    tx.set(userRef.collection('transactions').doc(), {
      type:       'boost',
      amount:     -price,
      label:      `Boosted listing · ${d} day${d !== 1 ? 's' : ''}`,
      listingId,
      status:     'completed',
      createdAt:  FieldValue.serverTimestamp(),
    });

    return { updatedBal, newUntil };
  });

  // maybeAutoTopUp removed — PayPal deposits/vault no longer exist.

  return res.status(200).json({
    success:      true,
    newBalance:   result.updatedBal,
    boostedUntil: result.newUntil,
    days: d,
    price,
  });
}

// ── Setup notes for Auto Send cron ──────────────────────────────────────────
// 1. Set AUTOSEND_CRON_SECRET in your environment.
// 2. Point a scheduler (Vercel Cron, cron-job.org, GitHub Actions cron, etc.)
//    at this endpoint on whatever cadence you like — hourly is plenty, since
//    a schedule only fires once its nextRunAt is actually due:
//      POST /api/paypal
//      Content-Type: application/json
//      { "action": "autosend-run", "cronSecret": "<AUTOSEND_CRON_SECRET>" }
// 3. Firestore requires a composite index for the collection-group query
//    used in handleAutoSendRun (status ASC, nextRunAt ASC) on the
//    `autosends` collection group. Firestore's error message on first run
//    will include a direct link to create it — click it once and you're set.

// ── Setup notes for Auto Withdrawal ─────────────────────────────────────────
// 1. (Recommended) Add an `autoWithdraw` block to LIMITS in limits.js, e.g.:
//      autoWithdraw: { minThreshold: 10, maxThreshold: 10000, minKeepBalance: 0, maxKeepBalance: 10000 }
//    mirroring the autoTopUp block already there. This file falls back to
//    the same defaults if that block is missing, so nothing breaks either way.
// 2. In deal.js, after a successful escrow release credits the seller's
//    withdrawableBalance, import and call maybeAutoWithdraw (named export
//    below) with the seller's uid:
//      import { maybeAutoWithdraw } from './paypal.js';
//      await maybeAutoWithdraw(db, sellerUid);
//    This is the only credit path not already wired up from within this file.
// 3. Pending auto-filed withdrawals land in the same `withdrawals` collection
//    as manual ones (flagged auto: true) — no changes needed to whatever
//    admin process currently pays those out.

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
};

export { maybeAutoWithdraw };

