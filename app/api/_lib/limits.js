// /api/limits.js — Siterifty single source of truth for all business limits.
//
// GET /api/limits                → public limits (no auth needed)
// GET /api/limits?uid=...        → public limits + personalised rate-limit
//                                  status for that user (reads Firestore)
// POST /api/limits { action }
//   action: 'check-username-change' { idToken } → { allowed, msLeft, daysLeft }
//   action: 'check-email-change'    { idToken } → { allowed, changesLeft, daysLeft }
//   action: 'check-listing-cap'     { idToken } → { allowed, used, max, unlimited }
//
// ── Deal & escrow actions ─────────────────────────────────────────────────────
// All deal and escrow mutations have been moved to /api/deal (deal.js).
// Frontend should POST to /api/deal with the same { action, idToken, ...params }
// shape. See deal.js for the full action list and documentation.

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore }                  from 'firebase-admin/firestore';

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

// ── Firebase ID token verification ───────────────────────────────────────────
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

// ═════════════════════════════════════════════════════════════════════════════
// THE LIMITS OBJECT — change values here, nowhere else.
// ═════════════════════════════════════════════════════════════════════════════
export const LIMITS = {

  // ── Plan pricing ──────────────────────────────────────────────────────────
  plans: {
    free: {
      name:       'Free',
      price:      0,          // $/month
      color:      '#71717a',
      tagline:    'Get started for free',
    },
    starter: {
      name:       'Starter',
      price:      10,
      color:      '#60a5fa',
      tagline:    'For developers listing regularly',
    },
    growth: {
      name:       'Growth',
      price:      20,
      color:      '#a3e635',
      tagline:    'For serious sellers scaling up',
    },
    pro: {
      name:       'Pro',
      price:      30,
      color:      '#d8b4fe',
      tagline:    'For high-volume power sellers',
    },
  },

  // ── Platform fee per sale, by plan (decimal, e.g. 0.30 = 30%) ─────────────
  saleFees: {
    free:    0.20,
    starter: 0.15,
    growth:  0.10,
    pro:     0.05,
  },

  // ── Weekly listing quota per plan (null = unlimited) ──────────────────────
  weeklyListingLimit: {
    free:    5,
    starter: 15,
    growth:  30,
    pro:     null,   // unlimited
  },

  // ── Daily edit quota per LISTING, per plan (null = unlimited) ─────────────
  // Caps how many times a single listing can be saved via listing.update in
  // a rolling day — protects write volume from runaway/accidental repeat
  // saves (e.g. a stuck retry loop) without limiting a seller working across
  // several different listings. Tracked per-listing (editCount/editDay
  // fields on the listing doc itself — see handleUpdate in listings.js),
  // not per-owner, so editing one listing a lot never throttles a seller's
  // other listings. Deliberately more generous than weeklyListingLimit
  // since a normal edit session (price tweak, typo fix, swapping a
  // screenshot a few times) is much lower-stakes than publishing a new
  // listing.
  dailyEditLimit: {
    free:    10,
    starter: 25,
    growth:  50,
    pro:     null,   // unlimited
  },

  // ── Wallet ────────────────────────────────────────────────────────────────
  wallet: {
    depositMin:     5,       // minimum deposit in USD
    depositMax:     10000,   // maximum deposit in USD
    withdrawMin:    10,      // minimum withdrawal in USD
    withdrawMax:    10000,   // maximum withdrawal in USD
    withdrawFee:    0.05,    // 5% platform fee on withdrawals
    transferFee:    0.05,    // 5% platform fee on wallet-to-wallet transfers
    transferMin:    1,       // minimum transfer in USD
    transferMax:    10000,   // maximum transfer in USD
  },

  // ── Auto Top-Up (paypal.js) — mirrored here so the frontend never
  //    hardcodes its own copy of these bounds ─────────────────────────────
  autoTopUp: {
    minThreshold: 1,
    maxThreshold: 5000,
    minAmount:    5,
    maxAmount:    10000,
  },

  // ── Auto Send (paypal.js) — allowed recurring intervals, in days ─────────
  autoSend: {
    intervals: [1, 3, 7, 14, 21, 30],
  },

  // ── Auto Withdrawal (paypal.js) — mirrored here so the frontend never
  //    hardcodes its own copy of these bounds. keepBalance is how much the
  //    user chooses to leave in their wallet when an auto withdrawal fires;
  //    it must stay below whatever threshold they set (enforced in paypal.js). ─
  autoWithdraw: {
    minThreshold:   10,
    maxThreshold:   10000,
    minKeepBalance: 0,
    maxKeepBalance: 10000,
  },

  // ── Boost listing pricing (paypal.js BOOST_PLANS) — mirrored here for
  //    frontend display only; paypal.js is still the source that's actually
  //    enforced server-side and never trusts a client-sent price ──────────
  boost: {
    plans: [
      { days: 1,  price: 2.99 },
      { days: 3,  price: 6.99 },
      { days: 7,  price: 12.99 },
      { days: 14, price: 19.99 },
      { days: 21, price: 27.99 },
      { days: 30, price: 34.99 },
    ],
  },

  // ── Username ──────────────────────────────────────────────────────────────
  username: {
    minLength:      5,
    maxLength:      15,
    pattern:        '^[a-zA-Z0-9_.-]+$',
    patternHint:    'Letters, numbers, underscores, hyphens, and dots only.',
    changeCooldownMs: 7 * 24 * 60 * 60 * 1000,  // 7 days between changes
  },

  // ── Profile picture ─────────────────────────────────────────────────────
  // NOTE: the client (profile.js) always called action:'check-profilepic-
  // change' before every avatar upload, but no version of the original
  // backend ever implemented that action or defined a cooldown constant for
  // it — genuinely missing, not just unported. 7 days mirrors the username
  // cooldown immediately above (same category of identity-ish profile
  // field); adjust here if a different value is wanted, this is the only
  // place it's read from.
  profilePic: {
    changeCooldownMs: 7 * 24 * 60 * 60 * 1000,  // 7 days between changes
  },

  // ── Contact email changes ─────────────────────────────────────────────────
  contactEmail: {
    maxChangesPerPeriod: 2,
    periodMs:            30 * 24 * 60 * 60 * 1000,  // 30-day rolling window
  },

  // ── Listing content ───────────────────────────────────────────────────────
  listing: {
    titleMinLength: 3,
    titleMaxLength: 99,
    descMinLength:  100,
    descMaxLength:  5000,
    priceMin:       0,
    priceMax:       10000,   // also used as marketplace filter cap (PRICE_CAP)
    descPreviewWords: 50,    // truncate in listing cards after this many words
  },

  // ── Marketplace ───────────────────────────────────────────────────────────
  marketplace: {
    priceCap: 10000,         // slider / filter upper bound
  },

  // ── Deals ─────────────────────────────────────────────────────────────────
  deals: {
    messageMinLength:    30,
    pendingChatExpiryMs: 7 * 24 * 60 * 60 * 1000,  // 7 days to resolve an accepted deal
    outcomePollMs:        6000,                     // how long the buyer UI waits for the agent
  },
};

