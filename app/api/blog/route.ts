// POST /api/blog — the only way blog posts get written.
//
// New plumbing (not a legacy port — see lib/server/adminDb.ts's header
// comment for why new server-only code lives outside app/api/_lib's
// byte-for-byte-port files). Deliberately its own route rather than a
// new action bolted onto account/_handler.js's six-action file, since
// that file's whole point is staying untouched.
//
// SECURITY: this is the actual access-control boundary for "who can
// publish to the blog" — not the "+" button's visibility in the UI.
// Any signed-in user may publish (no admin restriction). Every write
// request's Firebase ID token is independently verified here — this is
// a login check, not an admin check.
import { getAuth } from "firebase-admin/auth";
import { getAdminDb } from "@/lib/server/adminDb";
import { FieldValue } from "firebase-admin/firestore";

// getAdminDb() (lib/server/adminDb.ts) already guards initializeApp() with
// its own getApps().length check and is the single shared entry point for
// admin-app init in this file. verifyUser used to carry a second, separate
// ensureFirebaseApp()/initializeApp() of its own — two independent init
// blocks racing to register the same default app is exactly what produced
// "the default Firebase app already exists". Calling getAdminDb() here
// (even though we only need its side effect of having initialized the
// app, not the Firestore instance it returns) guarantees there is only
// ever one init path.
function ensureFirebaseApp() {
  getAdminDb();
}

async function verifyUser(authHeader: string | null): Promise<string | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const idToken = authHeader.slice(7);
  try {
    ensureFirebaseApp();
    const decoded = await getAuth().verifyIdToken(idToken);
    // Was also requiring decoded.email_verified !== false, which no other
    // route in this codebase checks (see app/api/storage and friends —
    // they all just check uid). Any account that signed up without ever
    // clicking an email verification link — including some social-auth
    // flows that don't set this field at all — got "Sign-in required"
    // here while being genuinely signed in everywhere else on the site,
    // since AuthContext (the "global" client auth every other component
    // uses) has no concept of this flag at all. Dropping it so blog
    // publishing behaves like every other authenticated write on the site:
    // a valid token is sufficient.
    return decoded.uid || null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const uid = await verifyUser(request.headers.get("authorization"));
  if (!uid) {
    return Response.json({ error: "Sign-in required" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const title = String(body.title || "").trim();
  const description = String(body.description || "").trim();
  const coverImage = String(body.coverImage || "").trim();

  if (!title || title.length > 140) {
    return Response.json({ error: "Title is required (max 140 characters)" }, { status: 400 });
  }
  if (!description || description.length > 20000) {
    return Response.json({ error: "Description is required" }, { status: 400 });
  }
  if (!coverImage) {
    return Response.json({ error: "Cover image is required" }, { status: 400 });
  }

  const db = getAdminDb();
  const docRef = await db.collection("blogPosts").add({
    title,
    description,
    coverImage,
    authorUid: uid,
    createdAt: FieldValue.serverTimestamp(),
  });

  const saved = await docRef.get();
  const data = saved.data();

  return Response.json({
    post: {
      id: docRef.id,
      title,
      description,
      coverImage,
      authorUid: uid,
      createdAt: data?.createdAt ? data.createdAt.toDate().toISOString() : new Date().toISOString(),
    },
  });
}
