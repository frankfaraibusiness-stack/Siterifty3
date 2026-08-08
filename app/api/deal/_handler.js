// /api/deal.js — Siterifty deal & escrow handler
// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for ALL deal and escrow operations.
// Previously split across limits.js (create/accept/reject/cancel-deal) and
// paypal.js (escrow-pay/deliver/release/refund/dispute). Centralised here so
// deal logic lives in one place and is easy to audit, extend, and test.
//
// POST /api/deal  { action, idToken, ...params }
//
//   ── Deal lifecycle ────────────────────────────────────────────────────────
//   action: 'create-deal'   { idToken, listingId, message, offerPrice? }
//                            → { allowed: true, dealId }
//                            → 409 if a pending deal already exists
//
//   action: 'accept-deal'   { idToken, dealId }
//                            → { allowed: true, chatRoomId, expiresAt }
//                            Seller only. Creates deal chat room atomically.
//
//   action: 'reject-deal'   { idToken, dealId }
//                            → { allowed: true }
//                            Seller only.
//
//   action: 'cancel-deal'   { idToken, dealId }
//                            → { allowed: true }
//                            Buyer only.
//
//   ── Escrow lifecycle ──────────────────────────────────────────────────────
//   Status machine:
//     accepted → funded → delivered → complete
//                        ↘ disputed → (refunded | complete via support)
//     accepted → refunded  (buyer or seller cancels before funded)
//
//   action: 'escrow-pay'    { idToken, chatRoomId, dealId, amount }
//                            Buyer pays wallet → escrow. Sets status='funded'.
//                            → { success: true, escrowAmount }
//
//   action: 'escrow-deliver' { idToken, chatRoomId, dealId }
//                            Seller marks as delivered. Sets status='delivered'.
//                            Does NOT release funds — buyer must confirm.
//                            → { success: true }
//
//   action: 'escrow-release' { idToken, chatRoomId, dealId }
//                            Buyer confirms delivery. Credits seller wallet.
//                            Sets status='complete'. Closes chat room.
//                            → { success: true }
//
//   action: 'escrow-refund'  { idToken, chatRoomId, dealId }
//                            Seller or buyer triggers refund. Refunds buyer wallet.
//                            Sets status='refunded'. Closes chat room.
//                            → { success: true }
//
//   action: 'escrow-dispute' { idToken, chatRoomId, dealId, reason }
//                            Either party raises a dispute. Freezes escrow.
//                            Creates a record in /disputes for admin review.
//                            → { success: true }
//
//   action: 'escrow-get-download-url' { idToken, chatRoomId, dealId, storagePath }
//                            Mints a short-lived (5 min) signed URL for a deal
//                            deliverable stored in private Supabase storage.
//                            Caller must be the buyer or seller on the deal.
//                            Allowed while status is funded/delivered/disputed;
//                            refused once complete or refunded — the buyer has
//                            already had their verification window, so the
//                            link is not kept alive indefinitely after the
//                            transaction closes. (The file itself isn't
//                            deleted — that's governed separately by
//                            storage.js's autoCleanup — this only gates the
//                            app-level ability to fetch a fresh link to it.)
//                            → { url, expiresIn }
//
//   ── Seller Dashboard ──────────────────────────────────────────────────────
//   action: 'list-my-deals' { idToken, range?, limit? }
//                            → { ok: true, deals, revenue, dealsCompleted }
//                            Caller's own deals (any status), newest first,
//                            optionally filtered to a range matching the
//                            dashboard's filter bar ('today'|'yesterday'|
//                            'this-week'|'this-month'|'last-90'|'lifetime').
//                            revenue/dealsCompleted only count status:'complete'
//                            + dealOutcome:'successful' deals, same rule as
//                            get-seller-stats.
//
// Firestore paths touched:
//   users/{uid}/deals/{dealId}
//   dealChats/{chatRoomId}
//   dealChats/{chatRoomId}/messages/*
//   users/{uid}/threads/{chatRoomId}
//   users/{uid}/notifications/*
//   users/{uid}/transactions/*
//   disputes/*
//   listings/{listingId}        (read only — to populate deal fields)
//
// All mutations run via Firebase Admin SDK inside Firestore transactions.
// The client must NOT write directly to any of the above paths.
//
// ── AI agent module (below, same file) ────────────────────────────────────
// The seller's AI agent (folded into this file — see "AI AGENT" section
// near the bottom) accepts/rejects a pending deal by calling settleDealCore()
// directly, going through the EXACT SAME transaction, chat-room creation,
// and notification/email logic as a manual accept/reject — there is only
// one accept/reject implementation in the app, not a duplicate "agent
// version." The agent module used to be a separate /api/agent.js file; it
// now lives here purely to stay under the hobby-plan serverless function
// count (each file under /api is its own function slot).
// ─────────────────────────────────────────────────────────────────────────────

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from '../../../lib/server/adminDb';
import { supabaseCreateSignedUrl, findAccountById, deleteFiles } from '../_lib/storage.js';
import { LIMITS } from '../_lib/limits.js';
import { sendPushToUser } from '../_lib/push.js';
import { dispatchWebhook } from '../_lib/webhooks.js';
import crypto from 'crypto';

// ═════════════════════════════════════════════════════════════════════════════
// EMAIL (Resend) — sent only for the "big" moments: deal received, accepted,
// payment funded, delivered, released (incl. auto-release), refunded (incl.
// auto), disputed. Everyday chat/system messages stay in-app only.
//
// Fire-and-forget by design, same philosophy as the in-app notification
// writes elsewhere in this file: a slow or failing email must never hold up
// or fail the underlying money/deal transaction. Every call site awaits this
// AFTER the Firestore transaction has already committed, and errors are
// caught and logged, never thrown.
// ═════════════════════════════════════════════════════════════════════════════

const RESEND_API_KEY  = process.env.RESEND_API_KEY;
const EMAIL_FROM       = process.env.DEAL_EMAIL_FROM || 'Siterifty <deals@dlsvalue.site>';
const SITE_ORIGIN      = process.env.SITE_ORIGIN || process.env.PUBLIC_BASE_URL || '';

// Brand accent per event — small visual language so buyers/sellers can
// tell at a glance (before even reading) whether an email is good news,
// informational, or needs attention.
const EMAIL_ACCENTS = {
  success: { bar: '#16a34a', chip: '#dcfce7', chipText: '#166534' }, // money in / deal won
  info:    { bar: '#2563eb', chip: '#dbeafe', chipText: '#1e40af' }, // status update
  warn:    { bar: '#d97706', chip: '#fef3c7', chipText: '#92400e' }, // needs action
  danger:  { bar: '#dc2626', chip: '#fee2e2', chipText: '#991b1b' }, // dispute / rejected
};

// One shared, modern HTML shell. `accentKey` picks the color language,
// `eyebrow` is the small label chip above the headline, everything else is
// free-form content rendered as a single content block for simplicity —
// callers pass fully-formed inner HTML (kept short/plain per email).
function renderDealEmail({ accentKey = 'info', eyebrow, heading, bodyHtml, ctaLabel, ctaUrl, footerNote }) {
  const accent = EMAIL_ACCENTS[accentKey] || EMAIL_ACCENTS.info;
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${heading}</title>
</head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(16,24,40,0.08);">
          <tr>
            <td style="height:5px;background:${accent.bar};line-height:0;font-size:0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:32px 32px 8px 32px;">
              <div style="display:inline-block;padding:4px 12px;border-radius:999px;background:${accent.chip};color:${accent.chipText};font-size:12px;font-weight:600;letter-spacing:0.02em;text-transform:uppercase;">
                ${eyebrow}
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:12px 32px 0 32px;">
              <h1 style="margin:0;font-size:22px;line-height:1.3;color:#0f1222;font-weight:700;">${heading}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 8px 32px;font-size:15px;line-height:1.6;color:#3f4354;">
              ${bodyHtml}
            </td>
          </tr>
          ${ctaUrl ? `
          <tr>
            <td style="padding:16px 32px 8px 32px;">
              <a href="${ctaUrl}" style="display:inline-block;background:#0f1222;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:10px;">
                ${ctaLabel || 'View deal'}
              </a>
            </td>
          </tr>` : ''}
          <tr>
            <td style="padding:24px 32px 0 32px;">
              <div style="height:1px;background:#eef0f4;"></div>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 32px 32px;font-size:12px;line-height:1.6;color:#9aa0ae;">
              ${footerNote || 'You are receiving this because it relates to an active deal on Siterifty.'}
              <br>© ${year} Siterifty. All rights reserved.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Low-level send — direct HTTPS call to Resend's API (no SDK dependency).
// Swallows all errors; callers never need their own try/catch.
async function sendResendEmail({ to, subject, html }) {
  if (!RESEND_API_KEY) {
    console.warn('[deal-email] RESEND_API_KEY not configured — skipping email:', subject);
    return;
  }
  if (!to) {
    console.warn('[deal-email] no recipient email — skipping:', subject);
    return;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({ from: EMAIL_FROM, to, subject, html }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('[deal-email] Resend API error', res.status, errText);
    }
  } catch (err) {
    console.error('[deal-email] send failed (non-fatal):', err.message);
  }
}

// High-level helper used by every call site below. `chatRoomId` (if present)
// links the CTA straight to the deal chat; otherwise it links to the deals
// inbox. Kept as one function so every email shares the same URL-building
// and shell-rendering logic.
function dealCtaUrl(chatRoomId) {
  if (!SITE_ORIGIN) return null; // no CTA button if we don't know our own origin
  return chatRoomId
    ? `${SITE_ORIGIN}/?deal=${encodeURIComponent(chatRoomId)}`
    : `${SITE_ORIGIN}/?tab=deals`;
}

async function sendDealEmail({ to, accentKey, eyebrow, heading, bodyHtml, ctaLabel, chatRoomId, subject }) {
  const html = renderDealEmail({
    accentKey,
    eyebrow,
    heading,
    bodyHtml,
    ctaLabel,
    ctaUrl: dealCtaUrl(chatRoomId),
  });
  await sendResendEmail({ to, subject: subject || heading, html });
}

// ── Combined email + push helper ─────────────────────────────────────────────
// "Two birds" — email and push are two independent delivery channels with
// different failure modes (bad/unverified sender domain, spam folder, no
// inbox at all vs. no active push subscription, browser never granted
// permission, stale endpoint). Firing both means a single-channel outage
// doesn't mean the user misses the notification entirely. Each channel is
// awaited but isolated with its own .catch() so a failure in one never
// blocks or suppresses the other — see sendDealEmail (never throws) and
// sendPushToUser (never throws) for how each channel fails safely on its own.
//
// `uid` is required for push (push looks up subscriptions by uid) but email
// params are otherwise identical to sendDealEmail's.
async function notifyDeal({ uid, to, accentKey, eyebrow, heading, bodyHtml, ctaLabel, chatRoomId, subject, pushBody }) {
  await Promise.all([
    sendDealEmail({ to, accentKey, eyebrow, heading, bodyHtml, ctaLabel, chatRoomId, subject }).catch(err => {
      console.error('[deal-notify] email failed (non-fatal):', err?.message);
    }),
    uid ? sendPushToUser(uid, {
      title: heading,
      // Push notifications render as plain text (no HTML), and are shown in
      // a small OS-level bubble — so this uses a short, plain-text body
      // rather than reusing bodyHtml (which contains <strong> tags meant for
      // the email's rich HTML rendering).
      body: pushBody || heading,
      url: dealCtaUrl(chatRoomId) || '/',
    }).catch(err => {
      console.error('[deal-notify] push failed (non-fatal):', err?.message);
    }) : Promise.resolve(),
  ]);
}


// ── Internal call into /api/aistudio for AI triage ──
// Fire-and-forget from the caller's perspective — dispute filing must never
// fail or slow down because the AI is slow/down. AISTUDIO_INTERNAL_TOKEN lets
// aistudio.js trust this as a server-to-server call rather than requiring a
// user's Firebase ID token (there isn't a "user" for this specific call —
// it's this backend calling another backend route).
async function triggerAiTriage({ kind, id, evidence }) {
  try {
    const base = process.env.PUBLIC_BASE_URL
      || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
    if (!base) {
      console.warn('[deal] no base URL configured (PUBLIC_BASE_URL/VERCEL_URL) — skipping AI triage trigger');
      return;
    }
    await fetch(`${base}/api/aistudio`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': process.env.AISTUDIO_INTERNAL_TOKEN || '',
      },
      body: JSON.stringify({
        action: kind === 'dispute' ? 'triage-dispute' : 'triage-report',
        [kind === 'dispute' ? 'disputeId' : 'reportId']: id,
        evidence,
      }),
    });
  } catch (err) {
    // Non-fatal — the dispute/report record still exists and can be triaged
    // manually or retried later; we just log so it's visible in Vercel logs.
    console.error('[deal] AI triage trigger failed (non-fatal):', err.message);
  }
}

// ── Firebase Admin singleton ─────────────────────────────────────────────────
// Shared init — see lib/server/adminDb.ts.

// ── Admin session verification ───────────────────────────────────────────────
// Mirrors admin.js's / paypal.js's cookie sign/verify exactly (same
// COOKIE_NAME, same SESSION_SECRET, same HMAC-SHA256 format) so the same
// admin_session cookie works across every serverless function without a
// second login. Gates admin-only actions (dispute resolution) that must
// NOT be reachable with a regular user's Firebase idToken.
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

// ── Firebase ID token verification ───────────────────────────────────────────
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
  if (!res.ok) throw new Error('Invalid Firebase token');
  const data = await res.json();
  const user = data.users?.[0];
  if (!user) throw new Error('User not found');
  return user; // { localId, email, displayName, ... }
}

// ── Deal expiry (imported from limits constants) ──────────────────────────────
// How long an accepted deal has to be delivered before it auto-cancels.
// Different listing types genuinely take different amounts of work to hand
// over, so each gets its own target — but nothing is allowed to run past the
// 14-day hard cap regardless of type.
const DEAL_CHAT_EXPIRY_MS_BY_TYPE = {
  game:    7  * 24 * 60 * 60 * 1000,  // games: usually a fast handover
  app:     14 * 24 * 60 * 60 * 1000,  // apps: store transfers, signing keys, etc. take longer
  website: 14 * 24 * 60 * 60 * 1000,  // websites: capped down from a natural 21d to the 14d hard max
};
const DEAL_CHAT_EXPIRY_MS_DEFAULT = 14 * 24 * 60 * 60 * 1000; // fallback / hard cap
const DEAL_CHAT_EXPIRY_HARD_CAP_MS = 14 * 24 * 60 * 60 * 1000;

function dealExpiryMsForType(listingType) {
  const ms = DEAL_CHAT_EXPIRY_MS_BY_TYPE[listingType] || DEAL_CHAT_EXPIRY_MS_DEFAULT;
  return Math.min(ms, DEAL_CHAT_EXPIRY_HARD_CAP_MS);
}

// Once the seller marks a deal delivered, the buyer has this long to confirm
// receipt (or raise a dispute) before the deal auto-completes and funds
// release automatically. This is intentionally separate from — and does NOT
// close the chat like — the pre-delivery deadline above: the buyer can keep
// asking questions in the chat right up until this window closes.
const DEAL_AUTO_RELEASE_MS = 72 * 60 * 60 * 1000; // 72 hours

// ── Minimum deal message length — single source of truth is
//    limits.js LIMITS.deals.messageMinLength, never duplicated here.
const DEAL_MSG_MIN_LENGTH = LIMITS.deals.messageMinLength;

// ── Platform escrow fee recipient ────────────────────────────────────────────
// The seller's plan-based cut (LIMITS.saleFees — 20%/15%/10%/5% by plan) is
// deducted at escrow release and credited to this account's wallet, same as
// any other wallet credit (walletBalance + withdrawableBalance, transaction
// record, notification). The account is identified by email, set via the
// ADMIN_EMAIL environment variable (set in Vercel → Project → Settings →
// Environment Variables) — never hardcoded here, so the fee recipient can be
// changed without touching code or redeploying from source. Same variable
// name and pattern as paypal.js — both files must agree on who collects
// platform fees, so this is intentionally not a separate/independent value.
// Resolved once by email and cached in memory for the life of the serverless
// instance — a Firestore query by email has no place inside the money-moving
// transaction in _releaseEscrowForRoom, so this resolves ahead of time
// instead.
//
// Lowercased at read time: Firebase Auth normalizes user emails to lowercase
// on the users/{uid} doc, but there's nothing stopping ADMIN_EMAIL from being
// entered with different casing in Vercel (e.g. 'Siterifty@gmail.com') — a
// Firestore '==' query is case-sensitive, so that mismatch alone silently
// fails the lookup even though the account exists. Normalizing here means
// casing in the env var can never cause this again.
//
// Returns null (does NOT throw) if ADMIN_EMAIL is unset or the account can't
// be found — escrow release must never block a real buyer/seller transaction
// over a platform misconfiguration. Callers fall back to crediting the fee
// into the platformFeesUnclaimed ledger (see _creditPlatformFeeOrLedger
// below) instead of a live wallet when this returns null, so the fee is
// still deducted and fully accounted for per-user, just not yet delivered
// anywhere — nothing is silently discarded.
const PLATFORM_FEE_ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase() || null;
let _platformFeeAdminUidCache = null;

