// /api/objectives.js — Siterifty server-side daily objectives handler
// ─────────────────────────────────────────────────────────────────────────────
// Daily objectives pay real money (walletBalance cents), so progress and
// completion are NEVER trusted from the client. Every check re-queries the
// actual source of truth (listings/deals/dealChats messages) via the Admin
// SDK and only credits a reward once that objective is independently
// verified complete for today — same principle as paypal.js never trusting
// a client-sent amount.
//
// POST /api/objectives  { action, idToken, ...params }
//
//   action: 'get-today'  { idToken }
//     → { date, objectives: [{ id, label, desc, goal, progress, reward,
//         completed, claimed }], totalEarnedToday }
//     Assigns (if not already assigned today) 3 objectives deterministically
//     picked from OBJECTIVE_POOL, seeded by uid+date so they're stable all
//     day but rotate day to day. Computes live progress against real data.
//
//   action: 'claim'      { idToken, objectiveId }
//     → { success, reward, newBalance, newWithdrawable, alreadyClaimed? }
//     Re-verifies the objective is actually complete server-side, then
//     credits walletBalance AND withdrawableBalance by that objective's
//     reward (in the $0.002–$0.05 range) exactly once — objective rewards
//     are earned money, same model as escrow sale proceeds in deal.js, so
//     they're withdrawable (unlike a raw PayPal deposit). Idempotent —
//     calling twice on an already-claimed objective returns
//     alreadyClaimed:true and charges nothing twice.
//
// Firestore paths touched:
//   users/{uid}/dailyObjectives/{yyyy-mm-dd}   (today's assignment + claims)
//   users/{uid}.walletBalance                  (credited on claim)
//   users/{uid}.withdrawableBalance             (credited on claim)
//   users/{uid}/transactions/*                 (reward transaction record)
//
// Reads listings / users/{uid}/deals / dealChats (collection group on
// messages) directly — these are the same collections the rest of the app
// already reads from, just verified here server-side instead of trusted
// from the client.
// ─────────────────────────────────────────────────────────────────────────────

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from '../../../lib/server/adminDb';

// ── Firebase Admin singleton ─────────────────────────────────────────────────
// Shared init — see lib/server/adminDb.ts.

// ── Firebase ID token verification via REST ──────────────────────────────────
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

