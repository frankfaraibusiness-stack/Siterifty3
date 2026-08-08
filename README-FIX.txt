SITERIFTY — FIREBASE ADMIN SINGLETON FIX
==========================================

WHAT WAS WRONG
--------------
Your app had two different Firebase Admin init patterns living side by side:

- lib/server/adminDb.ts — one shared getAdminDb() singleton, used by your
  SSR pages (listing, seller, blog, sitemap, etc). This is why those pages
  "worked nicely" and loaded data fine.

- Every file under app/api/**/_handler.js (and app/api/_lib/*.js) had its
  OWN private copy of the same initializeApp()/credential block — 7
  independent copies in total, plus 2 more (account/_handler.js,
  github/_handler.js) that were already half-converted to share init but
  still kept their own local getDb()/getAuthAdmin() wrappers duplicating
  the same logic.

Each copy guarded itself with `if (!getApps().length)`, so only the first
one to run in a given serverless instance actually registered the app —
every other copy just silently reused whatever got registered first. If
any one of those 9 near-identical blocks had drifted (a typo, a different
fallback, the aistudio handler's dummy-credential path), that broken app
instance would get silently reused by every OTHER handler for the rest of
that serverless instance's life — with no thrown error, no log line,
nothing. That's exactly why your Vercel logs showed clean 200s while the
marketplace/objectives pages rendered nothing: the request succeeded, but
Firestore queries running against a bad app instance came back empty or
failed in a way that got swallowed.

THE FIX
-------
Every file below has had its private admin-init block deleted and now
imports the ONE shared singleton from lib/server/adminDb.ts instead —
the same one your already-working SSR pages use. No business logic was
changed in any file — only the Firebase Admin bootstrapping.

Files in this package (preserve their exact folder paths when copying
into your project — they overwrite the existing files at those paths):

  app/api/listings/_handler.js     <- marketplace feed (listing.feed action)
  app/api/objectives/_handler.js   <- "Today's Objectives" widget
  app/api/deal/_handler.js         <- deals/escrow (imported by listings.js)
  app/api/paypal/_handler.js
  app/api/account/_handler.js
  app/api/github/_handler.js
  app/api/aistudio/_handler.js     <- AI Studio / support chat / agent
  app/api/_lib/limits.js
  app/api/_lib/push.js
  app/api/_lib/webhooks.js
  app/api/_lib/storage.js

NOT included (unchanged, already correct):
  lib/server/adminDb.ts — the shared singleton every fixed file now
  imports from. You should already have this file — nothing to replace.

HOW TO APPLY
------------
1. Unzip this package.
2. Copy the app/ folder from this zip into your project root, overwriting
   the matching files. Every path here matches your existing project
   structure exactly (app/api/listings/_handler.js replaces
   app/api/listings/_handler.js, etc).
3. Commit and push (or redeploy on Vercel same as normal).
4. No environment variable changes needed — this fix doesn't touch which
   env vars are used, only how many times the same init code was
   duplicated.

VERIFY AFTER DEPLOYING
-----------------------
- Load /marketplace — listings should render.
- Check "Today's Objectives" on the home/dashboard screen — should load.
- Since this consolidates 9 previously-independent code paths onto one,
  it's worth spot-checking a couple of other flows that hit these files
  too: PayPal/billing actions, GitHub repo linking, push notifications,
  and the AI Studio / support chat widget, since those handlers were
  also touched.