// ── Derived helpers (computed from LIMITS above, never duplicated) ─────────
export function feeDisplay(plan) {
  const pct = (LIMITS.saleFees[plan] ?? LIMITS.saleFees.free) * 100;
  return pct % 1 === 0 ? `${pct}%` : `${pct.toFixed(1)}%`;
}

export function planDesc(plan) {
  const p  = LIMITS.plans[plan];
  const wl = LIMITS.weeklyListingLimit[plan];
  const fee = feeDisplay(plan);
  if (!p) return '';
  if (plan === 'free') return `Free — ${wl} listings/week, basic features · ${fee} fee`;
  const wlStr = wl === null ? 'Unlimited listings' : `${wl} listings/week`;
  return `${p.name} — $${p.price}/mo · ${wlStr} · ${fee} fee`;
}

// ── Serialisable version safe to send to frontend ─────────────────────────
// (converts null → 'unlimited' for weekly limits, adds display strings)
function publicPayload() {
  const plans = {};
  for (const [key, p] of Object.entries(LIMITS.plans)) {
    const wl = LIMITS.weeklyListingLimit[key];
    const del = LIMITS.dailyEditLimit[key];
    plans[key] = {
      ...p,
      price:        p.price,
      saleFee:      LIMITS.saleFees[key],
      saleFeeDisplay: feeDisplay(key),
      weeklyListings: wl,           // null = unlimited
      unlimited:    wl === null,
      dailyEditsPerListing: del,    // null = unlimited
      description:  planDesc(key),
    };
  }

  return {
    plans,
    wallet:       LIMITS.wallet,
    autoTopUp:    LIMITS.autoTopUp,
    autoSend:     LIMITS.autoSend,
    autoWithdraw: LIMITS.autoWithdraw,
    boost:        LIMITS.boost,
    username:     LIMITS.username,
    contactEmail: LIMITS.contactEmail,
    listing:      LIMITS.listing,
    marketplace:  LIMITS.marketplace,
    deals:        LIMITS.deals,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // ── GET /api/limits  — serve the full limits object ───────────────────────
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'public, max-age=300'); // 5-min CDN cache
    return res.status(200).json(publicPayload());
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action, idToken } = req.body || {};

  if (!idToken) return res.status(401).json({ error: 'Missing auth token' });

  try {
    switch (action) {
      case 'check-username-change': return await handleCheckUsername(req, res, idToken);
      case 'check-email-change':    return await handleCheckEmail(req, res, idToken);
      case 'check-listing-cap':     return await handleCheckListingCap(req, res, idToken);
      case 'check-profilepic-change': return await handleCheckProfilePic(req, res, idToken);
      // Deal actions moved to /api/deal — forward callers with a helpful error
      case 'create-deal':
      case 'accept-deal':
      case 'reject-deal':
      case 'cancel-deal':
        return res.status(301).json({
          error: `"${action}" has moved to /api/deal. Please update your client to POST to /api/deal instead.`,
        });
      default:
        return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (err) {
    console.error('[limits.js]', action, err.message);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// check-username-change  { idToken }
// → { allowed, msLeft, daysLeft }
// ─────────────────────────────────────────────────────────────────────────────
async function handleCheckUsername(req, res, idToken) {
  const fbUser = await verifyFirebaseToken(idToken);
  const uid = fbUser.localId;

  const db   = getAdminDb();
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) return res.status(404).json({ error: 'User not found' });

  const lastChange = snap.data().usernameChangedAt?.toMillis?.() || 0;
  const msLeft     = (lastChange + LIMITS.username.changeCooldownMs) - Date.now();
  const allowed    = msLeft <= 0;
  const daysLeft   = allowed ? 0 : Math.ceil(msLeft / (24 * 60 * 60 * 1000));

  return res.status(200).json({ allowed, msLeft: Math.max(0, msLeft), daysLeft });
}

// ─────────────────────────────────────────────────────────────────────────────
// check-profilepic-change  { idToken }
// → { allowed, msLeft, daysLeft }
// Mirrors handleCheckUsername exactly — same shape, just reads
// profilePicChangedAt (written by profile.js's avatar upload flow) against
// LIMITS.profilePic.changeCooldownMs instead. This action never had a
// backend implementation anywhere in the original codebase; see the
// LIMITS.profilePic comment above for why 7 days was chosen here.
// ─────────────────────────────────────────────────────────────────────────────
async function handleCheckProfilePic(req, res, idToken) {
  const fbUser = await verifyFirebaseToken(idToken);
  const uid = fbUser.localId;

  const db   = getAdminDb();
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) return res.status(404).json({ error: 'User not found' });

  const lastChange = snap.data().profilePicChangedAt?.toMillis?.() || 0;
  const msLeft     = (lastChange + LIMITS.profilePic.changeCooldownMs) - Date.now();
  const allowed    = msLeft <= 0;
  const daysLeft   = allowed ? 0 : Math.ceil(msLeft / (24 * 60 * 60 * 1000));

  return res.status(200).json({ allowed, msLeft: Math.max(0, msLeft), daysLeft });
}

// ─────────────────────────────────────────────────────────────────────────────
// check-email-change  { idToken }
// → { allowed, changesLeft, daysLeft }
// ─────────────────────────────────────────────────────────────────────────────
async function handleCheckEmail(req, res, idToken) {
  const fbUser = await verifyFirebaseToken(idToken);
  const uid = fbUser.localId;

  const db   = getAdminDb();
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) return res.status(404).json({ error: 'User not found' });

  const { maxChangesPerPeriod, periodMs } = LIMITS.contactEmail;
  const now           = Date.now();
  const emailChanges  = Array.isArray(snap.data().contactEmailChanges) ? snap.data().contactEmailChanges : [];
  const recentChanges = emailChanges.filter(t => (now - t) < periodMs);
  const allowed       = recentChanges.length < maxChangesPerPeriod;
  const changesLeft   = Math.max(0, maxChangesPerPeriod - recentChanges.length);

  let daysLeft = 0;
  if (!allowed) {
    const oldest = Math.min(...recentChanges);
    daysLeft = Math.ceil(((oldest + periodMs) - now) / (24 * 60 * 60 * 1000));
  }

  return res.status(200).json({ allowed, changesLeft, daysLeft });
}