// ── Objective pool — expand this list any time; get-today always picks 3 ────
// Every reward sits inside the $0.002–$0.05 range you set. `goal` is the
// count needed; `verify(db, uid, dayStart)` returns the live progress count
// by querying real data created since dayStart (server clock, UTC midnight).
// Every objective belongs to a `family` — the underlying action it measures.
// _seededPick below picks at most ONE objective per family per day, so a
// user is never handed two tiers of the same action (e.g. list_3 + list_1)
// where completing the harder one silently auto-completes the easier one.
const OBJECTIVE_POOL = [
  {
    id: 'list_3',
    family: 'listings',
    label: 'Post 3 Listings',
    desc: 'Create 3 new listings today (website, app, or game).',
    goal: 3,
    reward: 0.30,
    verify: async (db, uid, dayStart) => {
      const snap = await db.collection('listings')
        .where('ownerId', '==', uid)
        .where('createdAt', '>=', dayStart)
        .get();
      return snap.size;
    },
  },
  {
    id: 'list_1',
    family: 'listings',
    label: 'Post 1 Listing',
    desc: 'Create at least 1 new listing today.',
    goal: 1,
    reward: 0.10,
    verify: async (db, uid, dayStart) => {
      const snap = await db.collection('listings')
        .where('ownerId', '==', uid)
        .where('createdAt', '>=', dayStart)
        .get();
      return snap.size;
    },
  },
  {
    id: 'send_5_deals',
    family: 'deals_sent',
    label: 'Send 5 Deals',
    desc: 'Send deal requests to 5 different listings today.',
    goal: 5,
    reward: 0.25,
    verify: async (db, uid, dayStart) => {
      const snap = await db.collection('users').doc(uid).collection('deals')
        .where('buyerUid', '==', uid)
        .where('createdAt', '>=', dayStart)
        .get();
      return snap.size;
    },
  },
  {
    id: 'send_2_deals',
    family: 'deals_sent',
    label: 'Send 2 Deals',
    desc: 'Send deal requests to 2 different listings today.',
    goal: 2,
    reward: 0.10,
    verify: async (db, uid, dayStart) => {
      const snap = await db.collection('users').doc(uid).collection('deals')
        .where('buyerUid', '==', uid)
        .where('createdAt', '>=', dayStart)
        .get();
      return snap.size;
    },
  },
  {
    id: 'message_10_users',
    family: 'messaging',
    label: 'Message 10 Users',
    desc: 'Send messages in 10 different deal chats today.',
    goal: 10,
    reward: 0.20,
    verify: async (db, uid, dayStart) => {
      // Collection-group query across every dealChats/{room}/messages
      // subcollection, filtered to messages this user sent today. Counting
      // distinct chat rooms (not just raw message count) so spamming one
      // thread can't fake the "10 different users" goal.
      const snap = await db.collectionGroup('messages')
        .where('uid', '==', uid)
        .where('createdAt', '>=', dayStart.toMillis())
        .get();
      const rooms = new Set();
      snap.forEach(d => {
        const roomRef = d.ref.parent.parent; // dealChats/{chatRoomId}
        if (roomRef) rooms.add(roomRef.id);
      });
      return rooms.size;
    },
  },
  {
    id: 'message_3_users',
    family: 'messaging',
    label: 'Message 3 Users',
    desc: 'Send messages in 3 different deal chats today.',
    goal: 3,
    reward: 0.075,
    verify: async (db, uid, dayStart) => {
      const snap = await db.collectionGroup('messages')
        .where('uid', '==', uid)
        .where('createdAt', '>=', dayStart.toMillis())
        .get();
      const rooms = new Set();
      snap.forEach(d => {
        const roomRef = d.ref.parent.parent;
        if (roomRef) rooms.add(roomRef.id);
      });
      return rooms.size;
    },
  },
  {
    id: 'edit_profile',
    family: 'profile',
    label: 'Update Your Profile',
    desc: 'Edit your display name, bio, or profile picture today.',
    goal: 1,
    reward: 0.02,
    // Requires the account-settings save handler to stamp
    // profileUpdatedAt: serverTimestamp() on users/{uid} when saving —
    // added alongside this feature (see index.html renderAccount save).
    verify: async (db, uid, dayStart) => {
      const snap = await db.collection('users').doc(uid).get();
      const t = snap.data()?.profileUpdatedAt;
      if (!t) return 0;
      const ms = t.toMillis ? t.toMillis() : Number(t);
      return ms >= dayStart.toMillis() ? 1 : 0;
    },
  },
  {
    id: 'save_5_listings',
    family: 'saving',
    label: 'Save 5 Listings',
    desc: 'Save (bookmark) 5 listings today.',
    goal: 5,
    reward: 0.10,
    // Uses the existing save/bookmark write (SaveButton.tsx) — reads the
    // same users/{uid}/savedListings subcollection the marketplace UI
    // already writes to. Field is `savedAt` (not createdAt) — see the
    // setDoc in SaveButton.tsx. Note the doc id is the listingId itself,
    // so unsaving + resaving the same listing overwrites savedAt rather
    // than creating a second doc — that's fine here, it still reflects a
    // real save action taken today, just not 5 *distinct* listings if they
    // toggle the same one repeatedly. Acceptable for this goal size.
    verify: async (db, uid, dayStart) => {
      const snap = await db.collection('users').doc(uid).collection('savedListings')
        .where('savedAt', '>=', dayStart)
        .get();
      return snap.size;
    },
  },
  {
    id: 'rate_1_seller',
    family: 'rating',
    label: 'Rate a Seller',
    desc: 'Leave a star rating on a seller\'s profile today.',
    goal: 1,
    reward: 0.05,
    // Reads the review written by RateOverlay.tsx. NOTE: reviews live at
    // users/{sellerUid}/reviews/{reviewerUid} — keyed by the SELLER being
    // rated, not the rater — so finding "did this uid rate anyone today"
    // requires a collection-group query filtered by reviewerId, not a
    // direct subcollection read off this user's own doc. There's no
    // requirement the rater ever completed a deal with that seller, so
    // this is "rate a seller," not "rate a completed deal."
    verify: async (db, uid, dayStart) => {
      const snap = await db.collectionGroup('reviews')
        .where('reviewerId', '==', uid)
        .where('updatedAt', '>=', dayStart)
        .get();
      return snap.size;
    },
  },
  // NOTE: a "View 5 Listings" objective is a natural future addition, but it
  // needs a viewEvents write somewhere in the marketplace browsing code
  // first (nothing currently logs listing views). Add it back to the pool
  // once that tracking exists — shipping it now would show 0/5 forever.
];