async function getPlatformFeeAdminUid(db) {
  if (_platformFeeAdminUidCache) return _platformFeeAdminUidCache;
  if (!PLATFORM_FEE_ADMIN_EMAIL) {
    console.error('[deal.js] ADMIN_EMAIL is not set — platform fees will be ledgered as unclaimed instead of credited live. Set it in Vercel → Project → Settings → Environment Variables.');
    return null;
  }
  const snap = await db.collection('users')
    .where('email', '==', PLATFORM_FEE_ADMIN_EMAIL)
    .limit(1)
    .get();
  if (snap.empty) {
    console.error(`[deal.js] Platform fee admin account (${PLATFORM_FEE_ADMIN_EMAIL}) not found — platform fees will be ledgered as unclaimed instead of credited live.`);
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
// fully attributed (who, what deal/transfer, how much, when) so a follow-up
// script can sweep platformFeesUnclaimed into the real admin wallet once
// ADMIN_EMAIL is fixed, crediting the exact right historical amount.
async function _ledgerUnclaimedFee(db, { amount, source, sourceId, payerUid, counterpartyUid, note }) {
  try {
    await db.collection('platformFeesUnclaimed').add({
      amount,
      source,          // 'escrow_release' | 'p2p_transfer' | 'donation'
      sourceId,         // dealId / chatRoomId / transfer doc id, whatever identifies the originating transaction
      payerUid,         // whose money this fee was deducted from
      counterpartyUid,  // the other party on the transaction, if any
      note,
      claimed: false,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    // Ledger write is best-effort logging on top of a fee that's already
    // been correctly deducted from the payer inside the real transaction —
    // never let a ledger failure retroactively break or reverse that.
    console.error('[deal.js] failed to write unclaimed-fee ledger entry (non-fatal)', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // sweep-expired-deals is a system/cron action — no end-user idToken exists
  // for it, so it's authenticated with a shared secret instead (Vercel Cron
  // convention: set CRON_SECRET in your project env vars, and Vercel sends
  // it automatically as "Authorization: Bearer <CRON_SECRET>" on scheduled
  // requests). It also accepts GET since Vercel Cron requests are GET.
  const isSweepRequest =
    (req.method === 'GET' && (req.query?.action === 'sweep-expired-deals')) ||
    (req.method === 'POST' && (req.body?.action === 'sweep-expired-deals'));

  if (isSweepRequest) {
    const authHeader = req.headers['authorization'] || '';
    const providedSecret = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : (req.body?.cronSecret || req.query?.cronSecret || '');
    const expectedSecret = process.env.CRON_SECRET || '';
    if (!expectedSecret || providedSecret !== expectedSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
      return await handleSweepExpiredDeals(req, res);
    } catch (err) {
      console.error('[deal.js] sweep-expired-deals', err.message);
      return res.status(500).json({ error: err.message || 'Internal error' });
    }
  }

  // agent-sweep is the AI agent's cron tick (Vercel Cron, every minute) —
  // same trust model as sweep-expired-deals above, so it reuses the same
  // CRON_SECRET rather than introducing a second cron secret for what is,
  // from an auth standpoint, an identical "trusted scheduler" situation.
  const isAgentSweepRequest =
    (req.method === 'GET' && req.query?.action === 'agent-sweep') ||
    (req.method === 'POST' && req.body?.action === 'agent-sweep');

  if (isAgentSweepRequest) {
    const authHeader = req.headers['authorization'] || '';
    const providedSecret = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : (req.body?.cronSecret || req.query?.cronSecret || '');
    const expectedSecret = process.env.CRON_SECRET || '';
    if (!expectedSecret || providedSecret !== expectedSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
      return await handleAgentSweep(req, res);
    } catch (err) {
      console.error('[deal.js] agent-sweep', err.message);
      return res.status(500).json({ error: err.message || 'Internal error' });
    }
  }

  // agent-limits is a public, read-only plan/usage lookup (shown on the
  // agent settings panel) — no idToken required, same exemption pattern as
  // get-seller-stats below.
  if (req.method === 'GET' && req.query?.action === 'agent-limits') {
    try {
      return await handleAgentLimits(req, res);
    } catch (err) {
      console.error('[deal.js] agent-limits', err.message);
      return res.status(500).json({ error: err.message || 'Internal error' });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action, idToken } = req.body || {};

  // get-seller-stats is a public, read-only aggregate (shown on any seller's
  // public profile modal to any visitor, signed in or not) — it doesn't
  // touch or expose anything auth-gated, so it's exempt from the idToken
  // requirement that guards every other action below.
  if (action === 'get-seller-stats') {
    try {
      return await handleGetSellerStats(req, res);
    } catch (err) {
      console.error('[deal.js] get-seller-stats', err.message);
      return res.status(500).json({ error: err.message || 'Internal error' });
    }
  }

  // record-profile-view is a public, write-only counter bump — fired by the
  // frontend every time any visitor (signed in or not) opens a seller's
  // public profile. Same exemption pattern as get-seller-stats above: it
  // doesn't read or expose anything auth-gated, it just increments a field
  // on the seller's own user doc, so no idToken is required to fire it.
  if (action === 'record-profile-view') {
    try {
      return await handleRecordProfileView(req, res);
    } catch (err) {
      console.error('[deal.js] record-profile-view', err.message);
      return res.status(500).json({ error: err.message || 'Internal error' });
    }
  }

  // admin-resolve-dispute is an ADMIN-ONLY action, authenticated via the
  // admin_session cookie (verifyAdminSession) rather than a user idToken —
  // it must be exempted from the idToken requirement below, same pattern as
  // get-seller-stats/record-profile-view, but its own handler does its own
  // (stricter) auth check immediately, so this is not actually public.
  if (action === 'admin-resolve-dispute') {
    try {
      return await handleAdminResolveDispute(req, res);
    } catch (err) {
      console.error('[deal.js] admin-resolve-dispute', err.message);
      return res.status(500).json({ error: err.message || 'Internal error' });
    }
  }

  if (!idToken) return res.status(401).json({ error: 'Missing auth token' });

  try {
    switch (action) {
      // ── Deal lifecycle ───────────────────────────────────────────────────
      case 'create-deal':    return await handleCreateDeal(req, res, idToken);
      case 'accept-deal':    return await handleAcceptDeal(req, res, idToken);
      case 'reject-deal':    return await handleRejectDeal(req, res, idToken);
      case 'cancel-deal':    return await handleCancelDeal(req, res, idToken);

      // ── Escrow lifecycle ─────────────────────────────────────────────────
      case 'escrow-pay':     return await handleEscrowPay(req, res, idToken);
      case 'escrow-deliver': return await handleEscrowDeliver(req, res, idToken);
      case 'escrow-release': return await handleEscrowRelease(req, res, idToken);
      case 'escrow-refund':  return await handleEscrowRefund(req, res, idToken);
      case 'escrow-dispute': return await handleEscrowDispute(req, res, idToken);

      // ── Deliverable access ───────────────────────────────────────────────
      case 'escrow-get-download-url': return await handleEscrowGetDownloadUrl(req, res, idToken);

      // ── GitHub repo sharing (manual, seller-triggered) ───────────────────
      case 'invite-github-collaborator':  return await handleInviteGithubCollaborator(req, res, idToken);
      case 'github-collaborator-status':  return await handleGithubCollaboratorStatus(req, res, idToken);

      // ── Client-safe lazy expiry check ────────────────────────────────────
      // Any participant can ask the server to check-and-resolve their own
      // deal room if its deadline has passed. This is a fallback so deals
      // resolve correctly even before/without a cron job configured — the
      // client calls this once whenever a deal chat is opened.
      case 'check-deal-expiry': return await handleCheckDealExpiry(req, res, idToken);

      // ── Seller Dashboard ─────────────────────────────────────────────────
      case 'list-my-deals': return await handleListMyDeals(req, res, idToken);

      // ── AI agent key management ──────────────────────────────────────────
      case 'agent-check-key-limit': return await handleAgentCheckKeyLimit(req, res, idToken);
      case 'agent-create-key':      return await handleAgentCreateKey(req, res, idToken);

      default:
        return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (err) {
    console.error('[deal.js]', action, err.message);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// get-seller-stats  { sellerUid }  — no idToken required (public read)
//
// Powers the "Deals" section of the public seller profile modal: lifetime
// completed deals + revenue, last-7-days revenue, and a breakdown of
// completed deals by listing category (website / app / game). Deliberately
// aggregates server-side rather than letting the client read another user's
// users/{uid}/deals or users/{uid}/transactions subcollections directly —
// those are private (transactions in particular carry counterparty uids,
// platform fee math, etc.) and are not meant to be world-readable.
//
// Only 'complete' deals count toward these stats — pending/accepted/
// rejected/cancelled/refunded/disputed deals are excluded since no money
// actually changed hands (or, for disputed, it's not yet resolved).
//
// → {
//     ok: true,
//     lifetimeDeals: number,
//     lifetimeRevenue: number,       // sum of seller's net proceeds (post platform-fee)
//     last7DaysRevenue: number,      // same, restricted to deals completed in the last 7 days
//     byCategory: { website: number, app: number, game: number },  // completed deal counts
//   }
// ─────────────────────────────────────────────────────────────────────────────
async function handleGetSellerStats(req, res) {
  const sellerUid = req.body?.sellerUid;
  if (!sellerUid || typeof sellerUid !== 'string') {
    return res.status(400).json({ error: 'Missing sellerUid' });
  }

  const db = getAdminDb();
  const dealsSnap = await db.collection('users').doc(sellerUid).collection('deals')
    .where('status', '==', 'complete')
    .get();

  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();

  let lifetimeDeals = 0;
  let lifetimeRevenue = 0;
  let last7DaysRevenue = 0;
  const byCategory = { website: 0, app: 0, game: 0 };

  dealsSnap.forEach(d => {
    const deal = d.data();
    lifetimeDeals += 1;

    const type = ['website', 'app', 'game'].includes(deal.listingType) ? deal.listingType : 'website';
    byCategory[type] += 1;

    // Prefer the actual net amount credited to the seller (escrowAmount minus
    // platform fee) when available; fall back to listingPrice/offerPrice so
    // older deal docs (written before this field existed) still count
    // toward lifetime totals, just without 7-day precision if undated.
    const amount = typeof deal.sellerNetAmount === 'number' ? deal.sellerNetAmount
      : typeof deal.escrowAmount === 'number' ? deal.escrowAmount
      : typeof deal.listingPrice === 'number' ? deal.listingPrice
      : typeof deal.offerPrice === 'number' ? deal.offerPrice
      : 0;
    lifetimeRevenue += amount;

    const completedAtMs = deal.completedAt?.toMillis ? deal.completedAt.toMillis()
      : deal.createdAt?.toMillis ? deal.createdAt.toMillis()
      : null;
    if (completedAtMs && (now - completedAtMs) <= SEVEN_DAYS_MS) {
      last7DaysRevenue += amount;
    }
  });

  return res.status(200).json({
    ok: true,
    lifetimeDeals,
    lifetimeRevenue: parseFloat(lifetimeRevenue.toFixed(2)),
    last7DaysRevenue: parseFloat(last7DaysRevenue.toFixed(2)),
    byCategory,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// list-my-deals  { idToken, range?, limit? }  → { ok: true, deals, revenue, dealsCompleted }
//
// Powers the Seller Dashboard's Recent Deals table + Revenue chart. Unlike
// get-seller-stats (public aggregate for any seller's profile modal), this
// is the CALLER'S OWN deals — auth required, not a public read — and it
// returns individual deal records (not just totals), since the dashboard
// needs a real per-deal list to render as table rows and a day-by-day
// series, not just a lifetime/7-day sum.
//
// `range` mirrors the dashboard's filter bar: 'today' | 'yesterday' |
// 'this-week' | 'this-month' | 'last-90' | 'lifetime'. Filtering happens
// server-side against createdAt so the client never has to fetch-then-trim.
// Defaults to 'last-90' if omitted/unrecognised.
//
// Every status is returned (not just 'complete') — the dashboard table
// shows pending/active/cancelled deals too, same statuses the deal chat UI
// itself uses. Revenue/dealsCompleted totals, however, only count 'complete'
// deals with dealOutcome:'successful', same rule as get-seller-stats, so the
// two surfaces never disagree about what counts as "revenue."
// ─────────────────────────────────────────────────────────────────────────────
const DEAL_LIST_RANGE_DAYS = {
  today: 1, yesterday: 2, 'this-week': 7, 'this-month': 31, 'last-90': 90, lifetime: null,
};
const DEAL_LIST_MAX = 200;

async function handleListMyDeals(req, res, idToken) {
  const fbUser = await verifyFirebaseToken(idToken);
  const uid = fbUser.localId;

  const { range, limit } = req.body || {};
  const days = Object.prototype.hasOwnProperty.call(DEAL_LIST_RANGE_DAYS, range)
    ? DEAL_LIST_RANGE_DAYS[range]
    : DEAL_LIST_RANGE_DAYS['last-90'];
  const size = Math.min(DEAL_LIST_MAX, Math.max(1, Number(limit) || DEAL_LIST_MAX));

  const db = getAdminDb();
  let query = db.collection('users').doc(uid).collection('deals')
    .orderBy('createdAt', 'desc')
    .limit(size);

  if (days != null) {
    const cutoff = Timestamp.fromMillis(Date.now() - days * 24 * 60 * 60 * 1000);
    query = db.collection('users').doc(uid).collection('deals')
      .where('createdAt', '>=', cutoff)
      .orderBy('createdAt', 'desc')
      .limit(size);
  }

  const snap = await query.get();

  let revenue = 0;
  let dealsCompleted = 0;

  const deals = snap.docs.map(d => {
    const deal = d.data();
    const isSuccessfulComplete = deal.status === 'complete' && deal.dealOutcome === 'successful';

    // Same amount-resolution order as get-seller-stats: prefer the actual
    // net proceeds credited to the seller, fall back through the earlier
    // fields for deals completed before sellerNetAmount existed.
    const amount = typeof deal.sellerNetAmount === 'number' ? deal.sellerNetAmount
      : typeof deal.escrowAmount === 'number' ? deal.escrowAmount
      : typeof deal.listingPrice === 'number' ? deal.listingPrice
      : typeof deal.offerPrice === 'number' ? deal.offerPrice
      : 0;

    if (isSuccessfulComplete) {
      revenue += amount;
      dealsCompleted += 1;
    }

    const createdAtMs = deal.createdAt?.toMillis ? deal.createdAt.toMillis() : null;
    const completedAtMs = deal.completedAt?.toMillis ? deal.completedAt.toMillis() : null;

    return {
      dealId:       deal.dealId || d.id,
      listingId:    deal.listingId || null,
      listingTitle: deal.listingTitle || 'Untitled',
      listingType:  deal.listingType || 'website',
      buyerName:    deal.buyerName || 'Buyer',
      buyerUid:     deal.buyerUid || null,
      amount,
      status:       deal.status || 'pending',
      dealOutcome:  deal.dealOutcome || null,
      createdAt:    createdAtMs,
      completedAt:  completedAtMs,
    };
  });

  return res.status(200).json({
    ok: true,
    deals,
    revenue: parseFloat(revenue.toFixed(2)),
    dealsCompleted,
  });
}


// Public, write-only counter bump on users/{sellerUid}.profileViewCount.
// Fired by the frontend every time a seller's public profile is opened —
// including by the seller viewing their own profile, since "how many times
// was this profile opened" is the honest metric; sellers aren't excluded
// from their own count any more than a listing owner is excluded from a
// listing's own view count elsewhere in the app.
//
// Uses FieldValue.increment(), same atomic-op pattern as listings.js's
// view/click counters — no read-modify-write race under concurrent visits.
//
// Abuse note: same tradeoff as listings.js's view/click counters — this is
// an unauthenticated-by-design analytics pixel (anonymous profile visits
// are real traffic sellers want counted), so it can't be fully bot/refresh-
// proofed at the API layer. We guard the cheap stuff (missing/garbage
// sellerUid, nonexistent user, tight-loop duplicate fires from the same
// caller) via a short in-memory debounce; real bot filtering belongs in
// front of this route (e.g. edge/WAF rate limiting), not here.
// ─────────────────────────────────────────────────────────────────────────────
const PROFILE_VIEW_DEBOUNCE_MS = 4000;
const _recentProfileViews = new Map(); // key: `${sellerUid}:${viewerKey}` -> timestamp
function _pruneRecentProfileViews() {
  const cutoff = Date.now() - PROFILE_VIEW_DEBOUNCE_MS * 5;
  for (const [key, ts] of _recentProfileViews) {
    if (ts < cutoff) _recentProfileViews.delete(key);
  }
}

async function handleRecordProfileView(req, res) {
  const { sellerUid, idToken } = req.body || {};
  if (!sellerUid || typeof sellerUid !== 'string') {
    return res.status(400).json({ error: 'Missing sellerUid' });
  }

  // Verify the token only if one was sent — same pattern as get-seller-stats'
  // sibling public endpoints elsewhere in the app (listings.js handleFeed/
  // handleFileUrl): a stale/bad token from a logged-out browser must never
  // hard-fail an otherwise valid anonymous hit.
  let viewerUid = null;
  if (idToken) {
    try {
      const fbUser = await verifyFirebaseToken(idToken);
      viewerUid = fbUser.localId;
    } catch (_) {
      // treat as anonymous
    }
  }

  const viewerKey = viewerUid || 'anon';
  const dedupeKey = `${sellerUid}:${viewerKey}`;
  const now = Date.now();
  const lastView = _recentProfileViews.get(dedupeKey);
  if (lastView && (now - lastView) < PROFILE_VIEW_DEBOUNCE_MS) {
    return res.status(200).json({ ok: true, counted: false });
  }
  _recentProfileViews.set(dedupeKey, now);
  if (_recentProfileViews.size > 5000) _pruneRecentProfileViews();

  const db = getAdminDb();
  const sellerRef = db.collection('users').doc(sellerUid);
  const sellerSnap = await sellerRef.get();
  if (!sellerSnap.exists) return res.status(404).json({ error: 'Seller not found' });

  await sellerRef.update({ profileViewCount: FieldValue.increment(1) });

  return res.status(200).json({ ok: true, counted: true });
}

// ═════════════════════════════════════════════════════════════════════════════
// DEAL LIFECYCLE
// ═════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// create-deal  { idToken, listingId, message, offerPrice? }
// → { allowed: true, dealId } | 409 if a pending deal already exists
//
// Server is the source of truth for: listing data (price/title/owner/image —
// never trusted from the client), the generated dealId, and duplicate
// prevention. Writes both the seller's and buyer's deal docs atomically.
// ─────────────────────────────────────────────────────────────────────────────
async function _handleCreateDealCore(req, res, idToken) {
  const fbUser = await verifyFirebaseToken(idToken);
  const buyerUid = fbUser.localId;

  const { listingId, message, offerPrice } = req.body || {};
  if (!listingId || typeof listingId !== 'string') {
    return res.status(400).json({ error: 'Missing listingId' });
  }

  const msg = typeof message === 'string' ? message.trim() : '';
  if (msg.length < DEAL_MSG_MIN_LENGTH) {
    return res.status(400).json({
      error: `Message must be at least ${DEAL_MSG_MIN_LENGTH} characters.`,
    });
  }

  let offer = null;
  if (offerPrice != null) {
    const n = Number(offerPrice);
    if (!Number.isFinite(n) || n <= 0) {
      return res.status(400).json({ error: 'Invalid offer price' });
    }
    offer = n;
  }

  const db = getAdminDb();

  // Fetch listing server-side — client cannot supply or spoof these fields
  const listingSnap = await db.collection('listings').doc(listingId).get();
  if (!listingSnap.exists) return res.status(404).json({ error: 'Listing not found' });
  const listing   = listingSnap.data();
  const sellerUid = listing.ownerId;
  if (!sellerUid) return res.status(400).json({ error: 'Listing has no owner' });
  if (sellerUid === buyerUid) {
    return res.status(400).json({ error: "You can't send a deal on your own listing" });
  }

  // Buyer profile for display fields on the deal doc
  const buyerSnap = await db.collection('users').doc(buyerUid).get();
  const buyerData = buyerSnap.exists ? buyerSnap.data() : {};
  const buyerName = buyerData.username
    || fbUser.displayName
    || (fbUser.email ? fbUser.email.split('@')[0] : 'Buyer');
  const buyerPic  = buyerData.profilePic || '';
  const buyerEmail = fbUser.email || buyerData.email || '';

  // Seller email for the "you got a deal request" notification email
  const sellerSnapForEmail = await db.collection('users').doc(sellerUid).get();
  const sellerEmail = sellerSnapForEmail.exists ? (sellerSnapForEmail.data().email || '') : '';

  const typeWord = listing.type === 'app' ? 'app' : listing.type === 'game' ? 'game' : 'website';
  const introMsg = `Hi! I'm interested in this ${typeWord} — is it still available?`;
  const dealId   = `${buyerUid}_${listingId}_${Date.now()}`;

  const sellerDealsRef = db.collection('users').doc(sellerUid).collection('deals');
  const sellerDealRef  = sellerDealsRef.doc(dealId);
  const buyerDealRef   = db.collection('users').doc(buyerUid).collection('deals').doc(dealId);

  try {
    await db.runTransaction(async tx => {
      // Duplicate-prevention: block a second pending deal from this buyer
      // on this listing. Read happens inside the transaction so two
      // concurrent submits can't both pass the check.
      const dupeSnap = await tx.get(
        sellerDealsRef
          .where('buyerUid',   '==', buyerUid)
          .where('listingId',  '==', listingId)
          .where('status',     '==', 'pending')
      );
      if (!dupeSnap.empty) {
        throw Object.assign(
          new Error('You already have a pending deal on this listing.'),
          { code: 'DUPLICATE_DEAL' }
        );
      }

      const dealData = {
        dealId,
        listingId,
        listingTitle: listing.title || 'Untitled',
        listingType:  listing.type  || 'website',
        listingPrice: typeof listing.financials?.price === 'number' ? listing.financials.price : null,
        offerPrice:   offer,
        listingImage: listing.images?.[2] || listing.imageCover || listing.images?.[0] || '',
        listingUrl:   listing.url || '',
        buyerUid,
        buyerName,
        buyerPic,
        sellerUid,
        introMessage: introMsg,
        message:      msg,
        status:       'pending',
        createdAt:    FieldValue.serverTimestamp(),
        read:         false,
        agentHandled: false,
      };

      tx.set(sellerDealRef, dealData);
      tx.set(buyerDealRef,  { ...dealData, read: true });
    });
  } catch (err) {
    if (err.code === 'DUPLICATE_DEAL') {
      return res.status(409).json({ error: err.message });
    }
    throw err;
  }

  // Notifications + agent ping after transaction commits — best-effort,
  // never block the deal itself on these.
  //
  // Seller-facing "deals received" counter — bumped here (not inside the
  // transaction above) because it's an analytics tally, not part of the
  // deal's own consistency: same fire-and-forget philosophy as the
  // notifications/email below it. Uses FieldValue.increment(), atomic
  // under concurrent deal submissions.
  db.collection('users').doc(sellerUid).update({ dealCount: FieldValue.increment(1) })
    .catch(e => console.error('[deal] dealCount increment failed (non-fatal)', e.message));

  const notifyBatch = db.batch();
  notifyBatch.set(
    db.collection('users').doc(buyerUid).collection('notifications').doc(),
    {
      type:  'deal_sent',
      title: 'Deal sent',
      body:  `You sent a deal request for "${listing.title || 'this listing'}"` +
             (offer ? ` with an offer of $${offer.toLocaleString()}` : ''),
      dealId, listingId, toUid: sellerUid, read: false, createdAt: Date.now(),
    }
  );
  notifyBatch.set(
    db.collection('users').doc(sellerUid).collection('notifications').doc(),
    {
      type:     'deal_request',
      title:    buyerName,
      body:     `Sent a deal request for "${listing.title || 'your listing'}"` +
                (offer ? ` — offering $${offer.toLocaleString()}` : ''),
      dealId, listingId, fromUid: buyerUid, fromName: buyerName, fromPic: buyerPic,
      offerPrice: offer, read: false, createdAt: Date.now(),
    }
  );
  await notifyBatch.commit().catch(e => console.error('[deal] notify error', e));

  // Notifications — deal request is a "big" moment for both sides: buyer gets a
  // confirmation, seller gets alerted they have money on the table. Both
  // email and push are sent so a missed/undelivered email doesn't mean the
  // notification never reaches the person.
  const priceLine = offer ? `an offer of <strong>$${offer.toLocaleString()}</strong>` : 'a deal request';
  const priceLinePlain = offer ? `an offer of $${offer.toLocaleString()}` : 'a deal request';
  notifyDeal({
    uid: buyerUid,
    to: buyerEmail,
    accentKey: 'info',
    eyebrow: 'Deal sent',
    heading: 'Your deal request is on its way',
    bodyHtml: `You sent ${priceLine} for <strong>${listing.title || 'this listing'}</strong>. We'll email you as soon as the seller responds.`,
    pushBody: `You sent ${priceLinePlain} for "${listing.title || 'this listing'}".`,
    ctaLabel: 'View deal',
    chatRoomId: null,
  }).catch(() => {});
  notifyDeal({
    uid: sellerUid,
    to: sellerEmail,
    accentKey: 'success',
    eyebrow: 'New deal request',
    heading: `${buyerName} wants your listing`,
    bodyHtml: `You received ${priceLine} for <strong>${listing.title || 'your listing'}</strong>. Accept it to open a deal chat and get paid through escrow.`,
    pushBody: `${buyerName} sent ${priceLinePlain} for "${listing.title || 'your listing'}".`,
    ctaLabel: 'Review request',
    chatRoomId: null,
  }).catch(() => {});

  // ── Built-in auto-accept check (synchronous, no AI Studio involved) ──
  // This is separate from the AI Studio "agent" system elsewhere in this
  // file (auto-reply/price-drop/auto-relist, which require a linked API
  // key + plan and run async via cron/fire-and-forget). This is a plain
  // on/off switch a seller sets on their own user doc:
  //   agentConfig.active               — master on/off (missing/false = off)
  //   agentConfig.autoAccept.enabled   — whether offers can be auto-accepted
  //   agentConfig.autoAccept.minPercent — minimum offer, as a % of the
  //                                       listing's price, to accept (e.g.
  //                                       80 = must offer >= 80% of listed
  //                                       price). A percentage rather than a
  //                                       flat dollar amount because one
  //                                       seller's listings can range from a
  //                                       $200 site to a $50k app — a single
  //                                       fixed minPrice would either block
  //                                       everything on the cheap listing or
  //                                       accept lowball offers on the
  //                                       expensive one.
  // When on:
  //   • A full-price request (no offer) is always auto-accepted.
  //   • An offer >= minPercent% of the listing price is auto-accepted.
  //   • An offer below that, or autoAccept not enabled at all, is left
  //     pending for the seller to review manually — never silently
  //     downgraded to the listed price.
  let dealOutcome = { status: 'pending' };
  try {
    dealOutcome = await runBuiltInAutoAccept({
      db, sellerUid, dealId, offer,
      listingPrice: typeof listing.financials?.price === 'number' ? listing.financials.price : null,
    });
  } catch (err) {
    console.error('[deal.js] auto-accept check failed for new deal', dealId, err.message);
  }

  return res.status(200).json({ allowed: true, dealId, ...dealOutcome });
}

// Synchronous built-in auto-accept — runs inline during create-deal so the
// buyer's response can say "you're in the chat now" instead of always
// landing on pending and finding out later. Uses the same settleDealCore
// transaction as a manual seller accept, so chat-room creation, the agreed
// price carried into escrow, notifications, and race-safety are identical.
async function runBuiltInAutoAccept({ db, sellerUid, dealId, offer, listingPrice }) {
  const sellerSnap = await db.collection('users').doc(sellerUid).get();
  const agentConfig = sellerSnap.exists ? sellerSnap.data().agentConfig : null;

  if (!agentConfig?.active) {
    return { status: 'pending' };
  }

  const autoAccept = agentConfig.autoAccept;
  const isFullPriceRequest = offer == null;

  // Percentage-based threshold: minPercent of the listing's own price, not
  // a flat dollar figure, so one seller's config works across listings of
  // very different prices. If the listing has no known price, there's
  // nothing to compute a percentage of — treat as not meeting the
  // threshold rather than guessing.
  let meetsMinPercent = false;
  if (autoAccept?.enabled && offer != null && typeof listingPrice === 'number' && listingPrice > 0) {
    const minPercent = autoAccept.minPercent ?? 100;
    const minAmount = listingPrice * (minPercent / 100);
    meetsMinPercent = offer >= minAmount;
  }

  if (!isFullPriceRequest && !meetsMinPercent) {
    // Agent is on, but either offers aren't configured to auto-accept at
    // all, or this particular offer is below the seller's minimum percent
    // of the listing price — leave it as a normal pending deal for manual
    // review.
    return { status: 'pending' };
  }

  try {
    const result = await settleDealCore({ callerUid: sellerUid, dealId, action: 'accept' });
    return { status: 'accepted', chatRoomId: result.chatRoomId, expiresAt: result.expiresAt };
  } catch (err) {
    // Should be unreachable (deal was just created as pending, nothing
    // else could have settled it yet), but never let an auto-accept race
    // surface as a failure to the buyer — they still have a valid pending
    // deal to fall back on.
    console.error('[deal.js] settleDealCore failed during auto-accept', dealId, err.message);
    return { status: 'pending' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// handleCreateDeal — thin wrapper around _handleCreateDealCore that tracks
// the Send Deal CTA outcome onto the listing's own counters:
//   successfulClickCount — the deal was actually created (core returned 200)
//   failedClickCount     — Send Deal was clicked but it did NOT go through
//                          (validation error, duplicate deal, unexpected
//                          throw, etc.)
//
// The earliest failure (missing/invalid listingId) can't be attributed to
// any specific listing's failedClickCount, since we don't yet know which
// listing was involved — that one exit is not counted. Every other exit
// point, success or failure, happens after `listingId` has been read from
// the request body, so we always have something to increment against once
// we get past that first check.
//
// We capture the core's response status via a lightweight `res` proxy
// rather than touching every `return res.status(...)` line inside the core
// — Express's `res.status(code)` returns `res` itself, so a later
// `.json()` call chains onto the real, un-proxied `res` object; only the
// `status` call itself is intercepted, purely to record what code was sent.
// ─────────────────────────────────────────────────────────────────────────────
async function _trackCreateDealClick(listingId, succeeded) {
  if (!listingId || typeof listingId !== 'string') return; // can't attribute — no listing known yet
  try {
    const db = getAdminDb();
    const field = succeeded ? 'successfulClickCount' : 'failedClickCount';
    // Same field, incremented in two places: the specific listing (per-item
    // stats) and stats/platformTotals (running platform-wide total — see
    // listings.js's _bumpListingCounter for the matching impression/view
    // side of this same doc). Fired together, not chained, so a slow/failed
    // write to one never blocks or masks the other.
    await Promise.all([
      db.collection('listings').doc(listingId).update({ [field]: FieldValue.increment(1) }),
      db.collection('stats').doc('platformTotals').set({ [field]: FieldValue.increment(1) }, { merge: true }),
    ]);
  } catch (err) {
    // Never let analytics bookkeeping break or mask the real deal outcome.
    console.error('[deal.js] _trackCreateDealClick failed (non-fatal)', listingId, succeeded, err.message);
  }
}

async function handleCreateDeal(req, res, idToken) {
  const listingId = req.body?.listingId;
  let capturedStatus = null;

  const resProxy = new Proxy(res, {
    get(target, prop, receiver) {
      if (prop === 'status') {
        return (code) => {
          capturedStatus = code;
          return target.status(code); // returns the real res — chaining (.json()) is untouched
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });

  try {
    const result = await _handleCreateDealCore(req, resProxy, idToken);
    _trackCreateDealClick(listingId, capturedStatus === 200).catch(() => {});
    return result;
  } catch (err) {
    // Core threw before ever calling res.status() (e.g. verifyFirebaseToken
    // failure, or an unexpected error deep in the transaction) — still a
    // failed click if we know which listing it was for.
    _trackCreateDealClick(listingId, false).catch(() => {});
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// accept-deal  { idToken, dealId }
// reject-deal  { idToken, dealId }
// cancel-deal  { idToken, dealId }
//
// All three are thin wrappers around settleDealHttp() -> settleDealCore()
// Firestore transaction. The transaction re-reads both deal docs inside itself
// to close any race with concurrent agent actions.
// ─────────────────────────────────────────────────────────────────────────────
async function handleAcceptDeal(req, res, idToken) {
  return settleDealHttp(req, res, idToken, 'accept');
}

async function handleRejectDeal(req, res, idToken) {
  return settleDealHttp(req, res, idToken, 'reject');
}

async function handleCancelDeal(req, res, idToken) {
  return settleDealHttp(req, res, idToken, 'cancel');
}

// Thin HTTP wrapper: resolves callerUid from a real Firebase idToken, then
// delegates to the shared core. Every manual (buyer/seller-initiated)
// accept/reject/cancel goes through here.
async function settleDealHttp(req, res, idToken, action) {
  const fbUser    = await verifyFirebaseToken(idToken);
  const callerUid = fbUser.localId;

  const { dealId } = req.body || {};
  if (!dealId || typeof dealId !== 'string') {
    return res.status(400).json({ error: 'Missing dealId' });
  }

  try {
    const result = await settleDealCore({ callerUid, dealId, action });
    if (action === 'accept') {
      return res.status(200).json({ allowed: true, chatRoomId: result.chatRoomId, expiresAt: result.expiresAt });
    }
    return res.status(200).json({ allowed: true });
  } catch (err) {
    if (err.code === 'NOT_FOUND')       return res.status(404).json({ error: err.message });
    if (err.code === 'FORBIDDEN')       return res.status(403).json({ error: err.message });
    if (err.code === 'ALREADY_SETTLED') return res.status(409).json({ error: err.message, status: err.status });
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// settleDealCore — the ONE real accept/reject/cancel implementation.
// Auth-agnostic: takes an already-resolved callerUid rather than an idToken,
// so it can be driven either by a verified end-user token (settleDealHttp
// above) or by the seller's AI agent acting on the seller's own behalf
// (called directly by the agent module below). Same transaction, same
// race-safe re-read, same chat-room creation, same notifications/emails —
// there is exactly one accept/reject/cancel code path in the whole app.
//
// Returns a plain result object (never writes to res) so callers — HTTP or
// internal — can each shape their own response.
// Throws Error with .code set to 'NOT_FOUND' | 'FORBIDDEN' | 'ALREADY_SETTLED'
// on the expected failure paths; callers translate .code to HTTP status
// (or, for the agent, to a skip/log reason) as appropriate.
// ─────────────────────────────────────────────────────────────────────────────
async function settleDealCore({ callerUid, dealId, action }) {
  const db = getAdminDb();
  const callerCopyRef = db.collection('users').doc(callerUid).collection('deals').doc(dealId);

  const result = await db.runTransaction(async tx => {
    const callerSnap = await tx.get(callerCopyRef);
    if (!callerSnap.exists) {
      throw Object.assign(new Error('Deal not found'), { code: 'NOT_FOUND' });
    }

    const deal      = callerSnap.data();
    const { sellerUid, buyerUid } = deal;
    const isSeller  = callerUid === sellerUid;
    const isBuyer   = callerUid === buyerUid;

    if (action === 'accept' || action === 'reject') {
      if (!isSeller) {
        throw Object.assign(new Error('Only the seller can do this'), { code: 'FORBIDDEN' });
      }
    } else if (action === 'cancel') {
      if (!isBuyer) {
        throw Object.assign(new Error('Only the buyer can cancel'), { code: 'FORBIDDEN' });
      }
    }

    const sellerRef = db.collection('users').doc(sellerUid).collection('deals').doc(dealId);
    const buyerRef  = db.collection('users').doc(buyerUid).collection('deals').doc(dealId);

    // Re-read BOTH copies inside the transaction — this is the race-condition
    // fix. An agent auto-accept, a manual accept/reject, and a buyer cancel
    // can all be in flight at once, but only the first commit wins.
    const [sellerSnap, buyerSnap] = await Promise.all([
      tx.get(sellerRef),
      tx.get(buyerRef),
    ]);
    const sellerStatus = sellerSnap.exists ? sellerSnap.data().status : null;
    const buyerStatus  = buyerSnap.exists  ? buyerSnap.data().status  : null;

    if (sellerStatus !== 'pending' || buyerStatus !== 'pending') {
      throw Object.assign(
        new Error(`Deal already ${sellerStatus || buyerStatus || 'resolved'}`),
        { code: 'ALREADY_SETTLED', status: sellerStatus || buyerStatus }
      );
    }

    if (action === 'accept') {
      const chatRoomId = 'deal_' + dealId;
      const expiresAt  = Date.now() + dealExpiryMsForType(deal.listingType);
      tx.update(sellerRef, { status: 'accepted', read: true, chatRoomId, expiresAt });
      tx.update(buyerRef,  { status: 'accepted', chatRoomId, expiresAt });
      return { chatRoomId, expiresAt, deal, sellerUid, buyerUid };
    }

    if (action === 'reject') {
      tx.update(sellerRef, { status: 'rejected', read: true });
      tx.update(buyerRef,  { status: 'rejected' });
      return { deal, sellerUid, buyerUid };
    }

    // cancel — remove buyer copy, mark seller copy so they can see it was cancelled
    tx.delete(buyerRef);
    tx.update(sellerRef, { status: 'cancelled', cancelledByBuyer: true });
    return { deal, sellerUid, buyerUid };
  });

  // Post-transaction side effects (non-critical — deal status is already durable)
  if (action === 'accept') {
    await createDealChatRoom(db, {
      dealId,
      deal:      result.deal,
      sellerUid: result.sellerUid,
      buyerUid:  result.buyerUid,
      chatRoomId: result.chatRoomId,
      expiresAt:  result.expiresAt,
    });
    if (result.buyerUid !== result.sellerUid) {
      await db.collection('users').doc(result.buyerUid).collection('notifications').add({
        type:      'deal_accepted',
        title:     'Deal accepted',
        body:      `Your deal for "${result.deal.listingTitle || 'this listing'}" was accepted`,
        dealId,
        chatRoomId: result.chatRoomId,
        sellerUid:  result.sellerUid,
        buyerUid:   result.buyerUid,
        expiresAt:  result.expiresAt,
        read:       false,
        createdAt:  Date.now(),
      }).catch(() => {});

      const buyerSnapForEmail = await db.collection('users').doc(result.buyerUid).get();
      const buyerEmailForNotif = buyerSnapForEmail.exists ? (buyerSnapForEmail.data().email || '') : '';
      notifyDeal({
        uid: result.buyerUid,
        to: buyerEmailForNotif,
        accentKey: 'success',
        eyebrow: 'Deal accepted',
        heading: 'Your deal was accepted! 🎉',
        bodyHtml: `The seller accepted your deal for <strong>${result.deal.listingTitle || 'this listing'}</strong>. Head to the deal chat to arrange payment into escrow.`,
        pushBody: `The seller accepted your deal for "${result.deal.listingTitle || 'this listing'}".`,
        ctaLabel: 'Open deal chat',
        chatRoomId: result.chatRoomId,
      }).catch(() => {});
    }

    // Outbound webhook — fired to the SELLER's own registered endpoints
    // (they're the one who took the accept action and cares about it
    // downstream). Fire-and-forget, same non-blocking pattern as the
    // notifications above — a webhook delivery issue must never affect the
    // deal's own success response.
    dispatchWebhook(result.sellerUid, 'deal.accepted', {
      dealId,
      listingId:    result.deal.listingId,
      listingTitle: result.deal.listingTitle,
      chatRoomId:   result.chatRoomId,
      buyerUid:     result.buyerUid,
      sellerUid:    result.sellerUid,
      offerPrice:   result.deal.offerPrice,
    }).catch(() => {});

    return { chatRoomId: result.chatRoomId, expiresAt: result.expiresAt, deal: result.deal };
  }

  if (action === 'reject') {
    if (result.buyerUid !== result.sellerUid) {
      await db.collection('users').doc(result.buyerUid).collection('notifications').add({
        type:      'deal_rejected',
        title:     'Deal rejected',
        body:      `Your deal for "${result.deal.listingTitle || 'this listing'}" was declined`,
        dealId,
        read:      false,
        createdAt: Date.now(),
      }).catch(() => {});

      const buyerSnapForEmail = await db.collection('users').doc(result.buyerUid).get();
      const buyerEmailForNotif = buyerSnapForEmail.exists ? (buyerSnapForEmail.data().email || '') : '';
      notifyDeal({
        uid: result.buyerUid,
        to: buyerEmailForNotif,
        accentKey: 'danger',
        eyebrow: 'Deal declined',
        heading: 'Your deal was declined',
        bodyHtml: `The seller declined your deal for <strong>${result.deal.listingTitle || 'this listing'}</strong>. You can browse similar listings or send a new offer.`,
        pushBody: `The seller declined your deal for "${result.deal.listingTitle || 'this listing'}".`,
        ctaLabel: 'Browse listings',
        chatRoomId: null,
      }).catch(() => {});
    }
    dispatchWebhook(result.sellerUid, 'deal.rejected', {
      dealId,
      listingId:    result.deal.listingId,
      listingTitle: result.deal.listingTitle,
      buyerUid:     result.buyerUid,
      sellerUid:    result.sellerUid,
    }).catch(() => {});
    return { deal: result.deal };
  }

  // cancel
  dispatchWebhook(result.sellerUid, 'deal.cancelled', {
    dealId,
    listingId:    result.deal.listingId,
    listingTitle: result.deal.listingTitle,
    buyerUid:     result.buyerUid,
    sellerUid:    result.sellerUid,
  }).catch(() => {});
  return { deal: result.deal };
}

// ─────────────────────────────────────────────────────────────────────────────
// Note: there used to be a settleDealInternal() wrapper here for a separate
// agent.js file to import. Now that the AI agent lives in this same file
// (see "AI AGENT" section near the bottom), its code calls settleDealCore()
// above directly — same transaction, chat-room creation, and notification/
// email logic as a manual accept/reject, just without a cross-file import.
// ─────────────────────────────────────────────────────────────────────────────

// ── Shared helper: create the deal chat room + thread pointers on accept ─────
async function createDealChatRoom(db, { dealId, deal, sellerUid, buyerUid, chatRoomId, expiresAt }) {
  const sellerSnap = await db.collection('users').doc(sellerUid).get();
  const sellerData = sellerSnap.exists ? sellerSnap.data() : {};
  const sellerName = sellerData.username || sellerData.displayName || 'Seller';
  const sellerPic  = sellerData.profilePic || '';
  const buyerName  = deal.buyerName || 'Buyer';
  const buyerPic   = deal.buyerPic  || '';

  const now      = Date.now();
  const autoMsg  = `Your deal for "${deal.listingTitle || 'this listing'}" has been accepted! You have 7 days to resolve. Good luck! 🤝`;
  const chatName = (deal.listingTitle || 'Untitled').slice(0, 60);

  // The agreed price is the buyer's accepted offer, not the original listing
  // price — a deal for $100 that the seller accepted at a $50 offer must
  // carry $50 forward into escrow, not silently revert to the $100 asking
  // price. Fall back to listingPrice only when no offer was made (i.e. the
  // buyer accepted the listed price as-is).
  const agreedPrice = typeof deal.offerPrice === 'number' ? deal.offerPrice
    : (typeof deal.listingPrice === 'number' ? deal.listingPrice : null);

  const batch = db.batch();

  batch.set(db.collection('dealChats').doc(chatRoomId), {
    chatName, chatRoomId, dealId,
    listingId:    deal.listingId    || '',
    listingTitle: deal.listingTitle || '',
    listingImage: deal.listingImage || '',
    listingPrice: agreedPrice,
    sellerUid, sellerName, sellerPic,
    buyerUid,  buyerName,  buyerPic,
    createdAt: now, expiresAt, active: true,
    lastMessage: autoMsg, lastAt: now,
  });

  batch.set(
    db.collection('dealChats').doc(chatRoomId).collection('messages').doc('system_0'),
    { uid: 'system', text: autoMsg, type: 'system', createdAt: now }
  );

  const threadBase = {
    chatRoomId, chatName, isDealChat: true,
    listingTitle: deal.listingTitle || '',
    listingImage: deal.listingImage || '',
    lastMessage: autoMsg, lastAt: now, expiresAt,
    sellerUid, buyerUid,
  };

  batch.set(
    db.collection('users').doc(sellerUid).collection('threads').doc(chatRoomId),
    { ...threadBase, partnerUid: buyerUid, partnerName: buyerName, partnerPic: buyerPic, unread: false }
  );
  batch.set(
    db.collection('users').doc(buyerUid).collection('threads').doc(chatRoomId),
    { ...threadBase, partnerUid: sellerUid, partnerName: sellerName, partnerPic: sellerPic, unread: true, unreadCount: 1 }
  );

  await batch.commit();
}

// ═════════════════════════════════════════════════════════════════════════════
// ESCROW LIFECYCLE
// ═════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// escrow-pay  { idToken, chatRoomId, dealId, amount }
// Buyer pays wallet → escrow. Atomically:
//   • Debits buyer walletBalance
//   • Sets dealChats/{chatRoomId}.paymentStatus = 'funded'
//   • Writes escrow_hold transaction on buyer
//   • Mirrors paymentStatus on both users' deal docs
//   • Notifies seller
// ─────────────────────────────────────────────────────────────────────────────
async function handleEscrowPay(req, res, idToken) {
  const { chatRoomId, dealId, amount } = req.body;
  if (!chatRoomId) return res.status(400).json({ error: 'Missing chatRoomId' });
  if (!dealId)     return res.status(400).json({ error: 'Missing dealId' });

  const amt = parseFloat(amount);
  if (!amt || amt <= 0 || !isFinite(amt)) {
    return res.status(400).json({ error: 'Invalid amount' });
  }

  const fbUser   = await verifyFirebaseToken(idToken);
  const buyerUid = fbUser.localId;

  const db       = getAdminDb();
  const roomRef  = db.collection('dealChats').doc(chatRoomId);
  const buyerRef = db.collection('users').doc(buyerUid);

  await db.runTransaction(async tx => {
    const [roomSnap, buyerSnap] = await Promise.all([tx.get(roomRef), tx.get(buyerRef)]);

    if (!roomSnap.exists)  throw new Error('Deal chat not found');
    if (!buyerSnap.exists) throw new Error('User not found');

    const room = roomSnap.data();

    // Security checks
    if (room.buyerUid !== buyerUid)              throw new Error('You are not the buyer in this deal');
    if (room.paymentStatus === 'funded')          throw new Error('This deal is already funded');
    if (room.paymentStatus === 'complete')        throw new Error('This deal is already complete');
    if (room.paymentStatus === 'refunded')        throw new Error('This deal has been refunded');
    if (room.cancelled || room.active === false)  throw new Error('This deal has been cancelled');

    const sellerUid = room.sellerUid;
    if (!sellerUid) throw new Error('Seller not found on deal');

    const balance = parseFloat((buyerSnap.data().walletBalance || 0).toFixed(2));
    if (amt > balance) {
      throw new Error(`Insufficient wallet balance ($${balance.toFixed(2)} available)`);
    }

    const newBalance = parseFloat((balance - amt).toFixed(2));
    // Paying into escrow draws down withdrawable dollars first (capped at 0),
    // same conservative rule used for P2P sends in paypal.js's handleTransfer
    // — it never lets withdrawableBalance exceed money actually earned. If
    // the deal is later refunded, _refundEscrowForRoom restores this amount.
    const buyerWithdrawable    = parseFloat((buyerSnap.data().withdrawableBalance || 0).toFixed(2));
    const newBuyerWithdrawable = parseFloat(Math.max(0, buyerWithdrawable - amt).toFixed(2));

    // 1. Debit buyer wallet
    tx.update(buyerRef, { walletBalance: newBalance, withdrawableBalance: newBuyerWithdrawable });

    // 2. Escrow hold transaction record
    tx.set(buyerRef.collection('transactions').doc(), {
      type:       'escrow_hold',
      amount:     -amt,
      label:      `Escrow hold · ${room.listingTitle || 'Deal'}`,
      chatRoomId,
      dealId,
      sellerUid,
      status:     'held',
      createdAt:  FieldValue.serverTimestamp(),
    });

    // 3. Update room
    tx.update(roomRef, {
      paymentStatus:   'funded',
      escrowAmount:    amt,
      escrowAt:        FieldValue.serverTimestamp(),
      escrowBuyerUid:  buyerUid,
      // Exact amount drawn from withdrawableBalance (may be less than `amt`
      // if the buyer's withdrawable balance was already partly/fully 0) —
      // stored so a later refund restores precisely this much, not `amt`
      // blindly, which would over-credit withdrawableBalance beyond what
      // the buyer actually had.
      escrowWithdrawableDebit: parseFloat((buyerWithdrawable - newBuyerWithdrawable).toFixed(2)),
    });

    // 4 & 5. Mirror status on both deal docs
    tx.update(db.collection('users').doc(sellerUid).collection('deals').doc(dealId), {
      paymentStatus: 'funded', escrowAmount: amt,
    });
    tx.update(db.collection('users').doc(buyerUid).collection('deals').doc(dealId), {
      paymentStatus: 'funded', escrowAmount: amt,
    });

    // 6. Notify seller
    tx.set(db.collection('users').doc(sellerUid).collection('notifications').doc(), {
      type:      'escrow_funded',
      title:     'Payment received into escrow',
      body:      `$${amt.toLocaleString()} is held in escrow for "${room.listingTitle || 'your deal'}". Deliver to release funds.`,
      chatRoomId,
      dealId,
      read:      false,
      createdAt: Date.now(),
    });
  });

  // System message in chat (non-critical)
  await db.collection('dealChats').doc(chatRoomId).collection('messages').add({
    uid:       'system',
    type:      'system',
    text:      `💰 $${amt.toLocaleString()} has been placed in escrow. The seller can now deliver. Funds will be released once delivery is confirmed.`,
    createdAt: Date.now(),
  }).catch(() => {});

  // Notify seller — money is now waiting on them to deliver
  const roomForEmail = await roomRef.get().catch(() => null);
  const sellerUidForEmail = roomForEmail?.data()?.sellerUid;
  if (sellerUidForEmail) {
    const sellerSnapForEmail = await db.collection('users').doc(sellerUidForEmail).get();
    const sellerEmailForNotif = sellerSnapForEmail.exists ? (sellerSnapForEmail.data().email || '') : '';
    notifyDeal({
      uid: sellerUidForEmail,
      to: sellerEmailForNotif,
      accentKey: 'success',
      eyebrow: 'Payment received',
      heading: `$${amt.toLocaleString()} is in escrow`,
      bodyHtml: `The buyer funded escrow for <strong>${roomForEmail.data().listingTitle || 'your deal'}</strong>. Deliver the goods to get paid — funds release once the buyer confirms.`,
      pushBody: `$${amt.toLocaleString()} is in escrow for "${roomForEmail.data().listingTitle || 'your deal'}". Deliver to get paid.`,
      ctaLabel: 'Deliver now',
      chatRoomId,
    }).catch(() => {});
  }

  return res.status(200).json({ success: true, escrowAmount: amt });
}

// ─────────────────────────────────────────────────────────────────────────────
// escrow-deliver  { idToken, chatRoomId, dealId }
// Seller marks as delivered. Sets paymentStatus = 'delivered'.
// Does NOT release funds — buyer must confirm receipt.
// ─────────────────────────────────────────────────────────────────────────────
async function handleEscrowDeliver(req, res, idToken) {
  const { chatRoomId, dealId } = req.body;
  if (!chatRoomId) return res.status(400).json({ error: 'Missing chatRoomId' });

  const fbUser    = await verifyFirebaseToken(idToken);
  const sellerUid = fbUser.localId;

  const db       = getAdminDb();
  const roomRef  = db.collection('dealChats').doc(chatRoomId);
  const roomSnap = await roomRef.get();

  if (!roomSnap.exists)                return res.status(404).json({ error: 'Deal not found' });
  const room = roomSnap.data();
  if (room.sellerUid !== sellerUid)    return res.status(403).json({ error: 'Only the seller can mark delivery' });
  if (room.paymentStatus !== 'funded') {
    return res.status(400).json({ error: `Cannot deliver — status is ${room.paymentStatus || 'unfunded'}` });
  }

  const now = Date.now();
  const autoReleaseAt = now + DEAL_AUTO_RELEASE_MS;
  await roomRef.update({
    paymentStatus: 'delivered',
    deliveredAt: FieldValue.serverTimestamp(),
    deliveredAtMs: now,
    autoReleaseAt,
  });

  // Mirror on both deal docs
  await Promise.all([sellerUid, room.buyerUid].map(uid => {
    if (!uid || !dealId) return Promise.resolve();
    return db.collection('users').doc(uid).collection('deals').doc(dealId)
      .update({ paymentStatus: 'delivered', autoReleaseAt }).catch(() => {});
  }));

  // Notify buyer
  if (room.buyerUid) {
    await db.collection('users').doc(room.buyerUid).collection('notifications').add({
      type:      'deal_delivered',
      title:     'Seller marked as delivered',
      body:      `"${room.listingTitle || 'Your deal'}" has been marked delivered. Confirm to release payment.`,
      chatRoomId,
      dealId,
      read:      false,
      createdAt: now,
    }).catch(() => {});

    const buyerSnapForEmail = await db.collection('users').doc(room.buyerUid).get();
    const buyerEmailForNotif = buyerSnapForEmail.exists ? (buyerSnapForEmail.data().email || '') : '';
    notifyDeal({
      uid: room.buyerUid,
      to: buyerEmailForNotif,
      accentKey: 'warn',
      eyebrow: 'Action needed',
      heading: 'The seller marked your order delivered',
      bodyHtml: `<strong>${room.listingTitle || 'Your deal'}</strong> has been marked as delivered. Please confirm receipt to release payment, or raise a dispute if there's an issue. You have <strong>72 hours</strong> — after that, funds release automatically.`,
      pushBody: `"${room.listingTitle || 'Your deal'}" was marked delivered. Confirm receipt within 72 hours to release payment.`,
      ctaLabel: 'Confirm receipt',
      chatRoomId,
    }).catch(() => {});
  }

  // System message
  await db.collection('dealChats').doc(chatRoomId).collection('messages').add({
    uid:       'system',
    type:      'system',
    text:      'Seller has marked this deal as delivered. Please confirm receipt to release the funds, or raise a dispute if there is an issue. You have 72 hours to verify — if there\'s no response, the funds will be released to the seller automatically. The chat stays open the whole time if you have questions.',
    createdAt: now,
  }).catch(() => {});

  return res.status(200).json({ success: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// escrow-get-download-url  { idToken, chatRoomId, dealId, storagePath }
// Mints a short-lived signed URL for a deal deliverable — BUYER ONLY. The
// seller (whoever uploaded it) gets no download capability at all here; the
// frontend renders a read-only badge for them, and this endpoint independently
// enforces the same restriction server-side (never trust the client alone).
// Only usable while the deal is still "live" (funded / delivered / disputed).
// The moment a valid signed URL is issued to the buyer, the underlying file
// is deleted from storage — this is a ONE-TIME download. If the delete
// somehow fails, the buyer's link still works for its TTL, but the file
// won't get a second one after that (see below); any issue should go through
// a dispute rather than a repeat download.
// ─────────────────────────────────────────────────────────────────────────────
const DOWNLOAD_URL_TTL_SECONDS = 300; // 5 minutes

async function handleEscrowGetDownloadUrl(req, res, idToken) {
  const { chatRoomId, dealId, storagePath } = req.body;
  if (!chatRoomId)  return res.status(400).json({ error: 'Missing chatRoomId' });
  if (!storagePath) return res.status(400).json({ error: 'Missing storagePath' });

  const fbUser = await verifyFirebaseToken(idToken);
  const uid    = fbUser.localId;

  const db       = getAdminDb();
  const roomRef  = db.collection('dealChats').doc(chatRoomId);
  const roomSnap = await roomRef.get();
  if (!roomSnap.exists) return res.status(404).json({ error: 'Deal not found' });

  const room = roomSnap.data();

  // Buyer only — the seller (or anyone else) gets no download link, ever,
  // regardless of what the frontend renders. This is the actual enforcement
  // point; the read-only badge in the chat UI is just a courtesy reflection
  // of this rule, not the thing that provides it.
  if (room.buyerUid !== uid) {
    return res.status(403).json({ error: 'Only the buyer can download this file.' });
  }

  // storagePath from the (now multi-account) storage.js is formatted
  // "<accountId>@@<uploaderUid>--filename...", e.g. "3@@abc123--file-....zip".
  // Split off the account id first so the ownership check below compares
  // against the actual uid portion, not the whole prefixed string.
  const pathMatch = storagePath.match(/^(\d+)@@(.+)$/);
  if (!pathMatch) {
    return res.status(400).json({ error: 'Malformed storagePath' });
  }
  const [, accountId, uidScopedName] = pathMatch;

  // Defense in depth: the file must actually belong to this deal's chat room.
  // uidScopedName is prefixed "<uploaderUid>--...", and only the seller uploads
  // transfer deliverables, so require the path to have been uploaded by the
  // seller on this room — prevents one deal's storagePath being reused to
  // pull a file from an unrelated deal by guessing/reusing a path string.
  if (!uidScopedName.startsWith(`${room.sellerUid}--`)) {
    return res.status(403).json({ error: 'File does not belong to this deal' });
  }

  const liveStatuses = ['funded', 'delivered', 'disputed'];
  if (!liveStatuses.includes(room.paymentStatus)) {
    return res.status(403).json({
      error: `Download access is no longer available — deal status is ${room.paymentStatus || 'unknown'}.`,
    });
  }

  try {
    const account = findAccountById(accountId);
    const url = await supabaseCreateSignedUrl(account, uidScopedName, DOWNLOAD_URL_TTL_SECONDS);

    // Delete immediately — this is a one-time download. Non-blocking from
    // the buyer's perspective (the signed URL above is already valid and
    // will keep working for its TTL regardless of when the delete finishes),
    // but awaited here so a delete failure can at least be logged rather
    // than silently lost.
    deleteFiles(account, [uidScopedName]).catch(e =>
      console.warn(`[deal.js] failed to auto-delete deal file ${uidScopedName} on account ${accountId} (non-fatal):`, e.message)
    );

    // Mark the message so a refresh doesn't re-offer a dead download button,
    // and so support/disputes can see this file was already claimed.
    // Best-effort — find the message by storagePath and flag it.
    db.collection('dealChats').doc(chatRoomId).collection('messages')
      .where('storagePath', '==', storagePath).limit(1).get()
      .then(snap => { if (!snap.empty) snap.docs[0].ref.update({ downloaded: true, downloadedAt: Date.now() }).catch(() => {}); })
      .catch(() => {});

    return res.status(200).json({ url, expiresIn: DOWNLOAD_URL_TTL_SECONDS });
  } catch (err) {
    console.error('[deal.js] escrow-get-download-url sign error:', err.message);
    return res.status(500).json({ error: 'Could not generate download link' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Core release logic — shared by the buyer-triggered handler below and the
// automated 72h sweep. `auto: true` skips the buyer-identity check (the
// system is acting on the buyer's behalf because they didn't respond in
// time) and adjusts the system message + label so it's clear this happened
// automatically rather than by explicit buyer action.
//
// Applies the seller's plan-based platform fee (LIMITS.saleFees) here, at
// release time — not at escrow-pay time — since the full amount needs to sit
// in escrow untouched while funded/delivered/disputed (a refund must return
// exactly what the buyer paid). The fee is only actually taken once the sale
// completes. Seller receives `amt - fee`; the fee itself is credited to the
// platform admin account (see getPlatformFeeAdminUid) the same way any other
// wallet credit works — walletBalance + withdrawableBalance, a transaction
// record, everything auditable, nothing just vanishing into a ledger.
// ─────────────────────────────────────────────────────────────────────────────
async function _releaseEscrowForRoom(db, chatRoomId, dealId, { auto = false } = {}) {
  const roomRef = db.collection('dealChats').doc(chatRoomId);

  // Resolved ahead of the transaction — a query-by-email has no place inside
  // a Firestore transaction alongside doc gets/sets for the buyer/seller.
  // null means ADMIN_EMAIL is unset/unresolvable — NOT "no fee owed". The
  // fee is still deducted from the seller either way; this only decides
  // where it goes (live admin wallet vs the unclaimed-fees ledger).
  const adminUid = await getPlatformFeeAdminUid(db);
  let ledgerEntry = null; // set inside the transaction if we need to ledger post-commit

  await db.runTransaction(async tx => {
    const roomSnap = await tx.get(roomRef);
    if (!roomSnap.exists) throw new Error('Deal not found');
    const room = roomSnap.data();

    if (!['delivered', 'funded', 'disputed'].includes(room.paymentStatus)) {
      throw new Error(`Cannot release — status is ${room.paymentStatus}`);
    }
    if (room.paymentStatus === 'complete') throw new Error('Already complete');

    const sellerUid = room.sellerUid;
    const buyerUid   = room.buyerUid;
    const amt       = parseFloat(room.escrowAmount || 0);
    if (!amt) throw new Error('No escrow amount on file');

    const sellerRef  = db.collection('users').doc(sellerUid);
    const sellerSnap = await tx.get(sellerRef);
    if (!sellerSnap.exists) throw new Error('Seller not found');

    // ── Plan-based platform fee (LIMITS.saleFees — 20%/15%/10%/5% by plan) ──
    const sellerPlan = sellerSnap.data().plan || 'free';
    const feeRate     = LIMITS.saleFees[sellerPlan] ?? LIMITS.saleFees.free;
    const platformFee = parseFloat((amt * feeRate).toFixed(2));
    const sellerNet    = parseFloat((amt - platformFee).toFixed(2));

    // Two DISTINCT reasons the seller might keep the full amount — these
    // must never be conflated:
    //  - noFeeOwed: the seller IS the platform admin account, or the fee
    //    rounds to $0. Correctly no fee to collect from anyone.
    //  - feeOwedButUnroutable: a real fee IS owed and IS deducted from the
    //    seller below, same as normal — there's just nowhere live to credit
    //    it (adminUid is null) because ADMIN_EMAIL is unset/misconfigured.
    //    That fee goes to the unclaimed-fees ledger after this transaction
    //    commits, not to the seller and not into the void.
    const noFeeOwed = sellerUid === adminUid || platformFee <= 0;
    const feeOwedButUnroutable = !noFeeOwed && !adminUid;
    const applyFeeSplit = !noFeeOwed; // seller pays the fee either way unless noFeeOwed

    // Firestore transactions require every tx.get() to happen before any
    // tx.update()/tx.set(). Whether we can credit the admin live isn't known
    // until after the room and seller reads above, so this can't be
    // front-loaded alongside them in one Promise.all — but it still has to
    // run here, before the first write below.
    const adminRef  = (applyFeeSplit && adminUid) ? db.collection('users').doc(adminUid) : null;
    const adminSnap = adminRef ? await tx.get(adminRef) : null;
    if (adminRef && !adminSnap.exists) throw new Error('Platform fee admin account not found');

    const sellerBal    = parseFloat((sellerSnap.data().walletBalance || 0).toFixed(2));
    const creditToSeller = applyFeeSplit ? sellerNet : amt;
    const newSellerBal = parseFloat((sellerBal + creditToSeller).toFixed(2));
    // Sale proceeds are withdrawable (unlike a straight PayPal deposit —
    // see paypal.js's withdrawableBalance model), so escrow release credits
    // both fields.
    const sellerWithdrawable    = parseFloat((sellerSnap.data().withdrawableBalance || 0).toFixed(2));
    const newSellerWithdrawable = parseFloat((sellerWithdrawable + creditToSeller).toFixed(2));

    // 1. Credit seller wallet (net of platform fee), and bump the seller's
    // lifetime completed-deals counter. This is read directly by the
    // marketplace frontend (mpGetSeller) to show trust badges next to the
    // seller's name — computing it here via FieldValue.increment (inside
    // this same transaction) means the frontend never has to query or
    // aggregate deals itself, and the count can't drift from the actual
    // number of completions even under concurrent payouts.
    tx.update(sellerRef, {
      walletBalance: newSellerBal,
      withdrawableBalance: newSellerWithdrawable,
      dealsCompleted: FieldValue.increment(1),
    });

    // 2. Seller transaction record — always shows the REAL fee the seller
    // paid, whether or not we could route it to a live admin wallet. This
    // is the seller's own auditable record and must never disagree with
    // what actually left their payout.
    const sellerTxRecord = {
      type:       'escrow_release',
      amount:     creditToSeller,
      grossAmount: amt,
      platformFee: applyFeeSplit ? platformFee : 0,
      feeRate:     applyFeeSplit ? feeRate : 0,
      plan:        sellerPlan,
      label:      `Escrow released · ${room.listingTitle || 'Deal'}`,
      chatRoomId,
      dealId,
      buyerUid,
      auto,
      status:     'completed',
      createdAt:  FieldValue.serverTimestamp(),
    };
    if (applyFeeSplit) {
      sellerTxRecord.note = `$${amt.toLocaleString()} sale − ${(feeRate * 100).toFixed(feeRate * 100 % 1 === 0 ? 0 : 1)}% platform fee ($${platformFee.toFixed(2)}) = $${sellerNet.toFixed(2)}`
        + (feeOwedButUnroutable ? ' (fee pending platform reconciliation)' : '');
    }
    tx.set(sellerRef.collection('transactions').doc(), sellerTxRecord);

    // 2b. Credit the platform fee to the admin account — only when a real
    // fee is owed AND we have somewhere live to put it. If a fee is owed
    // but adminUid is null (feeOwedButUnroutable), the fee has still been
    // deducted from the seller above — it's queued for the unclaimed-fees
    // ledger after the transaction commits (see ledgerEntry below), not
    // dropped here.
    if (applyFeeSplit && adminRef) {
      const adminBal    = parseFloat((adminSnap.data().walletBalance || 0).toFixed(2));
      const newAdminBal = parseFloat((adminBal + platformFee).toFixed(2));
      const adminWithdrawable    = parseFloat((adminSnap.data().withdrawableBalance || 0).toFixed(2));
      const newAdminWithdrawable = parseFloat((adminWithdrawable + platformFee).toFixed(2));

      tx.update(adminRef, { walletBalance: newAdminBal, withdrawableBalance: newAdminWithdrawable });

      tx.set(adminRef.collection('transactions').doc(), {
        type:        'platform_fee',
        amount:      platformFee,
        label:       `Platform fee · ${room.listingTitle || 'Deal'}`,
        note:        `${(feeRate * 100).toFixed(feeRate * 100 % 1 === 0 ? 0 : 1)}% of $${amt.toLocaleString()} (seller plan: ${sellerPlan})`,
        chatRoomId,
        dealId,
        sellerUid,
        buyerUid,
        status:      'completed',
        createdAt:   FieldValue.serverTimestamp(),
      });
    } else if (feeOwedButUnroutable) {
      ledgerEntry = {
        amount: platformFee,
        source: 'escrow_release',
        sourceId: dealId || chatRoomId,
        payerUid: sellerUid,
        counterpartyUid: buyerUid,
        note: `${(feeRate * 100).toFixed(feeRate * 100 % 1 === 0 ? 0 : 1)}% of $${amt.toLocaleString()} (seller plan: ${sellerPlan}) — deducted from seller, held pending ADMIN_EMAIL fix`,
      };
    }

    // 3. Buyer transaction record (closes the hold)
    const buyerRef = db.collection('users').doc(buyerUid);
    tx.set(buyerRef.collection('transactions').doc(), {
      type:       'escrow_released',
      amount:     0,
      label:      `Escrow released to seller · ${room.listingTitle || 'Deal'}`,
      chatRoomId,
      dealId,
      sellerUid,
      auto,
      status:     'completed',
      createdAt:  FieldValue.serverTimestamp(),
    });

    // 4. Close the chat room — outcome is "Deal Successful"
    tx.update(roomRef, {
      paymentStatus: 'complete',
      dealOutcome:   'successful',
      completedAt:   FieldValue.serverTimestamp(),
      autoCompleted: auto,
      active:        false,
    });

    // 5. Mirror on both deal docs. The seller's copy additionally records
    // completedAt + sellerNetAmount (the actual post-platform-fee credit) —
    // these two fields are what get-seller-stats reads to compute lifetime/
    // last-7-days revenue and category breakdowns for the public seller
    // profile modal, so they need to live on the deal doc itself rather
    // than only on the (differently-scoped) dealChats room doc.
    if (dealId) {
      tx.update(db.collection('users').doc(sellerUid).collection('deals').doc(dealId), {
        paymentStatus: 'complete', status: 'complete', dealOutcome: 'successful',
        completedAt: FieldValue.serverTimestamp(),
        sellerNetAmount: creditToSeller,
      });
      tx.update(buyerRef.collection('deals').doc(dealId), {
        paymentStatus: 'complete', status: 'complete', dealOutcome: 'successful',
        completedAt: FieldValue.serverTimestamp(),
      });
    }

    // 6. Notify seller
    tx.set(sellerRef.collection('notifications').doc(), {
      type:      'escrow_released',
      title:     'Payment released!',
      body:      auto
        ? `$${creditToSeller.toLocaleString()} has been automatically released to your wallet for "${room.listingTitle || 'your deal'}" after the 72-hour verification window passed.${applyFeeSplit ? ` (${(feeRate * 100).toFixed(feeRate * 100 % 1 === 0 ? 0 : 1)}% platform fee already deducted.)` : ''}`
        : `$${creditToSeller.toLocaleString()} has been added to your wallet for "${room.listingTitle || 'your deal'}'.${applyFeeSplit ? ` (${(feeRate * 100).toFixed(feeRate * 100 % 1 === 0 ? 0 : 1)}% platform fee already deducted.)` : ''}`,
      chatRoomId,
      dealId,
      read:      false,
      createdAt: Date.now(),
    });

    // 7. If auto-released, let the buyer know too — they didn't take the action themselves
    if (auto) {
      tx.set(buyerRef.collection('notifications').doc(), {
        type:      'escrow_auto_released',
        title:     'Deal auto-completed',
        body:      `The 72-hour verification window for "${room.listingTitle || 'this deal'}" passed, so the funds were automatically released to the seller.`,
        chatRoomId,
        dealId,
        read:      false,
        createdAt: Date.now(),
      });
    }
  });

  // Ledger the deducted-but-unroutable platform fee (if any) now that the
  // money-moving transaction above has actually committed — the fee was
  // already taken from the seller inside that transaction; this just
  // records where it's sitting until ADMIN_EMAIL is fixed and it can be
  // swept into the real admin wallet.
  if (ledgerEntry) {
    await _ledgerUnclaimedFee(db, ledgerEntry);
  }

  // System message (outside transaction — non-critical)
  const roomSnap2 = await roomRef.get().catch(() => null);
  const amt2      = roomSnap2?.data()?.escrowAmount || '';
  await db.collection('dealChats').doc(chatRoomId).collection('messages').add({
    uid:       'system',
    type:      'system',
    text:      auto
      ? `⏱ The 72-hour verification window passed without a response, so this deal auto-completed. $${amt2 ? Number(amt2).toLocaleString() : ''} has been released to the seller. Deal Successful!`
      : `Deal complete! $${amt2 ? Number(amt2).toLocaleString() : ''} has been released to the seller. Thank you for using Siterifty!`,
    createdAt: Date.now(),
  }).catch(() => {});

  // Notifications — payment landing is the single biggest "big moment" in the
  // whole deal lifecycle, so both sides get one, on both channels. Re-reads
  // are cheap and keep this fully outside (and never blocking) the
  // money-moving transaction.
  const roomData = roomSnap2?.data();
  if (roomData) {
    const listingTitle = roomData.listingTitle || 'your deal';
    const amtStr = amt2 ? Number(amt2).toLocaleString() : '';

    if (roomData.sellerUid) {
      const sellerSnapForEmail = await db.collection('users').doc(roomData.sellerUid).get();
      const sellerEmailForNotif = sellerSnapForEmail.exists ? (sellerSnapForEmail.data().email || '') : '';
      notifyDeal({
        uid: roomData.sellerUid,
        to: sellerEmailForNotif,
        accentKey: 'success',
        eyebrow: 'Payment released',
        heading: `You've been paid for "${listingTitle}"`,
        bodyHtml: auto
          ? `The 72-hour verification window passed, so <strong>$${amtStr}</strong> was automatically released to your wallet.`
          : `The buyer confirmed receipt — <strong>$${amtStr}</strong> has been added to your wallet.`,
        pushBody: auto
          ? `$${amtStr} was auto-released to your wallet for "${listingTitle}".`
          : `$${amtStr} was released to your wallet for "${listingTitle}".`,
        ctaLabel: 'View wallet',
        chatRoomId,
      }).catch(() => {});
    }

    // Buyer only gets a notification here if this was an auto-release — if
    // they clicked "release" themselves, they don't need to be told what
    // they just did.
    if (auto && roomData.buyerUid) {
      const buyerSnapForEmail = await db.collection('users').doc(roomData.buyerUid).get();
      const buyerEmailForNotif = buyerSnapForEmail.exists ? (buyerSnapForEmail.data().email || '') : '';
      notifyDeal({
        uid: roomData.buyerUid,
        to: buyerEmailForNotif,
        accentKey: 'info',
        eyebrow: 'Deal auto-completed',
        heading: `"${listingTitle}" is complete`,
        bodyHtml: `The 72-hour verification window passed without a response, so funds were automatically released to the seller.`,
        pushBody: `"${listingTitle}" auto-completed — funds were released to the seller.`,
        ctaLabel: 'View deal',
        chatRoomId,
      }).catch(() => {});
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// escrow-release  { idToken, chatRoomId, dealId }
// Buyer confirms delivery → funds released to seller.
// Atomically: credits seller wallet, closes deal, writes transaction records.
// ─────────────────────────────────────────────────────────────────────────────
async function handleEscrowRelease(req, res, idToken) {
  const { chatRoomId, dealId } = req.body;
  if (!chatRoomId) return res.status(400).json({ error: 'Missing chatRoomId' });

  const fbUser   = await verifyFirebaseToken(idToken);
  const buyerUid = fbUser.localId;

  const db      = getAdminDb();
  const roomRef = db.collection('dealChats').doc(chatRoomId);
  const roomSnap = await roomRef.get();
  if (!roomSnap.exists) return res.status(404).json({ error: 'Deal not found' });
  if (roomSnap.data().buyerUid !== buyerUid) {
    return res.status(403).json({ error: 'Only the buyer can release funds' });
  }

  await _releaseEscrowForRoom(db, chatRoomId, dealId, { auto: false });

  return res.status(200).json({ success: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// Core refund logic — shared by the participant-triggered handler below and
// the automated 14-day-hard-cap sweep for deals that were funded but never
// delivered in time. `auto: true` skips the participant-identity check and
// adjusts messaging to make clear this happened automatically.
// ─────────────────────────────────────────────────────────────────────────────
async function _refundEscrowForRoom(db, chatRoomId, dealId, { auto = false } = {}) {
  const roomRef = db.collection('dealChats').doc(chatRoomId);

  await db.runTransaction(async tx => {
    const roomSnap = await tx.get(roomRef);
    if (!roomSnap.exists) throw new Error('Deal not found');
    const room = roomSnap.data();

    if (!['funded', 'delivered', 'disputed'].includes(room.paymentStatus)) {
      throw new Error(`Cannot refund — status is ${room.paymentStatus || 'unfunded'}`);
    }
    if (room.paymentStatus === 'complete') throw new Error('Deal already complete');

    const buyerUid = room.buyerUid;
    const amt      = parseFloat(room.escrowAmount || 0);
    if (!amt) throw new Error('No escrow amount on file');

    const buyerRef  = db.collection('users').doc(buyerUid);
    const buyerSnap = await tx.get(buyerRef);
    if (!buyerSnap.exists) throw new Error('Buyer not found');

    const buyerBal    = parseFloat((buyerSnap.data().walletBalance || 0).toFixed(2));
    const newBuyerBal = parseFloat((buyerBal + amt).toFixed(2));
    // Restore exactly what escrow-pay drew from withdrawableBalance (see
    // escrowWithdrawableDebit on the room) — not the full `amt`, since some
    // of that money may have come from non-withdrawable (deposited) funds.
    const withdrawableDebit = parseFloat((room.escrowWithdrawableDebit || 0).toFixed(2));
    const buyerWithdrawable    = parseFloat((buyerSnap.data().withdrawableBalance || 0).toFixed(2));
    const newBuyerWithdrawable = parseFloat((buyerWithdrawable + withdrawableDebit).toFixed(2));

    // 1. Refund buyer wallet
    tx.update(buyerRef, { walletBalance: newBuyerBal, withdrawableBalance: newBuyerWithdrawable });

    // 2. Buyer transaction record
    tx.set(buyerRef.collection('transactions').doc(), {
      type:       'escrow_refund',
      amount:     amt,
      label:      `Escrow refunded · ${room.listingTitle || 'Deal'}`,
      chatRoomId,
      dealId,
      sellerUid:  room.sellerUid,
      auto,
      status:     'completed',
      createdAt:  FieldValue.serverTimestamp(),
    });

    // 3. Close room — outcome is "Deal Closed"
    tx.update(roomRef, {
      paymentStatus: 'refunded',
      dealOutcome:   'closed',
      refundedAt:    FieldValue.serverTimestamp(),
      autoCancelled: auto,
      active:        false,
      cancelled:     true,
    });

    // 4. Mirror on both deal docs
    if (dealId) {
      tx.update(db.collection('users').doc(room.sellerUid).collection('deals').doc(dealId), {
        paymentStatus: 'refunded', status: 'cancelled', dealOutcome: 'closed',
      });
      tx.update(buyerRef.collection('deals').doc(dealId), {
        paymentStatus: 'refunded', status: 'cancelled', dealOutcome: 'closed',
      });
    }

    // 5. Notify buyer — funds back in wallet
    tx.set(buyerRef.collection('notifications').doc(), {
      type:      'escrow_refunded',
      title:     auto ? 'Deal closed — refunded' : 'Escrow refunded',
      body:      auto
        ? `The 14-day deadline for "${room.listingTitle || 'this deal'}" passed without delivery, so $${amt.toLocaleString()} was automatically returned to your wallet.`
        : `$${amt.toLocaleString()} has been returned to your wallet for "${room.listingTitle || 'this deal'}".`,
      chatRoomId,
      dealId,
      read:      false,
      createdAt: Date.now(),
    });

    // 6. Notify seller — deal is now closed
    tx.set(db.collection('users').doc(room.sellerUid).collection('notifications').doc(), {
      type:      'escrow_refunded',
      title:     'Deal closed',
      body:      auto
        ? `The 14-day deadline for "${room.listingTitle || 'this deal'}" passed without delivery. The deal has closed and escrow was refunded to the buyer.`
        : `The escrow for "${room.listingTitle || 'this deal'}" was refunded to the buyer. This deal is now closed.`,
      chatRoomId,
      dealId,
      read:      false,
      createdAt: Date.now(),
    });
  });

  await db.collection('dealChats').doc(chatRoomId).collection('messages').add({
    uid:       'system',
    type:      'system',
    text:      auto
      ? '⏱ The 14-day deadline passed without the deal being delivered. Deal Closed — the escrow has been refunded to the buyer.'
      : 'The escrow has been refunded to the buyer. This deal is now closed.',
    createdAt: Date.now(),
  }).catch(() => {});

  // Notifications — refund is money moving, so both sides get told, on both channels.
  const roomSnapForEmail = await roomRef.get().catch(() => null);
  const roomForEmail = roomSnapForEmail?.data();
  if (roomForEmail) {
    const listingTitle = roomForEmail.listingTitle || 'this deal';
    const amtStr = roomForEmail.escrowAmount ? Number(roomForEmail.escrowAmount).toLocaleString() : '';

    if (roomForEmail.buyerUid) {
      const buyerSnapForEmail = await db.collection('users').doc(roomForEmail.buyerUid).get();
      const buyerEmailForNotif = buyerSnapForEmail.exists ? (buyerSnapForEmail.data().email || '') : '';
      notifyDeal({
        uid: roomForEmail.buyerUid,
        to: buyerEmailForNotif,
        accentKey: 'info',
        eyebrow: auto ? 'Deal closed' : 'Refund issued',
        heading: `$${amtStr} refunded to your wallet`,
        bodyHtml: auto
          ? `The 14-day delivery deadline for <strong>${listingTitle}</strong> passed, so your payment was automatically returned to your wallet.`
          : `Your escrow payment for <strong>${listingTitle}</strong> has been returned to your wallet.`,
        pushBody: `$${amtStr} was refunded to your wallet for "${listingTitle}".`,
        ctaLabel: 'View wallet',
        chatRoomId,
      }).catch(() => {});
    }
    if (roomForEmail.sellerUid) {
      const sellerSnapForEmail = await db.collection('users').doc(roomForEmail.sellerUid).get();
      const sellerEmailForNotif = sellerSnapForEmail.exists ? (sellerSnapForEmail.data().email || '') : '';
      notifyDeal({
        uid: roomForEmail.sellerUid,
        to: sellerEmailForNotif,
        accentKey: 'danger',
        eyebrow: 'Deal closed',
        heading: `"${listingTitle}" was refunded to the buyer`,
        bodyHtml: auto
          ? `The 14-day delivery deadline passed without delivery, so this deal was automatically closed and escrow refunded to the buyer.`
          : `This deal has been closed and the escrow payment refunded to the buyer.`,
        pushBody: `"${listingTitle}" was closed — escrow was refunded to the buyer.`,
        ctaLabel: 'View deal',
        chatRoomId,
      }).catch(() => {});
    }
  }
}

// Cancels a deal that expired before any money was ever put into escrow
// (paymentStatus is still unfunded/null) — no wallet transaction needed,
// just close the room and mark both sides' deal docs as closed.
async function _cancelUnfundedExpiredRoom(db, chatRoomId, dealId, room) {
  const roomRef = db.collection('dealChats').doc(chatRoomId);
  await roomRef.update({
    paymentStatus: room.paymentStatus || 'unfunded',
    dealOutcome:   'closed',
    autoCancelled: true,
    active:        false,
    cancelled:     true,
    closedAt:      FieldValue.serverTimestamp(),
  });
  if (dealId) {
    await Promise.all([room.sellerUid, room.buyerUid].map(uid => {
      if (!uid) return Promise.resolve();
      return db.collection('users').doc(uid).collection('deals').doc(dealId)
        .update({ status: 'cancelled', dealOutcome: 'closed' }).catch(() => {});
    }));
  }
  await db.collection('dealChats').doc(chatRoomId).collection('messages').add({
    uid:       'system',
    type:      'system',
    text:      '⏱ The delivery deadline passed without payment being finalized. Deal Closed.',
    createdAt: Date.now(),
  }).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────
// escrow-refund  { idToken, chatRoomId, dealId }
// Either party triggers a refund. Returns escrow to buyer wallet.
// Valid from: funded, delivered, or disputed status.
// ─────────────────────────────────────────────────────────────────────────────
async function handleEscrowRefund(req, res, idToken) {
  const { chatRoomId, dealId } = req.body;
  if (!chatRoomId) return res.status(400).json({ error: 'Missing chatRoomId' });

  const fbUser = await verifyFirebaseToken(idToken);
  const uid    = fbUser.localId;

  const db      = getAdminDb();
  const roomRef = db.collection('dealChats').doc(chatRoomId);
  const roomSnap = await roomRef.get();
  if (!roomSnap.exists) return res.status(404).json({ error: 'Deal not found' });
  const room = roomSnap.data();
  if (room.sellerUid !== uid && room.buyerUid !== uid) {
    return res.status(403).json({ error: 'Not a participant in this deal' });
  }

  await _refundEscrowForRoom(db, chatRoomId, dealId, { auto: false });

  return res.status(200).json({ success: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// escrow-dispute  { idToken, chatRoomId, dealId, reason }
// Either party raises a dispute on a funded/delivered deal.
// Freezes the escrow and creates a record in /disputes for admin review.
// ─────────────────────────────────────────────────────────────────────────────
async function handleEscrowDispute(req, res, idToken) {
  const { chatRoomId, dealId, reason } = req.body;
  if (!chatRoomId) return res.status(400).json({ error: 'Missing chatRoomId' });

  const fbUser      = await verifyFirebaseToken(idToken);
  const disputerUid = fbUser.localId;

  const db       = getAdminDb();
  const roomRef  = db.collection('dealChats').doc(chatRoomId);
  const roomSnap = await roomRef.get();

  if (!roomSnap.exists) return res.status(404).json({ error: 'Deal not found' });
  const room = roomSnap.data();

  if (room.sellerUid !== disputerUid && room.buyerUid !== disputerUid) {
    return res.status(403).json({ error: 'Not a participant in this deal' });
  }
  if (!['funded', 'delivered'].includes(room.paymentStatus)) {
    return res.status(400).json({
      error: `Cannot dispute — status is ${room.paymentStatus || 'unfunded'}`,
    });
  }

  const now            = Date.now();
  const sanitizedReason = (reason || '').slice(0, 500);

  await roomRef.update({
    paymentStatus: 'disputed',
    disputedAt:    FieldValue.serverTimestamp(),
    disputedBy:    disputerUid,
    disputeReason: sanitizedReason,
  });

  // Mirror on both deal docs
  await Promise.all([room.sellerUid, room.buyerUid].map(uid => {
    if (!uid || !dealId) return Promise.resolve();
    return db.collection('users').doc(uid).collection('deals').doc(dealId)
      .update({
        paymentStatus: 'disputed',
        disputedAt: FieldValue.serverTimestamp(),
        disputedBy: disputerUid,
        disputeReason: sanitizedReason,
      }).catch(() => {});
  }));

  // Write dispute record for admin review
  const disputeRef = await db.collection('disputes').add({
    chatRoomId,
    dealId:       dealId || null,
    sellerUid:    room.sellerUid,
    buyerUid:     room.buyerUid,
    disputedBy:   disputerUid,
    escrowAmount: room.escrowAmount || 0,
    listingTitle: room.listingTitle || '',
    reason:       sanitizedReason,
    status:       'open',
    createdAt:    FieldValue.serverTimestamp(),
  });

  // Kick off AI triage (aistudio.js handleTriage) — gives this dispute an
  // aiVerdict/aiConfidence/aiReasoning pass, and auto-applies high-confidence
  // low-risk outcomes. Money/ban verdicts get a 48h reversible window rather
  // than being silently final — see AUTO_APPLY_MONEY_ACTIONS in aistudio.js.
  // Fire-and-forget: never block the dispute filing on the AI call.
  triggerAiTriage({
    kind: 'dispute',
    id: disputeRef.id,
    evidence: {
      chatRoomId,
      dealId: dealId || null,
      sellerUid: room.sellerUid,
      buyerUid: room.buyerUid,
      disputedBy: disputerUid,
      escrowAmount: room.escrowAmount || 0,
      listingTitle: room.listingTitle || '',
      reason: sanitizedReason,
      paymentStatus: room.paymentStatus,
    },
  });

  // Notify the other party
  const otherUid = disputerUid === room.sellerUid ? room.buyerUid : room.sellerUid;
  if (otherUid) {
    await db.collection('users').doc(otherUid).collection('notifications').add({
      type:      'deal_disputed',
      title:     'A dispute has been raised',
      body:      `A dispute was opened on "${room.listingTitle || 'your deal'}". Our team will review within 24–48 hours.`,
      chatRoomId,
      dealId,
      read:      false,
      createdAt: now,
    }).catch(() => {});

    const otherSnapForEmail = await db.collection('users').doc(otherUid).get();
    const otherEmailForNotif = otherSnapForEmail.exists ? (otherSnapForEmail.data().email || '') : '';
    notifyDeal({
      uid: otherUid,
      to: otherEmailForNotif,
      accentKey: 'danger',
      eyebrow: 'Dispute raised',
      heading: 'A dispute was opened on your deal',
      bodyHtml: `A dispute was opened on <strong>${room.listingTitle || 'your deal'}</strong> and escrow funds are now frozen. Our team will review within <strong>24–48 hours</strong>.`,
      pushBody: `A dispute was opened on "${room.listingTitle || 'your deal'}". Funds are frozen pending review.`,
      ctaLabel: 'View deal',
      chatRoomId,
    }).catch(() => {});
  }

  await db.collection('dealChats').doc(chatRoomId).collection('messages').add({
    uid:       'system',
    type:      'system',
    text:      'A dispute has been raised on this deal. Funds are frozen. The Siterifty team will review and resolve within 24–48 hours.',
    createdAt: now,
  }).catch(() => {});

  return res.status(200).json({ success: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// admin-resolve-dispute  { disputeId, outcome: 'release' | 'refund' }
// ADMIN-ONLY — gated by the admin_session cookie (verifyAdminSession), not a
// user idToken. Resolves an open dispute one of two ways:
//   outcome: 'release' — pay the seller (same transaction _releaseEscrowForRoom
//     already runs for a normal delivery confirmation — fee split, seller
//     wallet credit, dealsCompleted increment, etc). Requires the escrow
//     status check inside _releaseEscrowForRoom to accept 'disputed', which
//     it now does.
//   outcome: 'refund' — return the funds to the buyer (same transaction
//     _refundEscrowForRoom already runs for a participant-cancelled refund).
// Either way, marks the /disputes doc resolved and notifies both parties
// with the outcome so nobody is left wondering what happened to their money.
// ─────────────────────────────────────────────────────────────────────────────
async function handleAdminResolveDispute(req, res) {
  const session = verifyAdminSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated as admin' });

  const { disputeId, outcome } = req.body || {};
  if (!disputeId) return res.status(400).json({ error: 'Missing disputeId' });
  if (!['release', 'refund'].includes(outcome)) {
    return res.status(400).json({ error: 'outcome must be "release" or "refund"' });
  }

  const db = getAdminDb();
  const disputeRef = db.collection('disputes').doc(disputeId);
  const disputeSnap = await disputeRef.get();
  if (!disputeSnap.exists) return res.status(404).json({ error: 'Dispute not found' });
  const dispute = disputeSnap.data();

  if (dispute.status === 'resolved') {
    return res.status(400).json({ error: 'This dispute has already been resolved' });
  }
  if (!dispute.chatRoomId) return res.status(400).json({ error: 'Dispute is missing chatRoomId' });

  if (outcome === 'release') {
    await _releaseEscrowForRoom(db, dispute.chatRoomId, dispute.dealId || null, { auto: false });
  } else {
    await _refundEscrowForRoom(db, dispute.chatRoomId, dispute.dealId || null, { auto: false });
  }

  await disputeRef.update({
    status: 'resolved',
    outcome,
    resolvedAt: FieldValue.serverTimestamp(),
    resolvedBy: session.email,
  });

  // Notify both parties with the outcome.
  const now = Date.now();
  const winnerUid = outcome === 'release' ? dispute.sellerUid : dispute.buyerUid;
  const loserUid  = outcome === 'release' ? dispute.buyerUid  : dispute.sellerUid;
  const dealLabel = dispute.listingTitle || 'your deal';

  await Promise.all([
    winnerUid ? db.collection('users').doc(winnerUid).collection('notifications').add({
      type: 'dispute_resolved',
      title: 'Dispute resolved in your favor',
      body: outcome === 'release'
        ? `The dispute on "${dealLabel}" was resolved — funds have been released to you.`
        : `The dispute on "${dealLabel}" was resolved — you've been refunded.`,
      chatRoomId: dispute.chatRoomId,
      dealId: dispute.dealId || null,
      read: false,
      createdAt: now,
    }).catch(() => {}) : Promise.resolve(),
    loserUid ? db.collection('users').doc(loserUid).collection('notifications').add({
      type: 'dispute_resolved',
      title: 'Dispute resolved',
      body: outcome === 'release'
        ? `The dispute on "${dealLabel}" was resolved in the seller's favor — funds have been released to them.`
        : `The dispute on "${dealLabel}" was resolved in the buyer's favor — they've been refunded.`,
      chatRoomId: dispute.chatRoomId,
      dealId: dispute.dealId || null,
      read: false,
      createdAt: now,
    }).catch(() => {}) : Promise.resolve(),
    db.collection('dealChats').doc(dispute.chatRoomId).collection('messages').add({
      uid: 'system',
      type: 'system',
      text: outcome === 'release'
        ? 'This dispute has been resolved by the Siterifty team — funds have been released to the seller.'
        : 'This dispute has been resolved by the Siterifty team — funds have been refunded to the buyer.',
      createdAt: now,
    }).catch(() => {}),
  ]);

  return res.status(200).json({ success: true, outcome });
}
//   • paymentStatus === 'delivered' and now > autoReleaseAt (72h post-delivery)
//       → auto-release escrow to seller. Outcome: "Deal Successful".
//       The chat is NOT locked before this — the buyer can keep asking
//       questions right up until the window closes.
//   • paymentStatus is 'unfunded'/'funded' (never delivered) and
//     now > expiresAt (per-listing-type deadline, capped at 14 days)
//       → auto-refund (if funded) or auto-cancel (if never funded).
//       Outcome: "Deal Closed".
//   • paymentStatus === 'disputed' is NEVER touched — always needs a human.
//   • paymentStatus === 'complete' / 'refunded' / already closed → skipped.
//
// Call modes:
//   - { chatRoomId: 'deal_xyz' } — resolve just one room. Used by the client
//     as a lazy fallback (checked whenever a deal chat is opened) so deals
//     still resolve correctly even before a cron job is wired up.
//   - {} (no chatRoomId) — sweep ALL active dealChats. Intended to be called
//     by a scheduled job (e.g. Vercel Cron hitting this endpoint every
//     15–30 minutes) — see vercel.json `crons` config to wire this up:
//       { "path": "/api/deal?action=sweep-expired-deals", "schedule": "*/15 * * * *" }
//     A GET request from Vercel Cron is also accepted for this one action
//     (see handler() below) since cron jobs can't easily send a POST body.
// ─────────────────────────────────────────────────────────────────────────────
// Shared resolution logic for a single dealChats room — used by both the
// cron-driven full sweep and the client-triggered single-room check.
async function _resolveExpiredRoomIfDue(db, id, room, now) {
  if (!room || room.active === false || !room.paymentStatus) return { outcome: 'skipped' };
  if (room.paymentStatus === 'disputed') return { outcome: 'skipped' };
  if (['complete', 'refunded'].includes(room.paymentStatus)) return { outcome: 'skipped' };

  // 1. Post-delivery 72h buyer-verify window
  if (room.paymentStatus === 'delivered') {
    const deadline = room.autoReleaseAt || null;
    if (deadline && now > deadline) {
      await _releaseEscrowForRoom(db, id, room.dealId || null, { auto: true });
      return { outcome: 'released' };
    }
    return { outcome: 'skipped' };
  }

  // 2. Pre-delivery hard deadline (per listing type, capped at 14 days)
  if (['unfunded', 'funded'].includes(room.paymentStatus)) {
    const deadline = room.expiresAt || null;
    if (deadline && now > deadline) {
      if (room.paymentStatus === 'funded' && parseFloat(room.escrowAmount || 0) > 0) {
        await _refundEscrowForRoom(db, id, room.dealId || null, { auto: true });
        return { outcome: 'refunded' };
      }
      await _cancelUnfundedExpiredRoom(db, id, room.dealId || null, room);
      return { outcome: 'cancelled' };
    }
    return { outcome: 'skipped' };
  }

  return { outcome: 'skipped' };
}

async function handleSweepExpiredDeals(req, res) {
  const db = getAdminDb();
  const chatRoomId = req.body?.chatRoomId || req.query?.chatRoomId || null;
  const now = Date.now();
  const results = { released: [], refunded: [], cancelled: [], skipped: 0, errors: [] };

  async function resolveOne(id, room) {
    try {
      const { outcome } = await _resolveExpiredRoomIfDue(db, id, room, now);
      if (outcome === 'released')  results.released.push(id);
      else if (outcome === 'refunded')  results.refunded.push(id);
      else if (outcome === 'cancelled') results.cancelled.push(id);
      else results.skipped++;
    } catch (err) {
      results.errors.push({ chatRoomId: id, error: err.message });
    }
  }

  if (chatRoomId) {
    const snap = await db.collection('dealChats').doc(chatRoomId).get();
    if (!snap.exists) return res.status(404).json({ error: 'Deal not found' });
    await resolveOne(chatRoomId, snap.data());
  } else {
    // Full sweep — only scans rooms still marked active to keep this cheap.
    const snap = await db.collection('dealChats').where('active', '==', true).get();
    await Promise.all(snap.docs.map(d => resolveOne(d.id, d.data())));
  }

  return res.status(200).json({ success: true, ...results });
}

// ─────────────────────────────────────────────────────────────────────────────
// invite-github-collaborator  { idToken, chatRoomId, dealId, buyerGithubUsername }
//
// Seller-only. If the listing attached to this deal has a GitHub repo
// (listing.attachedRepo), uses the SELLER's stored GitHub access token
// (users/{sellerUid}.githubAccessToken) to add the buyer as a collaborator
// on that repo. This is a manual, seller-triggered action — nothing runs
// automatically on payment/delivery; the seller must click "Add buyer" in
// the deal's repo card, same spirit as every other transfer method here.
//
// Buyers don't authenticate with GitHub through Siterifty, so we can't look
// up their username from their Firebase account — they type their own
// GitHub username once in the deal UI, which is passed in as
// buyerGithubUsername and stored on the room for future status checks.
// ─────────────────────────────────────────────────────────────────────────────
async function handleInviteGithubCollaborator(req, res, idToken) {
  const { chatRoomId, dealId, buyerGithubUsername } = req.body || {};
  if (!chatRoomId) return res.status(400).json({ error: 'Missing chatRoomId' });
  if (!buyerGithubUsername || !String(buyerGithubUsername).trim()) {
    return res.status(400).json({ error: 'Missing buyerGithubUsername' });
  }

  const fbUser    = await verifyFirebaseToken(idToken);
  const sellerUid = fbUser.localId;

  const db      = getAdminDb();
  const roomRef = db.collection('dealChats').doc(chatRoomId);
  const roomSnap = await roomRef.get();
  if (!roomSnap.exists) return res.status(404).json({ error: 'Deal not found' });
  const room = roomSnap.data();

  if (room.sellerUid !== sellerUid) {
    return res.status(403).json({ error: 'Only the seller can invite a collaborator' });
  }
  if (!['funded', 'delivered'].includes(room.paymentStatus)) {
    return res.status(400).json({ error: `Cannot invite collaborator — deal status is ${room.paymentStatus || 'unfunded'}` });
  }

  // Look up the listing's attached repo
  const listingId = room.listingId || null;
  if (!listingId) return res.status(400).json({ error: 'No listing attached to this deal' });
  const listingSnap = await db.collection('listings').doc(listingId).get();
  if (!listingSnap.exists) return res.status(404).json({ error: 'Listing not found' });
  const listing = listingSnap.data();
  const repo = listing.attachedRepo || null;
  if (!repo || !repo.fullName) {
    return res.status(400).json({ error: 'This listing has no GitHub repository attached' });
  }

  // Seller's GitHub token
  const sellerSnap = await db.collection('users').doc(sellerUid).get();
  const sellerData = sellerSnap.exists ? sellerSnap.data() : {};
  const githubAccessToken = sellerData.githubAccessToken;
  if (!githubAccessToken) {
    return res.status(400).json({ error: 'not_connected', reason: 'Seller has not connected GitHub' });
  }

  const cleanUsername = String(buyerGithubUsername).trim().replace(/^@/, '');

  const ghRes = await fetch(
    `https://api.github.com/repos/${repo.fullName}/collaborators/${encodeURIComponent(cleanUsername)}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${githubAccessToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ permission: 'pull' }), // read access is enough to review/clone before full handover
    }
  );

  if (ghRes.status === 401) {
    return res.status(400).json({ error: 'not_connected', reason: 'token_revoked' });
  }
  if (ghRes.status === 404) {
    return res.status(404).json({ error: 'github_user_not_found', message: `No GitHub user found with username "${cleanUsername}".` });
  }
  if (![201, 204].includes(ghRes.status)) {
    let detail = '';
    try { detail = (await ghRes.json())?.message || ''; } catch (e) {}
    return res.status(500).json({ error: 'github_api_error', message: detail || `GitHub API returned ${ghRes.status}` });
  }

  // 201 = invitation created (private repo, awaiting acceptance)
  // 204 = user already had access, or was added directly (rare/public repos)
  const invitePending = ghRes.status === 201;
  const now = Date.now();

  const collabState = {
    githubCollaboratorUsername: cleanUsername,
    githubCollaboratorStatus: invitePending ? 'invited' : 'added',
    githubCollaboratorInvitedAt: now,
  };
  await roomRef.update(collabState);

  await db.collection('dealChats').doc(chatRoomId).collection('messages').add({
    uid:       'system',
    type:      'system',
    text:      invitePending
      ? `The seller invited GitHub user "${cleanUsername}" to "${repo.fullName}". Check your GitHub notifications to accept.`
      : `The seller added GitHub user "${cleanUsername}" to "${repo.fullName}".`,
    createdAt: now,
  }).catch(() => {});

  if (room.buyerUid) {
    await db.collection('users').doc(room.buyerUid).collection('notifications').add({
      type:      'github_collaborator_invited',
      title:     'GitHub repo access shared',
      body:      `The seller shared access to "${repo.fullName}". Check your GitHub notifications to accept.`,
      chatRoomId,
      dealId,
      read:      false,
      createdAt: now,
    }).catch(() => {});
  }

  return res.status(200).json({
    success: true,
    status: collabState.githubCollaboratorStatus,
    repoFullName: repo.fullName,
    repoHtmlUrl: repo.htmlUrl,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// github-collaborator-status  { idToken, chatRoomId }
// Either participant in the deal can check the current repo-sharing state.
// ─────────────────────────────────────────────────────────────────────────────
async function handleGithubCollaboratorStatus(req, res, idToken) {
  const { chatRoomId } = req.body || {};
  if (!chatRoomId) return res.status(400).json({ error: 'Missing chatRoomId' });

  const fbUser = await verifyFirebaseToken(idToken);
  const uid    = fbUser.localId;

  const db      = getAdminDb();
  const roomSnap = await db.collection('dealChats').doc(chatRoomId).get();
  if (!roomSnap.exists) return res.status(404).json({ error: 'Deal not found' });
  const room = roomSnap.data();

  if (room.sellerUid !== uid && room.buyerUid !== uid) {
    return res.status(403).json({ error: 'Not a participant in this deal' });
  }

  let repo = null;
  if (room.listingId) {
    const listingSnap = await db.collection('listings').doc(room.listingId).get();
    if (listingSnap.exists) repo = listingSnap.data().attachedRepo || null;
  }

  return res.status(200).json({
    success: true,
    repo,
    isSeller: room.sellerUid === uid,
    status: room.githubCollaboratorStatus || 'none',
    githubCollaboratorUsername: room.githubCollaboratorUsername || null,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// check-deal-expiry  { idToken, chatRoomId }
// Client-safe fallback: any participant in the room can trigger a
// check-and-resolve of their own deal if its deadline has passed. Silently
// no-ops if the deadline hasn't been reached yet — safe to call on every
// deal chat open.
// ─────────────────────────────────────────────────────────────────────────────
async function handleCheckDealExpiry(req, res, idToken) {
  const { chatRoomId } = req.body;
  if (!chatRoomId) return res.status(400).json({ error: 'Missing chatRoomId' });

  const fbUser = await verifyFirebaseToken(idToken);
  const uid    = fbUser.localId;

  const db      = getAdminDb();
  const roomRef = db.collection('dealChats').doc(chatRoomId);
  const roomSnap = await roomRef.get();
  if (!roomSnap.exists) return res.status(404).json({ error: 'Deal not found' });
  const room = roomSnap.data();

  if (room.sellerUid !== uid && room.buyerUid !== uid) {
    return res.status(403).json({ error: 'Not a participant in this deal' });
  }

  const { outcome } = await _resolveExpiredRoomIfDue(db, chatRoomId, room, Date.now());
  return res.status(200).json({ success: true, outcome });
}

// ═════════════════════════════════════════════════════════════════════════
// AI AGENT — folded in from the former standalone /api/agent.js, purely to
// stay under the hobby-plan serverless function count (each separate file
// under /api counts as its own function/endpoint slot). This section owns:
// plan eligibility, daily request quota, scheduling (cron sweep + per-deal
// trigger), and price-drop/auto-relist automations.
//
// It does NOT reimplement accept/reject — that's settleDealCore above,
// the exact same transaction + chat-room + email/notification path a
// manual seller accept/reject goes through in this file. And it does NOT
// keep its own AI client — every model call here goes through aistudio.js's
// 'agent-deal-decision' / 'agent-auto-reply' actions via the shared
// AISTUDIO_INTERNAL_TOKEN, the same way aistudio.js's own internal actions
// (triage, feedback-dedupe) authenticate each other.
//
// Routes handled by the main `handler` above:
//   GET  /api/deal?action=agent-sweep            (Vercel Cron, every minute;
//                                                  reuses CRON_SECRET)
//   GET  /api/deal?action=agent-limits&uid=...    (public, read-only)
//   POST /api/deal  { action:'agent-check-key-limit', idToken }
//   POST /api/deal  { action:'agent-create-key', idToken, label }
//
// runAgentForSeller(sellerUid, dealId) is called directly (in-process, no
// HTTP hop) right after a deal is created, above.
//
// The "counter-offer" feature the old agent.js had has been removed: this
// file has no counterOffer field or negotiation mechanism anywhere in the
// real deal lifecycle, so it was writing to a field nothing else ever read.
// If negotiation becomes a real feature here, the agent can re-gain a
// "counter" action at that point, not before.
// ═════════════════════════════════════════════════════════════════════════

const AGENT_PLAN_LIMITS = {
  free:    { rpd: 5,    maxKeys: 1  },
  starter: { rpd: 75,   maxKeys: 3  },
  growth:  { rpd: 350,  maxKeys: 5  },
  pro:     { rpd: 1000, maxKeys: 10 },
};
const AGENT_ALLOWED_PLANS = ['free', 'starter', 'growth', 'pro'];

function agentTodayUTC() {
  return new Date().toISOString().slice(0, 10);
}

// ── AI Studio client — every model call the agent needs goes through
// aistudio.js's shared router/fallback-chain/usage-tracking, authenticated
// as a server-to-server internal call. ──────────────────────────────────────
async function callAiStudio(action, payload) {
  if (!process.env.AISTUDIO_INTERNAL_TOKEN) {
    console.warn(`[deal.js/agent] AISTUDIO_INTERNAL_TOKEN not set — skipping ${action}`);
    return null;
  }
  try {
    const res = await fetch(`${SITE_ORIGIN}/api/aistudio`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-token': process.env.AISTUDIO_INTERNAL_TOKEN,
      },
      body: JSON.stringify({ action, ...payload }),
    });
    if (!res.ok) {
      console.error(`[deal.js/agent] aistudio ${action} returned ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error(`[deal.js/agent] aistudio ${action} call failed:`, err.message);
    return null;
  }
}

/**
 * Atomically check + increment the daily usage counter.
 * Never throws — on any Firestore error it allows the action to avoid
 * blocking users over an infra hiccup.
 */
async function agentCheckAndIncrementQuota(db, uid, plan) {
  const limits = AGENT_PLAN_LIMITS[plan] ?? AGENT_PLAN_LIMITS.free;
  const rpd    = limits.rpd;
  const today  = agentTodayUTC();
  const metaRef = db.collection('users').doc(uid).collection('agentMeta').doc('daily');

  try {
    let allowed = false;
    let finalCount = 0;
    await db.runTransaction(async tx => {
      const snap = await tx.get(metaRef);
      const data = snap.exists ? snap.data() : {};
      const count = (data.date === today) ? (data.count || 0) : 0;
      if (count >= rpd) { allowed = false; finalCount = count; return; }
      allowed = true;
      finalCount = count + 1;
      tx.set(metaRef, { date: today, count: finalCount, plan, updatedAt: FieldValue.serverTimestamp() }, { merge: false });
    });
    return { allowed, used: finalCount, limit: rpd, plan };
  } catch (err) {
    console.warn('[deal.js/agent] quota check error (allowing):', err.message);
    return { allowed: true, used: 0, limit: rpd, plan };
  }
}

async function agentVerifyEligible(db, uid, agentConfig) {
  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) return { ok: false, reason: 'User not found' };

  const userData = userSnap.data();
  const plan     = userData.plan || 'free';
  if (!AGENT_ALLOWED_PLANS.includes(plan)) {
    return { ok: false, reason: `Unknown plan: ${plan}` };
  }

  const keyId = agentConfig?.keyId;
  if (!keyId) return { ok: false, reason: 'No API key linked to agent' };

  const keySnap = await db.collection('apiKeys').doc(keyId).get();
  if (!keySnap.exists) return { ok: false, reason: 'Linked API key not found' };

  const keyData = keySnap.data();
  if (keyData.ownerUid !== uid) return { ok: false, reason: 'API key does not belong to this user' };
  if (keyData.active === false) return { ok: false, reason: 'Linked API key has been revoked' };

  return { ok: true, plan, keyId };
}

async function agentProcessUser(db, uid, agentConfig, results) {
  const eligibility = await agentVerifyEligible(db, uid, agentConfig);
  if (!eligibility.ok) {
    results.skipped.push({ uid, reason: eligibility.reason });
    await db.collection('users').doc(uid).collection('agentLog').add({
      type: 'skipped',
      msg:  `Agent did not run: ${eligibility.reason}.`,
      ts:   FieldValue.serverTimestamp(),
    }).catch(() => {});
    if (eligibility.reason.includes('API key')) {
      await db.collection('users').doc(uid).update({ 'agentConfig.active': false }).catch(() => {});
      await db.collection('users').doc(uid).collection('agentLog').add({
        type: 'deactivated',
        msg:  `Agent auto-deactivated: ${eligibility.reason}`,
        ts:   FieldValue.serverTimestamp(),
      }).catch(() => {});
    }
    return;
  }

  const quota = await agentCheckAndIncrementQuota(db, uid, eligibility.plan);
  if (!quota.allowed) {
    results.skipped.push({ uid, reason: `Daily limit reached (${quota.used}/${quota.limit} requests used · ${eligibility.plan} plan)` });
    const today   = agentTodayUTC();
    const metaRef = db.collection('users').doc(uid).collection('agentMeta').doc('daily');
    const meta    = (await metaRef.get()).data() || {};
    if (meta.lastQuotaLogDate !== today) {
      await metaRef.set({ lastQuotaLogDate: today }, { merge: true }).catch(() => {});
      await db.collection('users').doc(uid).collection('agentLog').add({
        type: 'quota_hit',
        msg:  `Daily request limit reached (${quota.limit} RPD on ${eligibility.plan} plan). Resets tomorrow UTC.`,
        ts:   FieldValue.serverTimestamp(),
      }).catch(() => {});
    }
    return;
  }

  try {
    await agentHandlePendingDeals(db, uid, agentConfig, results);
    if (agentConfig.autoReply?.enabled)  await agentHandleUnrepliedMessages(db, uid, agentConfig, results);
    if (agentConfig.priceDrop?.enabled)  await agentHandlePriceDrop(db, uid, agentConfig, results);
    if (agentConfig.autoRelist?.enabled) await agentHandleAutoRelist(db, uid, agentConfig, results);
  } catch (err) {
    results.errors.push({ uid, error: err.message });
    await db.collection('users').doc(uid).collection('agentLog').add({
      type: 'error',
      msg:  `Agent run failed: ${err.message}`,
      ts:   FieldValue.serverTimestamp(),
    }).catch(() => {});
  }
}

// Called directly (in-process) right after create-deal, above — lets the
// seller's agent look at the new deal immediately instead of waiting for
// the next cron tick.
export async function runAgentForSeller(sellerUid, dealId) {
  const db = getAdminDb();
  const sellerSnap = await db.collection('users').doc(sellerUid).get();
  if (!sellerSnap.exists) return;
  const agentConfig = sellerSnap.data().agentConfig;
  if (!agentConfig?.active) return;
  const results = { processed: [], errors: [], skipped: [] };
  await agentProcessUser(db, sellerUid, agentConfig, results);
  return results;
}

// ── A. Pending deals — decide via aistudio.js, settle via settleDealCore ────
async function agentHandlePendingDeals(db, uid, agentConfig, results) {
  const snap = await db.collection('users').doc(uid)
    .collection('deals')
    .where('status', '==', 'pending')
    .where('agentHandled', '==', false)
    .orderBy('createdAt', 'desc')
    .limit(10)
    .get();
  if (snap.empty) return;

  for (const docSnap of snap.docs) {
    const dealId = docSnap.id;
    const deal   = docSnap.data();
    if (deal.buyerUid === uid) continue;

    try {
      const decision = await agentDecideDeal(deal, agentConfig);

      if (decision.action === 'hold') {
        await db.collection('users').doc(uid).collection('agentLog').add({
          type: 'hold',
          msg:  `Agent left deal from ${deal.buyerName || 'buyer'} for "${deal.listingTitle}" pending for your review: ${decision.reason || 'not confident enough to decide automatically'}.`,
          ts:   FieldValue.serverTimestamp(),
        });
        results.processed.push({ uid, dealId, action: 'hold' });
        continue;
      }

      let settleResult;
      try {
        settleResult = await settleDealCore({ callerUid: uid, dealId, action: decision.action });
      } catch (err) {
        if (err.code === 'ALREADY_SETTLED') {
          results.skipped.push({ uid, dealId, reason: `Deal already ${err.status || 'resolved'} before agent could act` });
          continue;
        }
        throw err;
      }

      await db.collection('users').doc(uid).collection('deals').doc(dealId)
        .update({ agentHandled: true, agentAction: decision.action }).catch(() => {});

      await db.collection('users').doc(uid).collection('agentLog').add({
        type: decision.action === 'accept' ? 'auto_accept' : 'auto_reject',
        msg:  decision.action === 'accept'
          ? `Agent auto-accepted deal from ${deal.buyerName || 'buyer'} for "${deal.listingTitle}".`
          : `Agent auto-rejected deal from ${deal.buyerName || 'buyer'} for "${deal.listingTitle}". Reason: ${decision.reason || 'below floor'}.`,
        ts: FieldValue.serverTimestamp(),
      });

      results.processed.push({ uid, dealId, action: decision.action, chatRoomId: settleResult?.chatRoomId });
    } catch (err) {
      results.errors.push({ uid, dealId, error: err.message });
      await db.collection('users').doc(uid).collection('agentLog').add({
        type: 'error',
        msg:  `Agent failed to process deal for "${deal.listingTitle || 'a listing'}": ${err.message}`,
        ts:   FieldValue.serverTimestamp(),
      }).catch(() => {});
    }
  }
}

async function agentDecideDeal(deal, agentConfig) {
  const { autoAccept, autoReject } = agentConfig;
  const offerPrice  = deal.offerPrice   ?? deal.listingPrice ?? 0;
  const listedPrice = deal.listingPrice ?? 0;

  // minPercent is a percentage of the listing's own price (e.g. 80 = must
  // offer >= 80% of listed price), not a flat dollar figure — a single
  // seller's listings can range from a $200 site to a $50k app, so a fixed
  // minPrice would either block everything on the cheap listing or accept
  // lowball offers on the expensive one.
  const minPercent = autoAccept?.minPercent ?? 100;
  const minAcceptAmount = listedPrice > 0 ? listedPrice * (minPercent / 100) : null;

  if (autoAccept?.enabled && minAcceptAmount != null && offerPrice >= minAcceptAmount) {
    return { action: 'accept', reason: 'Meets minimum offer percentage' };
  }
  if (autoReject?.enabled && offerPrice < (autoReject.floor ?? 0)) {
    return { action: 'reject', reason: 'Below floor price' };
  }

  const aiResult = await callAiStudio('agent-deal-decision', {
    listingTitle: deal.listingTitle,
    listingPrice: listedPrice,
    offerPrice,
    buyerMessage: deal.message || deal.introMessage || '',
    autoAcceptMinPercent: autoAccept?.minPercent ?? null,
    autoRejectFloor: autoReject?.floor ?? null,
  });

  if (!aiResult || !aiResult.action) {
    return { action: 'hold', reason: 'AI Studio unavailable — left for manual review' };
  }
  return { action: aiResult.action, reason: aiResult.reason };
}

// ── B. Auto-reply ────────────────────────────────────────────────────────
async function agentHandleUnrepliedMessages(db, uid, agentConfig, results) {
  const threadsSnap = await db.collection('users').doc(uid)
    .collection('threads')
    .where('isDealChat', '==', true)
    .where('sellerUid',  '==', uid)
    .where('unread',     '==', true)
    .limit(5)
    .get();
  if (threadsSnap.empty) return;

  for (const threadDoc of threadsSnap.docs) {
    const { chatRoomId, listingTitle, expiresAt } = threadDoc.data();
    if (!chatRoomId) continue;
    if (expiresAt && Date.now() > expiresAt) continue;

    try {
      const msgsSnap = await db.collection('dealChats').doc(chatRoomId)
        .collection('messages').orderBy('createdAt', 'desc').limit(5).get();
      if (msgsSnap.empty) continue;

      const msgs     = msgsSnap.docs.map(d => d.data());
      const buyerMsg = msgs.find(m => m.uid !== uid && m.uid !== 'system' && !m.isAgent && m.type === 'text');
      if (!buyerMsg) continue;

      const sellerMsg = msgs.find(m => m.uid === uid);
      if (sellerMsg && (sellerMsg.createdAt || 0) >= (buyerMsg.createdAt || 0)) continue;

      const tone = agentConfig.autoReply?.tone || 'professional';
      const aiResult = await callAiStudio('agent-auto-reply', { listingTitle, buyerMessage: buyerMsg.text, tone });
      if (!aiResult?.reply) continue;

      const now = Date.now();
      await db.collection('dealChats').doc(chatRoomId).collection('messages').add({
        uid, senderName: 'Agent (Auto-Reply)', text: aiResult.reply,
        type: 'text', isAgent: true, createdAt: now,
      });
      await db.collection('users').doc(uid).collection('threads').doc(chatRoomId)
        .update({ unread: false, lastMessage: aiResult.reply, lastAt: now });
      await db.collection('users').doc(uid).collection('agentLog').add({
        type: 'auto_reply',
        msg:  `Agent auto-replied in deal chat for "${listingTitle}".`,
        ts:   FieldValue.serverTimestamp(),
      });

      results.processed.push({ uid, chatRoomId, action: 'auto_reply' });
    } catch (err) {
      results.errors.push({ uid, chatRoomId: threadDoc.id, error: err.message });
    }
  }
}

// ── C. Price drop ────────────────────────────────────────────────────────
async function agentHandlePriceDrop(db, uid, agentConfig, results) {
  const pct      = agentConfig.priceDrop?.pct  || 10;
  const days     = agentConfig.priceDrop?.days || 7;
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;

  const snap = await db.collection('listings')
    .where('ownerId', '==', uid)
    .where('status',  '==', 'active')
    .get();

  for (const docSnap of snap.docs) {
    const listing   = docSnap.data();
    const createdAt = listing.createdAt?.toMillis?.() ?? listing.createdAt ?? Date.now();
    const price     = listing.financials?.price ?? listing.price ?? null;
    if (price == null || createdAt > cutoffMs) continue;
    if (listing.lastPriceDropAt && listing.lastPriceDropAt > cutoffMs) continue;

    const newPrice = Math.max(1, Math.round(price * (1 - pct / 100)));
    await db.collection('listings').doc(docSnap.id).update({
      'financials.price': newPrice,
      price:              newPrice,
      lastPriceDropAt:    Date.now(),
    });
    await db.collection('users').doc(uid).collection('agentLog').add({
      type: 'price_drop',
      msg:  `Agent dropped "${listing.title}" $${price} → $${newPrice} (${pct}% after ${days} days).`,
      ts:   FieldValue.serverTimestamp(),
    });
    results.processed.push({ uid, listingId: docSnap.id, action: 'price_drop', from: price, to: newPrice });
  }
}

// ── D. Auto-relist ───────────────────────────────────────────────────────
async function agentHandleAutoRelist(db, uid, agentConfig, results) {
  const maxCount = agentConfig.autoRelist?.maxCount || 3;

  const snap = await db.collection('listings')
    .where('ownerId', '==', uid)
    .where('status',  '==', 'inactive')
    .get();

  for (const docSnap of snap.docs) {
    const listing     = docSnap.data();
    const relistCount = listing.relistCount || 0;
    if (relistCount >= maxCount) continue;

    await db.collection('listings').doc(docSnap.id).update({
      status:      'active',
      relistCount: relistCount + 1,
      relistedAt:  Date.now(),
    });
    await db.collection('users').doc(uid).collection('agentLog').add({
      type: 'relist',
      msg:  `Agent re-listed "${listing.title}" (${relistCount + 1}/${maxCount} relists used).`,
      ts:   FieldValue.serverTimestamp(),
    });
    results.processed.push({ uid, listingId: docSnap.id, action: 'relist', count: relistCount + 1 });
  }
}

// ── Route handlers, wired into the main `handler` switch above ──────────

// GET /api/deal?action=agent-sweep — Vercel Cron, every minute. Reuses
// CRON_SECRET (same secret as sweep-expired-deals) rather than introducing
// a second cron secret for what is, from an auth standpoint, an identical
// "trusted scheduler" situation.
async function handleAgentSweep(req, res) {
  const db = getAdminDb();
  const results = { processed: [], errors: [], skipped: [] };

  const usersSnap = await db.collection('users').where('agentConfig.active', '==', true).get();
  if (usersSnap.empty) return res.status(200).json({ msg: 'No active agents' });

  await Promise.all(usersSnap.docs.map(async userDoc => {
    const uid         = userDoc.id;
    const agentConfig = userDoc.data().agentConfig;
    if (!agentConfig?.active) return;
    await agentProcessUser(db, uid, agentConfig, results);
  }));

  return res.status(200).json(results);
}

// GET /api/deal?action=agent-limits&uid=... — public, read-only. Populates
// the plan/usage cards in the frontend without hardcoding limits there.
async function handleAgentLimits(req, res) {
  const { uid } = req.query || {};
  if (!uid) return res.status(400).json({ error: 'Missing uid' });

  const db       = getAdminDb();
  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });

  const plan  = userSnap.data().plan || 'free';
  const today = agentTodayUTC();

  let usedToday = 0;
  try {
    const metaSnap = await db.collection('users').doc(uid).collection('agentMeta').doc('daily').get();
    if (metaSnap.exists && metaSnap.data().date === today) usedToday = metaSnap.data().count || 0;
  } catch {}

  let keyCount = 0;
  try {
    const keyIds = userSnap.data().apiKeyIds || [];
    if (keyIds.length) {
      const snaps = await Promise.all(keyIds.map(id => db.collection('apiKeys').doc(id).get()));
      keyCount = snaps.filter(s => s.exists && s.data().active).length;
    }
  } catch {}

  const planLimits = AGENT_PLAN_LIMITS[plan] ?? AGENT_PLAN_LIMITS.free;
  return res.status(200).json({
    plan, rpd: planLimits.rpd, maxKeys: planLimits.maxKeys, usedToday, keyCount,
    allPlans: AGENT_PLAN_LIMITS,
  });
}

// POST /api/deal  { action:'agent-check-key-limit', idToken }
async function handleAgentCheckKeyLimit(req, res, idToken) {
  const fbUser = await verifyFirebaseToken(idToken);
  const uid    = fbUser.localId;
  const db     = getAdminDb();

  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });

  const plan   = userSnap.data().plan || 'free';
  const keyIds = userSnap.data().apiKeyIds || [];
  const limits = AGENT_PLAN_LIMITS[plan] ?? AGENT_PLAN_LIMITS.free;

  let activeCount = 0;
  if (keyIds.length) {
    const snaps = await Promise.all(keyIds.map(id => db.collection('apiKeys').doc(id).get()));
    activeCount = snaps.filter(s => s.exists && s.data().active).length;
  }

  return res.status(200).json({ allowed: activeCount < limits.maxKeys, activeCount, maxKeys: limits.maxKeys, plan });
}

// POST /api/deal  { action:'agent-create-key', idToken, label }
function agentRandomKeySuffix() {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

async function agentGenerateUniqueKey(db, uname) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const ts      = Date.now().toString(36);
    const fullKey = `srf_${uname}_${ts}_${agentRandomKeySuffix()}`;
    const dupe    = await db.collection('apiKeys').where('key', '==', fullKey).limit(1).get();
    if (dupe.empty) return fullKey;
  }
  throw new Error('Could not generate a unique API key, please try again');
}

async function handleAgentCreateKey(req, res, idToken) {
  const { label } = req.body || {};
  const fbUser = await verifyFirebaseToken(idToken);
  const uid    = fbUser.localId;
  const db     = getAdminDb();

  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });
  const userData = userSnap.data();

  const plan   = userData.plan || 'free';
  const keyIds = userData.apiKeyIds || [];
  const limits = AGENT_PLAN_LIMITS[plan] ?? AGENT_PLAN_LIMITS.free;

  let activeCount = 0;
  if (keyIds.length) {
    const snaps = await Promise.all(keyIds.map(id => db.collection('apiKeys').doc(id).get()));
    activeCount = snaps.filter(s => s.exists && s.data().active).length;
  }
  if (activeCount >= limits.maxKeys) {
    return res.status(403).json({ error: 'Key limit reached', activeCount, maxKeys: limits.maxKeys, plan });
  }

  const uname   = (userData.username || 'user').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 8) || 'user';
  const fullKey = await agentGenerateUniqueKey(db, uname);
  const prefix  = fullKey.slice(0, 16) + '…';
  const keyName = (label || 'My Key').toString().slice(0, 60);

  const keyRef = await db.collection('apiKeys').add({
    ownerUid: uid, ownerUsername: uname, key: fullKey, prefix, label: keyName,
    active: true, createdAt: FieldValue.serverTimestamp(),
    capabilities: ['auto_accept_deals', 'group_management', 'message_moderate'],
  });
  await db.collection('users').doc(uid).update({ apiKeyIds: FieldValue.arrayUnion(keyRef.id) });

  return res.status(200).json({
    id: keyRef.id, label: keyName, prefix,
    created: new Date().toISOString().slice(0, 10), active: true,
  });
}

export const config = {
  api: { bodyParser: { sizeLimit: '16kb' } },
};

// Additive export, same convention as listings/_handler.js's export of
// _maybeCloseAuction/handleSearch below its own default handler — this
// file was previously only exported as the default HTTP handler.
// settleDealCore is reused by listings/_handler.js's auction auto-close
// path (_maybeCloseAuction -> auto-creates + auto-accepts a deal for the
// winning bidder at auction end) via the exact same accept transaction
// a seller's manual "Accept" click runs, so chat-room creation, escrow
// eligibility, and notifications are identical to any other accepted deal.
export { settleDealCore };
