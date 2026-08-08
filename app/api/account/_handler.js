// /api/account.js
//
// Server-only trusted endpoint for MAIN-SITE (index.html) actions only.
// Split out from api/admin.js so that nothing the main site depends on
// (amIAdmin, ensureAccount, setPrivacy, revokeApiKey, notifyOnRestore,
// submitAppeal) can ever be affected by changes made to the admin console
// (admin.html) side of things, or vice versa — the two now have zero
// shared request-routing surface, even though they still both use the
// Firebase Admin SDK and the same underlying Firebase project.
//
// None of these six actions require the admin_session cookie — each one
// is public and instead verifies the CALLER's own Firebase ID token
// server-side, then only ever acts on that caller's own uid/resources (or,
// for notifyOnRestore/submitAppeal, accepts unauthenticated input that
// carries no ability to act on anyone else's data). See each action's
// comment below for the specific gap it closes versus the old client-side
// Firestore-SDK-direct approach.
//
// Required Vercel env vars (same project/creds as api/admin.js):
//   FIREBASE_PROJECT_ID
//   FIREBASE_CLIENT_EMAIL
//   FIREBASE_PRIVATE_KEY      (keep the literal \n escapes; see note below)
//   ADMIN_EMAIL               only used here by amIAdmin, to answer "is the
//                             signed-in user the one admin account" — this
//                             file has no login/session logic of its own.
//
// FIREBASE_PRIVATE_KEY note: paste the key from your service account JSON
// with real newlines replaced by the two characters \n. This file converts
// them back with .replace(/\\n/g, '\n') below, which is the standard way
// to store a multiline PEM key in a single-line env var.

import { FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getAdminDb } from '../../../lib/server/adminDb';

/* ---------------- Firebase Admin init (singleton, shared — see lib/server/adminDb.ts) ---------------- */
function getDb() {
  return getAdminDb();
}
function getAuthAdmin() {
  // getAdminDb() itself performs the initializeApp() guard, so calling it
  // first guarantees the default app exists before getAuth() reads it.
  getAdminDb();
  return getAuth();
}

function send(res, status, body) {
  res.status(status).json(body);
}

/* ---------------- amIAdmin ----------------
   Lightweight, public (no cookie required) check used by the MAIN app
   (index.html) to ask "is the signed-in Firebase user the admin?" so it
   can render a different UI for that one account. Verifies the caller's
   own Firebase ID token server-side and compares the email to
   ADMIN_EMAIL — no separate password, nothing to forge. */
async function actionAmIAdmin(req, res) {
  const { idToken } = req.body || {};
  if (!idToken) return send(res, 200, { isAdmin: false });

  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return send(res, 200, { isAdmin: false });

  try {
    const decoded = await getAuthAdmin().verifyIdToken(idToken);
    const email = (decoded.email || '').trim().toLowerCase();
    const isAdmin = !!email && email === adminEmail.trim().toLowerCase() && decoded.email_verified !== false;
    send(res, 200, { isAdmin });
  } catch (err) {
    // Invalid/expired token — treat as not-admin rather than erroring, since
    // this is a UI-branching check, not a security gate for a protected action.
    send(res, 200, { isAdmin: false });
  }
}

/* ---------------- submitAppeal ----------------
   PUBLIC — called from the ban/suspend overlay's appeal form in index.html.
   Verifies the caller's own Firebase ID token, then only ever creates an
   appeal doc tied to that caller's own uid. */
async function actionSubmitAppeal(req, res) {
  const { idToken, message, attachments } = req.body || {};
  if (!idToken) return send(res, 401, { error: 'Not authenticated' });
  if (!message || typeof message !== 'string' || !message.trim()) {
    return send(res, 400, { error: 'A description is required' });
  }
  const safeAttachments = Array.isArray(attachments) ? attachments.slice(0, 3) : [];

  let decoded;
  try {
    decoded = await getAuthAdmin().verifyIdToken(idToken);
  } catch (err) {
    return send(res, 401, { error: 'Invalid or expired session — please refresh and try again' });
  }

  const db = getDb();
  const userSnap = await db.collection('users').doc(decoded.uid).get();
  const userData = userSnap.exists ? userSnap.data() : {};

  const docRef = await db.collection('appeals').add({
    uid: decoded.uid,
    email: decoded.email || userData.email || null,
    status: (userData.banned ? 'banned' : userData.suspended ? 'suspended' : 'unknown'),
    message: message.trim().slice(0, 5000),
    attachments: safeAttachments.map((a) => ({
      url: a.url || null,
      storagePath: a.storagePath || null,
      fileName: a.fileName || null,
    })),
    reviewed: false,
    createdAt: FieldValue.serverTimestamp(),
  });

  send(res, 200, { ok: true, appealId: docRef.id });
}

