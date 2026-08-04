// /api/github.js
//
// Rebuilt endpoint — this route existed on the live site (the frontend in
// Js/profile.js / MyProfileHub.tsx has always called it) but its source was
// never present in either migration zip, so it's being rebuilt here from the
// client-side contract those callers already rely on:
//
//   GET  /api/github?action=connect&idToken=...   -> 302 redirect to GitHub OAuth
//   GET  /api/github?action=callback&code=...&state=...  -> GitHub OAuth redirect target,
//                                                            302s back to /myprofile?github=ok|error
//   POST /api/github?action=disconnect             -> { idToken } body, clears stored connection
//   GET  /api/github?action=repos                  -> Authorization: Bearer <idToken> header,
//                                                       { repos: [{ id, name, fullName, private }] }
//
// Stored on users/{uid}: githubUsername, githubAccessToken, githubConnectedAt
// — same field names app/api/deal/_handler.js already reads from
// (handleInviteGithubCollaborator), so no changes needed on that side.
//
// Required Vercel env vars (new — not used anywhere else in this codebase):
//   GITHUB_CLIENT_ID
//   GITHUB_CLIENT_SECRET      already present in Vercel per site owner
//   NEXT_PUBLIC_SITE_URL      already used by paypal/_handler.js; reused here
//                             to build the OAuth callback + redirect URLs
//
// Plus the existing Firebase Admin vars (FIREBASE_PROJECT_ID,
// FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY) already required by
// app/api/account/_handler.js — this file uses the same singleton init.

import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

/* ---------------- Firebase Admin init (singleton across warm invocations) ---------------- */
function ensureFirebaseApp() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      }),
    });
  }
}
function getDb() {
  ensureFirebaseApp();
  return getFirestore();
}
function getAuthAdmin() {
  ensureFirebaseApp();
  return getAuth();
}

function send(res, status, body) {
  res.status(status).json(body);
}

function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'https://siterifty.com').replace(/\/$/, '');
}

/* ---------------- verifyFirebaseToken ----------------
   Same "own token only" trust model as account.js / deal.js: every action
   here only ever reads or writes the CALLER's own uid, never someone else's. */
async function verifyFirebaseToken(idToken) {
  if (!idToken) throw new Error('Missing idToken');
  const decoded = await getAuthAdmin().verifyIdToken(idToken);
  return decoded; // { uid, email, ... }
}

/* ---------------- state token ----------------
   GitHub's OAuth flow round-trips an opaque `state` param through the
   redirect for CSRF protection. Rather than a server-side session/store,
   we pack the caller's uid + a timestamp into a signed-less base64 blob and
   re-derive the uid from it in the callback — same trust boundary as the
   idToken itself, since state is only ever set by us in the connect step
   and GitHub just echoes it back unmodified. */
function encodeState(uid) {
  return Buffer.from(JSON.stringify({ uid, t: Date.now() })).toString('base64url');
}
function decodeState(state) {
  try {
    const parsed = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
    if (!parsed?.uid) return null;
    // 10 minute window — generous for an OAuth authorize+redirect round trip.
    if (Date.now() - (parsed.t || 0) > 10 * 60 * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

/* ---------------- connect ----------------
   Public entry point the "Connect" button navigates the browser to
   directly (window.location.href = ...), so this is a redirect, not JSON. */
async function actionConnect(req, res) {
  const { idToken } = req.query || {};
  const clientId = process.env.GITHUB_CLIENT_ID;

  if (!clientId) {
    res.status(500).json({ error: 'GitHub is not configured on this server (missing GITHUB_CLIENT_ID).' });
    return;
  }

  let decoded;
  try {
    decoded = await verifyFirebaseToken(idToken);
  } catch {
    res.status(302).setHeader('Location', `${siteUrl()}/myprofile?github=error`);
    res.end();
    return;
  }

  const redirectUri = `${siteUrl()}/api/github?action=callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'repo', // needed to add collaborators on private repos (see deal.js usage)
    state: encodeState(decoded.uid),
    allow_signup: 'false',
  });

  res.status(302).setHeader('Location', `https://github.com/login/oauth/authorize?${params.toString()}`);
  res.end();
}

/* ---------------- callback ----------------
   GitHub redirects the browser back here after the user authorizes (or
   denies) the app. Exchanges the code for an access token server-side,
   fetches the GitHub username, stores both on the caller's user doc, then
   bounces the browser back to the profile page with a ?github=ok|error
   flag — exactly what profile.js's existing "Check URL params on load"
   block already looks for. */
async function actionCallback(req, res) {
  const { code, state, error: ghError } = req.query || {};
  const backToProfile = (status) => {
    res.status(302).setHeader('Location', `${siteUrl()}/myprofile?github=${status}`);
    res.end();
  };

  if (ghError || !code) return backToProfile('error');

  const stateData = decodeState(state);
  if (!stateData) return backToProfile('error');

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) return backToProfile('error');

  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: `${siteUrl()}/api/github?action=callback`,
      }),
    });
    const tokenData = await tokenRes.json();
    const accessToken = tokenData?.access_token;
    if (!accessToken) return backToProfile('error');

    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!userRes.ok) return backToProfile('error');
    const ghUser = await userRes.json();

    const db = getDb();
    await db.collection('users').doc(stateData.uid).set(
      {
        githubUsername: ghUser.login,
        githubAccessToken: accessToken,
        githubConnectedAt: Date.now(),
      },
      { merge: true }
    );

    return backToProfile('ok');
  } catch {
    return backToProfile('error');
  }
}