// ─────────────────────────────────────────────────────────────────────────────
// check-listing-cap  { idToken }
// → { allowed, used, max, unlimited, plan }
// ─────────────────────────────────────────────────────────────────────────────
async function handleCheckListingCap(req, res, idToken) {
  const fbUser = await verifyFirebaseToken(idToken);
  const uid = fbUser.localId;

  const db      = getAdminDb();
  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });

  const plan = userSnap.data().plan || 'free';
  const max  = LIMITS.weeklyListingLimit[plan] ?? LIMITS.weeklyListingLimit.free;

  // Compute start of the current week (Sunday 00:00:00 UTC)
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setUTCHours(0, 0, 0, 0);
  weekStart.setUTCDate(now.getUTCDate() - now.getUTCDay());
  const { Timestamp } = await import('firebase-admin/firestore');
  const weekStartTs = Timestamp.fromDate(weekStart);

  const listingsSnap = await db.collection('listings')
    .where('ownerId', '==', uid)
    .where('createdAt', '>=', weekStartTs)
    .get();

  const used      = listingsSnap.size;
  const unlimited = max === null;
  const allowed   = unlimited || used < max;

  return res.status(200).json({
    allowed,
    used,
    max:       unlimited ? null : max,
    unlimited,
    plan,
    saleFee:         LIMITS.saleFees[plan],
    saleFeeDisplay:  feeDisplay(plan),
  });
}

export const config = {
  api: { bodyParser: { sizeLimit: '16kb' } },
};