/* ---------------- notifyOnRestore ----------------
   PUBLIC — called from the maintenance overlay's "Notify me" form in
   index.html, shown to signed-out visitors too. Just stores an email
   address; no sensitive data. */
async function actionNotifyOnRestore(req, res) {
  const { email } = req.body || {};
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return send(res, 400, { error: 'A valid email is required' });
  }
  const db = getDb();
  await db.collection('maintenanceNotifyList').doc(email.trim().toLowerCase()).set(
    {
      email: email.trim().toLowerCase(),
      requestedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  send(res, 200, { ok: true });
}

/* ---------------- ensureAccount ----------------
   PUBLIC — called once right after Firebase Auth signup/signin resolves
   (see firebase-init.js's ensureUserDoc), for every visitor, so it cannot
   require an admin session. Verifies the caller's own Firebase ID token,
   then only ever creates/touches that caller's own users/{uid} doc.

   Replaces a previous client-side setDoc(doc(db,'users',uid), {...}) call
   that ran directly from the browser via the client Firestore SDK. That
   write set fields like plan, walletBalance, withdrawableBalance,
   totalEarned, and pendingBalance from client-controlled values — nothing
   stopped a malicious client from calling that same setDoc with, say,
   walletBalance: 999999 on their first-ever write. Moving doc creation
   here means every one of those fields is now a fixed server-chosen
   literal; the client can no longer influence them at all on account
   creation.

   Also unions the new user's uid into planIndex/free (see listings.js's
   handlePremiumSellers and paypal.js's plan-change handlers for the read/
   write sides of that same planIndex/{plan} scheme) so every user — paid
   or not — is discoverable via a single planIndex doc read instead of a
   full `users` collection scan. */
// Finds a username that isn't already taken, starting from `base` and, if
// that's taken, appending 2, 3, 4, ... until a free one is found (base
// itself has no number so the very first account with that name stays
// clean, e.g. "github" before "github2"). Capped at maxLength so a long
// base + suffix still respects the username length limit, and capped at
// a bounded number of attempts so a pathological run of collisions can't
// hang the request -- falls back to a base+random-suffix as a last resort.
async function resolveUniqueUsername(db, base, maxLength = 15) {
  const trimmedBase = base.slice(0, maxLength);
  const usersCol = db.collection('users');

  const isTaken = async (candidate) => {
    const lower = candidate.toLowerCase();
    const snap = await usersCol.where('usernameLower', '==', lower).limit(1).get();
    return !snap.empty;
  };

  if (!(await isTaken(trimmedBase))) return trimmedBase;

  const MAX_ATTEMPTS = 50;
  for (let n = 2; n <= MAX_ATTEMPTS; n++) {
    const suffix = String(n);
    const candidate = trimmedBase.slice(0, maxLength - suffix.length) + suffix;
    if (!(await isTaken(candidate))) return candidate;
  }

  const randomSuffix = String(Math.floor(1000 + Math.random() * 9000));
  return trimmedBase.slice(0, maxLength - randomSuffix.length) + randomSuffix;
}

async function actionEnsureAccount(req, res) {
  const { idToken, username, profilePic, referredBy } = req.body || {};
  if (!idToken) return send(res, 401, { error: 'Not authenticated' });

  let decoded;
  try {
    decoded = await getAuthAdmin().verifyIdToken(idToken);
  } catch (err) {
    return send(res, 401, { error: 'Invalid or expired session — please refresh and try again' });
  }
  const uid = decoded.uid;

  const db = getDb();
  const userRef = db.collection('users').doc(uid);
  const snap = await userRef.get();

  if (snap.exists) {
    // Existing user — nothing to create. Optionally patch username/avatar
    // if the caller is finishing profile setup, but never touch plan/
    // wallet fields here — those are only ever written by the PayPal
    // activation/cancellation/webhook handlers.
    const patch = {};
    if (typeof username === 'string' && username.trim() && username.trim() !== (snap.data() || {}).username) {
      // A username change must re-run the same uniqueness check signup
      // does (resolveUniqueUsername) — this branch used to write
      // whatever the caller sent straight to usernameLower with no
      // check, which would let two accounts collide onto the same
      // canonical /seller/{username} URL. Silently de-duplicating here
      // (rather than erroring) matches signup's existing behavior.
      const desiredBase = username.trim()
        .toLowerCase()
        .replace(/[^a-z0-9_.-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 15) || 'user';
      const uniqueUname = await resolveUniqueUsername(db, desiredBase);
      patch.username = uniqueUname;
      patch.usernameLower = uniqueUname.toLowerCase().replace(/\s+/g, '_');
    }
    if (typeof profilePic === 'string' && profilePic.trim()) patch.profilePic = profilePic.trim();
    if (Object.keys(patch).length) await userRef.set(patch, { merge: true });
    // Echo back the final username/profilePic (patched value if this call
    // changed it, else whatever's already on the doc) so callers like the
    // post-signup tour can personalize its first step without a second
    // Firestore round trip — same data the original's _finishOauthSignup
    // got by re-reading the doc after ensureUserDoc, just returned here
    // directly since this handler already has the doc in hand.
    const existingData = snap.data() || {};
    return send(res, 200, {
      ok: true,
      created: false,
      uid,
      username: patch.username || existingData.username || '',
      profilePic: patch.profilePic || existingData.profilePic || '',
    });
  }

  const rawBase = (typeof username === 'string' && username.trim())
    ? username.trim()
    : (decoded.name || (decoded.email ? decoded.email.split('@')[0] : '')) || '';
  const provider = (decoded.firebase?.sign_in_provider || '').toLowerCase();
  const genericBase = provider.includes('github') ? 'github' : 'user';
  let usernameBase = rawBase
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 15);
  if (!usernameBase) usernameBase = genericBase;
  const uname = await resolveUniqueUsername(db, usernameBase);
  const safeReferredBy = (typeof referredBy === 'string' && /^[a-zA-Z0-9_.-]{1,20}$/.test(referredBy))
    ? referredBy.toLowerCase()
    : null;

  await db.runTransaction(async tx => {
    tx.set(userRef, {
      uid,
      email: decoded.email || null,
      displayName: decoded.name || uname,
      username: uname,
      usernameLower: uname.toLowerCase().replace(/\s+/g, '_'),
      // Client-supplied profilePic wins (used by email/password signup's
      // preset avatar picker); otherwise fall back to the OAuth provider's
      // own photo (decoded.picture -- Google always sets this; GitHub sets
      // it too when the account has a public avatar) so Google/GitHub
      // sign-ups automatically get their real profile picture with no
      // manual avatar-selection step.
      profilePic: (typeof profilePic === 'string' && profilePic.trim())
        ? profilePic.trim()
        : (decoded.picture || ''),
      plan: 'free',
      planStatus: 'active',
      walletBalance: 0,
      withdrawableBalance: 0,
      totalFeesPaid: 0,
      totalEarned: 0,
      pendingBalance: 0,
      contactEmail: decoded.email || '',
      // referredAt anchors the 7-day referral window (see paypal.js's
      // handleActivateSub) — the referral bonus is only paid if this new
      // user activates a paid plan within 7 days of THIS signup moment,
      // not the referrer's link-share moment. Stored only alongside
      // referredBy so a non-referred signup carries neither field.
      ...(safeReferredBy ? { referredBy: safeReferredBy, referredAt: FieldValue.serverTimestamp() } : {}),
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(db.collection('planIndex').doc('free'), {
      uids: FieldValue.arrayUnion(uid),
    }, { merge: true });
  });

  // Same reasoning as the existing-user branch above — return the final,
  // server-resolved username/profilePic (post de-duplication) in this same
  // response so the tour can show "Welcome, @realusername" immediately,
  // without a second getDoc like the original's _finishOauthSignup needed.
  send(res, 200, {
    ok: true,
    created: true,
    uid,
    username: uname,
    profilePic: (typeof profilePic === 'string' && profilePic.trim()) ? profilePic.trim() : (decoded.picture || ''),
  });
}

/* ---------------- setPrivacy ----------------
   PUBLIC — verifies the caller's own Firebase ID token, then only ever
   writes to that caller's own users/{uid} doc.

   Replaces a previous client-side updateDoc(doc(db,'users',uid), { profile
   Visibility, ... }) call whose ONLY gate on the paid-plan-only 'private'
   option was a disabled <option> in the HTML — nothing on the backend
   actually checked it, so a free-plan user could set profileVisibility:
   'private' themselves (devtools, or calling the SDK directly) with
   nothing to stop or revert it. This action re-checks plan here,
   server-side, before allowing 'private'. */
const PRIVATE_PROFILE_PLANS = ['starter', 'growth', 'pro'];
async function actionSetPrivacy(req, res) {
  const { idToken, profileVisibility, showEmail, showSocial, dataCollection } = req.body || {};
  if (!idToken) return send(res, 401, { error: 'Not authenticated' });

  let decoded;
  try {
    decoded = await getAuthAdmin().verifyIdToken(idToken);
  } catch (err) {
    return send(res, 401, { error: 'Invalid or expired session — please refresh and try again' });
  }
  const uid = decoded.uid;

  const allowedVisibility = ['public', 'members', 'private'];
  if (!allowedVisibility.includes(profileVisibility)) {
    return send(res, 400, { error: 'Invalid profileVisibility value' });
  }

  const db = getDb();

  if (profileVisibility === 'private') {
    const userSnap = await db.collection('users').doc(uid).get();
    const plan = userSnap.exists ? (userSnap.data().plan || 'free') : 'free';
    if (!PRIVATE_PROFILE_PLANS.includes(plan)) {
      return send(res, 403, { error: 'Private profiles are available on paid plans. Upgrade to unlock.' });
    }
  }

  await db.collection('users').doc(uid).update({
    profileVisibility,
    showEmail: !!showEmail,
    showSocial: !!showSocial,
    dataCollection: !!dataCollection,
  });

  send(res, 200, { ok: true, profileVisibility });
}

/* ---------------- revokeApiKey ----------------
   PUBLIC — verifies the caller's own Firebase ID token, then only revokes
   an API key if it actually belongs to that caller.

   Replaces a previous client-side updateDoc(doc(db,'apiKeys',keyId), {
   active:false }) call where keyId came straight from a DOM data attribute
   and nothing in that code path verified the key's ownerUid matched the
   signed-in user before writing. This action checks ownerUid itself before
   allowing the revoke, regardless of what the security rules do. */
async function actionRevokeApiKey(req, res) {
  const { idToken, keyId } = req.body || {};
  if (!idToken) return send(res, 401, { error: 'Not authenticated' });
  if (!keyId || typeof keyId !== 'string') return send(res, 400, { error: 'keyId is required' });

  let decoded;
  try {
    decoded = await getAuthAdmin().verifyIdToken(idToken);
  } catch (err) {
    return send(res, 401, { error: 'Invalid or expired session — please refresh and try again' });
  }
  const uid = decoded.uid;

  const db = getDb();
  const keyRef = db.collection('apiKeys').doc(keyId);
  const keySnap = await keyRef.get();
  if (!keySnap.exists) return send(res, 404, { error: 'API key not found' });

  const keyData = keySnap.data();
  if (keyData.ownerUid !== uid) {
    return send(res, 403, { error: 'This API key does not belong to your account' });
  }

  await keyRef.update({ active: false, revokedAt: Date.now() });
  send(res, 200, { ok: true, keyId });
}

const ACTIONS = {
  amIAdmin: actionAmIAdmin,
  submitAppeal: actionSubmitAppeal,
  notifyOnRestore: actionNotifyOnRestore,
  ensureAccount: actionEnsureAccount,
  setPrivacy: actionSetPrivacy,
  revokeApiKey: actionRevokeApiKey,
};

export default async function handler(req, res) {
  const action = (req.query && req.query.action) || (req.body && req.body.action);
  const fn = ACTIONS[action];
  if (!fn) return send(res, 400, { error: 'Unknown or missing action' });

  try {
    await fn(req, res);
  } catch (err) {
    console.error(`[account:${action}] unhandled error:`, err);
    if (!res.headersSent) send(res, 500, { error: 'Internal server error' });
  }
}