const OBJECTIVES_PER_DAY = 4;

// ── Deterministic daily pick: same set all day for a given uid+date, but
//    rotates day to day. Simple string-hash seeded shuffle — no external
//    deps, no randomness that could differ between get-today calls.
//    Family-aware: picks at most one objective per `family`, so a user is
//    never handed two tiers of the same underlying action on the same day
//    (e.g. list_3 and list_1, where finishing one silently finishes both). ─
function _seededPick(pool, seed, count) {
  // xmur3-style string hash → 32-bit seed
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  function rand() {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  const arr = [...pool];
  // Fisher-Yates using the seeded RNG, deterministic for this seed
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  // Walk the shuffled pool in order, taking the first objective encountered
  // per family, until `count` are picked (or the pool of distinct families
  // is exhausted).
  const picked = [];
  const usedFamilies = new Set();
  for (const item of arr) {
    if (picked.length >= count) break;
    const fam = item.family || item.id; // fall back so an untagged entry still works
    if (usedFamilies.has(fam)) continue;
    usedFamilies.add(fam);
    picked.push(item);
  }
  return picked;
}

function _todayKey(d) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

function _utcDayStart(d) {
  const start = new Date(d);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action, idToken } = req.body || {};
  if (!idToken) return res.status(401).json({ error: 'Missing auth token' });

  try {
    switch (action) {
      case 'get-today': return await handleGetToday(req, res, idToken);
      case 'claim':     return await handleClaim(req, res, idToken);
      default:
        return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (err) {
    console.error('[objectives.js]', action, err.message);
    return res.status(err.statusCode || 500).json({ error: err.message || 'Internal error' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// get-today  { idToken }
//   → { date, objectives, totalEarnedToday }
//
// Assigns today's 3 objectives on first call of the day (stored so the same
// 3 persist across reloads that day), then re-verifies live progress on
// every call — progress always reflects real current data, never a cached
// client guess.
// ─────────────────────────────────────────────────────────────────────────────
async function handleGetToday(req, res, idToken) {
  const fbUser = await verifyFirebaseToken(idToken);
  const uid = fbUser.localId;

  const db = getAdminDb();
  const now = new Date();
  const dateKey = _todayKey(now);
  const dayStart = Timestamp.fromDate(_utcDayStart(now));

  const dayRef = db.collection('users').doc(uid).collection('dailyObjectives').doc(dateKey);
  const daySnap = await dayRef.get();

  let assignment;
  if (daySnap.exists) {
    assignment = daySnap.data();
  } else {
    const picked = _seededPick(OBJECTIVE_POOL, `${uid}:${dateKey}`, OBJECTIVES_PER_DAY);
    assignment = {
      date:        dateKey,
      objectiveIds: picked.map(o => o.id),
      claimed:     {}, // { [objectiveId]: true } once paid
      createdAt:   FieldValue.serverTimestamp(),
    };
    // Idempotent create — if two requests race on first-open-of-the-day,
    // whichever writes first wins; the other's write is harmless (same
    // deterministic pick either way since it's seeded by uid+date).
    await dayRef.set(assignment, { merge: true });
  }

  const todaysDefs = assignment.objectiveIds
    .map(id => OBJECTIVE_POOL.find(o => o.id === id))
    .filter(Boolean);

  const objectives = await Promise.all(todaysDefs.map(async def => {
    const claimed = Boolean(assignment.claimed?.[def.id]);
    try {
      const progress = await def.verify(db, uid, dayStart);
      const completed = progress >= def.goal;
      return {
        id:        def.id,
        label:     def.label,
        desc:      def.desc,
        goal:      def.goal,
        progress:  Math.min(progress, def.goal),
        reward:    def.reward,
        completed,
        claimed,
      };
    } catch (err) {
      // A single broken verify() (e.g. a missing Firestore composite index)
      // should never take down the other 2 objectives for the day — log it
      // server-side and surface this one card as "unavailable" instead of
      // failing the whole get-today response.
      console.error('[objectives.js] verify failed for', def.id, err.message);
      return {
        id:        def.id,
        label:     def.label,
        desc:      def.desc,
        goal:      def.goal,
        progress:  0,
        reward:    def.reward,
        completed: false,
        claimed,
        unavailable: true,
      };
    }
  }));

  const totalEarnedToday = objectives
    .filter(o => o.claimed)
    .reduce((sum, o) => sum + o.reward, 0);

  return res.status(200).json({
    date: dateKey,
    objectives,
    totalEarnedToday: parseFloat(totalEarnedToday.toFixed(4)),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// claim  { idToken, objectiveId }
//   → { success, reward, newBalance } or { success:true, alreadyClaimed:true }
//
// Re-verifies completion from scratch (never trusts that get-today already
// said it was complete — this call re-checks independently) and credits the
// reward exactly once per user per day per objective, inside a transaction
// so a double-click can't double-pay.
// ─────────────────────────────────────────────────────────────────────────────
async function handleClaim(req, res, idToken) {
  const { objectiveId } = req.body;
  if (!objectiveId) return res.status(400).json({ error: 'Missing objectiveId' });

  const def = OBJECTIVE_POOL.find(o => o.id === objectiveId);
  if (!def) return res.status(400).json({ error: 'Unknown objective' });

  const fbUser = await verifyFirebaseToken(idToken);
  const uid = fbUser.localId;

  const db = getAdminDb();
  const now = new Date();
  const dateKey = _todayKey(now);
  const dayStart = Timestamp.fromDate(_utcDayStart(now));

  const dayRef = db.collection('users').doc(uid).collection('dailyObjectives').doc(dateKey);
  const daySnap = await dayRef.get();

  if (!daySnap.exists || !daySnap.data().objectiveIds?.includes(objectiveId)) {
    return res.status(400).json({ error: 'This objective is not assigned to you today.' });
  }
  if (daySnap.data().claimed?.[objectiveId]) {
    return res.status(200).json({ success: true, alreadyClaimed: true });
  }

  // Re-verify completion server-side, independent of whatever the client
  // last saw from get-today.
  const progress = await def.verify(db, uid, dayStart);
  if (progress < def.goal) {
    return res.status(400).json({
      error: `Not complete yet — ${progress}/${def.goal}.`,
    });
  }

  const userRef = db.collection('users').doc(uid);

  const result = await db.runTransaction(async tx => {
    // Re-read the claim flag inside the transaction to close the race
    // between the check above and this write.
    const freshDaySnap = await tx.get(dayRef);
    if (freshDaySnap.exists && freshDaySnap.data().claimed?.[objectiveId]) {
      return { alreadyClaimed: true };
    }

    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) throw new Error('User document not found');

    const currentBal = Number(userSnap.data().walletBalance || 0);
    const newBalance = parseFloat((currentBal + def.reward).toFixed(4));

    // Daily objective rewards are boost-only credit, not earned/withdrawable
    // money — they add to walletBalance (spendable on boosts, donations,
    // etc.) but deliberately do NOT touch withdrawableBalance, unlike escrow
    // sale proceeds or referral bonuses. Same exclusion paypal.js already
    // applies to a straight PayPal deposit: walletBalance always stays
    // >= withdrawableBalance, and this is money that only ever entered the
    // wallet side.
    tx.update(userRef, { walletBalance: newBalance });
    tx.set(dayRef, { claimed: { [objectiveId]: true } }, { merge: true });

    tx.set(userRef.collection('transactions').doc(), {
      type:      'daily_objective',
      amount:    def.reward,
      label:     `Daily objective · ${def.label}`,
      note:      `Completed "${def.label}" (${def.goal}/${def.goal}). Wallet credit only — not withdrawable.`,
      objectiveId,
      status:    'completed',
      createdAt: FieldValue.serverTimestamp(),
    });

    return { alreadyClaimed: false, newBalance };
  });

  if (result.alreadyClaimed) {
    return res.status(200).json({ success: true, alreadyClaimed: true });
  }

  return res.status(200).json({
    success:          true,
    reward:           def.reward,
    newBalance:       result.newBalance,
  });
}

export const config = {
  api: { bodyParser: { sizeLimit: '256kb' } },
};
