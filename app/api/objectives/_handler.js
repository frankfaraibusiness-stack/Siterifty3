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

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';

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
const OBJECTIVE_POOL = [
  {
    id: 'list_3',
    label: 'Post 3 Listings',
    desc: 'Create 3 new listings today (website, app, or game).',
    goal: 3,
    reward: 0.03,
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
    label: 'Post 1 Listing',
    desc: 'Create at least 1 new listing today.',
    goal: 1,
    reward: 0.01,
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
    label: 'Send 5 Deals',
    desc: 'Send deal requests to 5 different listings today.',
    goal: 5,
    reward: 0.05,
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
    label: 'Send 2 Deals',
    desc: 'Send deal requests to 2 different listings today.',
    goal: 2,
    reward: 0.02,
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
    label: 'Message 10 Users',
    desc: 'Send messages in 10 different deal chats today.',
    goal: 10,
    reward: 0.04,
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
    label: 'Message 3 Users',
    desc: 'Send messages in 3 different deal chats today.',
    goal: 3,
    reward: 0.015,
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
    label: 'Update Your Profile',
    desc: 'Edit your display name, bio, or profile picture today.',
    goal: 1,
    reward: 0.002,
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
  // NOTE: a "View 5 Listings" objective is a natural future addition, but it
  // needs a viewEvents write somewhere in the marketplace browsing code
  // first (nothing currently logs listing views). Add it back to the pool
  // once that tracking exists — shipping it now would show 0/5 forever.
];

const OBJECTIVES_PER_DAY = 3;

// ── Deterministic daily pick: same 3 all day for a given uid+date, but
//    rotates day to day. Simple string-hash seeded shuffle — no external
//    deps, no randomness that could differ between get-today calls. ────────
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
  return arr.slice(0, count);
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

    // Daily objective rewards are earned money (like escrow sale proceeds),
    // not a deposit — so they count toward withdrawableBalance too, same
    // model as deal.js's escrow-release crediting.
    const currentWithdrawable = Number(userSnap.data().withdrawableBalance || 0);
    const newWithdrawable = parseFloat((currentWithdrawable + def.reward).toFixed(4));

    tx.update(userRef, { walletBalance: newBalance, withdrawableBalance: newWithdrawable });
    tx.set(dayRef, { claimed: { [objectiveId]: true } }, { merge: true });

    tx.set(userRef.collection('transactions').doc(), {
      type:      'daily_objective',
      amount:    def.reward,
      label:     `Daily objective · ${def.label}`,
      note:      `Completed "${def.label}" (${def.goal}/${def.goal}).`,
      objectiveId,
      status:    'completed',
      createdAt: FieldValue.serverTimestamp(),
    });

    return { alreadyClaimed: false, newBalance, newWithdrawable };
  });

  if (result.alreadyClaimed) {
    return res.status(200).json({ success: true, alreadyClaimed: true });
  }

  return res.status(200).json({
    success:          true,
    reward:           def.reward,
    newBalance:       result.newBalance,
    newWithdrawable:  result.newWithdrawable,
  });
}

export const config = {
  api: { bodyParser: { sizeLimit: '256kb' } },
};
