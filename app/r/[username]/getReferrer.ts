// Server-only Admin SDK lookup for the /r/[username] referral landing
// page. Deliberately its own tiny helper rather than reusing
// app/seller/[id]/getSellerSeoProfile — that one also runs two count()
// aggregations (active listings, followers) this page never displays,
// and its "Anonymous" fallback for a missing doc doesn't apply here: this
// page needs to tell the difference between "user exists" (show their
// name) and "user doesn't exist" (show the generic 404 card) rather than
// papering over a miss with a placeholder name.
//
// Same two-step resolution as getSellerSeoProfile: try the path segment
// as a direct doc-id first (cheap, and future-proofs against a possible
// /r/{uid} share shape), then fall back to the usernameLower index —
// same index signup already maintains, so this costs one indexed query
// for the common case of a real /r/{username} link.
//
// profileVisibility is intentionally NOT checked here (unlike
// getSellerSeoProfile/getSellerFullProfile) — a referral card only ever
// shows the referrer's username and avatar, both of which are already
// public anywhere that referrer's profile is linked (marketplace
// listings, deal chat, etc.), never their bio/contact/listings. There's
// nothing on this page a "private" profile setting is meant to hide.

import { getAdminDb } from "@/lib/server/adminDb";

export interface ReferrerInfo {
  username: string;
  profilePic: string;
}

export async function getReferrer(usernameSegment: string): Promise<ReferrerInfo | null> {
  if (!usernameSegment) return null;
  const db = getAdminDb();

  let snap = await db.collection("users").doc(usernameSegment).get();
  if (!snap.exists) {
    const lower = usernameSegment.toLowerCase();
    const q = await db.collection("users").where("usernameLower", "==", lower).limit(1).get();
    if (q.empty) return null;
    snap = q.docs[0];
  }

  const d = snap.data() || {};
  if (!d.username) return null;

  return {
    username: d.username,
    profilePic: d.profilePic || "",
  };
}