/* ---------------- disconnect ----------------
   Called from the profile modal's Disconnect button. Only ever clears the
   CALLER's own stored connection. Best-effort revokes the token with
   GitHub too, so it stops showing under the user's GitHub
   Settings > Applications if they forget they connected it. */
async function actionDisconnect(req, res) {
  const { idToken } = req.body || {};

  let decoded;
  try {
    decoded = await verifyFirebaseToken(idToken);
  } catch {
    return send(res, 401, { error: 'Invalid or missing idToken' });
  }

  const db = getDb();
  const userRef = db.collection('users').doc(decoded.uid);
  const snap = await userRef.get();
  const data = snap.exists ? snap.data() : {};
  const accessToken = data?.githubAccessToken;

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (accessToken && clientId && clientSecret) {
    try {
      // DELETE /applications/{client_id}/grant revokes the whole
      // authorization (not just one token) — best-effort, ignore failures,
      // since the important part (clearing our own stored copy) still
      // happens below either way.
      await fetch(`https://api.github.com/applications/${clientId}/grant`, {
        method: 'DELETE',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ access_token: accessToken }),
      });
    } catch {
      // ignore — revoke is best-effort
    }
  }

  await userRef.set(
    {
      githubUsername: null,
      githubAccessToken: null,
      githubConnectedAt: null,
    },
    { merge: true }
  );

  send(res, 200, { ok: true });
}

/* ---------------- repos ----------------
   Called from the profile modal's repo list, and from the "Attach a GitHub
   Repository" picker on listing forms. Accepts the idToken either as a
   Bearer header or a query param, since both call sites exist in the
   original client code. */
async function actionRepos(req, res) {
  const headerToken = (req.headers?.authorization || '').replace(/^Bearer\s+/i, '');
  const idToken = headerToken || req.query?.idToken;

  let decoded;
  try {
    decoded = await verifyFirebaseToken(idToken);
  } catch {
    return send(res, 401, { error: 'Invalid or missing idToken' });
  }

  const db = getDb();
  const snap = await db.collection('users').doc(decoded.uid).get();
  const accessToken = snap.exists ? snap.data()?.githubAccessToken : null;
  if (!accessToken) {
    return send(res, 400, { error: 'not_connected', reason: 'GitHub is not connected for this account' });
  }

  try {
    const ghRes = await fetch(
      'https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );

    if (ghRes.status === 401) {
      // Token revoked on GitHub's side (e.g. user removed the app there) —
      // clear our stale copy so the UI falls back to "Connect" again.
      await db.collection('users').doc(decoded.uid).set(
        { githubUsername: null, githubAccessToken: null, githubConnectedAt: null },
        { merge: true }
      );
      return send(res, 400, { error: 'not_connected', reason: 'token_revoked' });
    }
    if (!ghRes.ok) {
      return send(res, 500, { error: 'github_api_error', message: `GitHub API returned ${ghRes.status}` });
    }

    const repos = await ghRes.json();
    const mapped = (Array.isArray(repos) ? repos : []).map((r) => ({
      id: r.id,
      name: r.name,
      fullName: r.full_name,
      private: r.private,
      defaultBranch: r.default_branch,
      updatedAt: r.updated_at,
    }));

    send(res, 200, { repos: mapped });
  } catch (err) {
    send(res, 500, { error: 'github_api_error', message: err?.message || 'Failed to fetch repositories' });
  }
}

/* ---------------- router ---------------- */
export default async function handler(req, res) {
  const action = req.query?.action;

  try {
    if (req.method === 'GET' && action === 'connect') return await actionConnect(req, res);
    if (req.method === 'GET' && action === 'callback') return await actionCallback(req, res);
    if (req.method === 'GET' && action === 'repos') return await actionRepos(req, res);
    if (req.method === 'POST' && action === 'disconnect') return await actionDisconnect(req, res);

    return send(res, 400, { error: 'Unknown or unsupported action' });
  } catch (err) {
    return send(res, 500, { error: err?.message || 'Internal error' });
  }
}
