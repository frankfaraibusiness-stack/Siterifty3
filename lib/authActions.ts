import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  GithubAuthProvider,
  signOut,
  sendPasswordResetEmail,
  type User as FirebaseUser,
} from "firebase/auth";
import { collection, query, where, getDocs, limit } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

export function friendlyAuthError(code: string | undefined): string {
  const map: Record<string, string> = {
    "auth/invalid-email": "Invalid email address.",
    "auth/user-not-found": "No account with that email.",
    "auth/wrong-password": "Incorrect password.",
    "auth/email-already-in-use": "Email already in use.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/popup-closed-by-user": "Sign-in popup closed.",
    "auth/account-exists-with-different-credential":
      "Account exists with a different sign-in method.",
    "auth/invalid-credential": "Invalid credentials. Try again.",
  };
  return (code && map[code]) || "Something went wrong. Try again.";
}

// Mirrors isUsernameTaken() in the old firebase-init.js.
export async function isUsernameTaken(usernameRaw: string, excludeUid?: string): Promise<boolean> {
  const lower = usernameRaw.toLowerCase().replace(/\s+/g, "_");
  const snap = await getDocs(
    query(collection(db, "users"), where("usernameLower", "==", lower), limit(2))
  );
  if (snap.empty) return false;
  if (excludeUid && snap.docs.length === 1 && snap.docs[0].id === excludeUid) return false;
  return true;
}

// Reads ?r=username from the URL for referral tracking, same as the old code.
function getReferralCode(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const p = new URLSearchParams(window.location.search).get("r");
    return p && /^[a-zA-Z0-9_.-]{1,20}$/.test(p) ? p.toLowerCase() : null;
  } catch {
    return null;
  }
}

// Mirrors ensureUserDoc() in the old firebase-init.js. Account creation is
// deliberately server-side (see app/api/account's ensureAccount action) so
// a client can never set its own walletBalance/plan/etc on first write.
async function ensureUserDoc(
  user: FirebaseUser,
  extra: { username?: string; profilePic?: string; referredBy?: string } = {}
): Promise<{ created: boolean; username: string; profilePic: string }> {
  const idToken = await user.getIdToken();
  const referredBy = extra.referredBy || getReferralCode() || undefined;

  const res = await fetch("/api/account?action=ensureAccount", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      idToken,
      username: extra.username || user.displayName || user.email?.split("@")[0] || "",
      profilePic: extra.profilePic || "",
      ...(referredBy ? { referredBy } : {}),
    }),
  });

  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(json.error || "Could not create account");
  }
  // username/profilePic are the server-resolved final values (post
  // de-duplication for username, provider photo fallback for profilePic)
  // — same values the original's _finishOauthSignup got by re-reading the
  // doc after ensureUserDoc, just returned in this same round trip.
  return { created: !!json.created, username: json.username || "", profilePic: json.profilePic || "" };
}

export async function loginWithEmail(email: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(auth, email, password);
}

const USERNAME_RULES = {
  minLength: 5,
  maxLength: 15,
  pattern: "^[a-zA-Z0-9_.-]+$",
  patternHint: "Letters, numbers, underscores, hyphens, and dots only.",
};

export function validateUsername(username: string): string | null {
  if (!username || username.length < USERNAME_RULES.minLength) {
    return `Username must be at least ${USERNAME_RULES.minLength} characters.`;
  }
  if (username.length > USERNAME_RULES.maxLength) {
    return `Username cannot exceed ${USERNAME_RULES.maxLength} characters.`;
  }
  if (!new RegExp(USERNAME_RULES.pattern).test(username)) {
    return USERNAME_RULES.patternHint;
  }
  return null;
}

// Returns the final username/profilePic (same values just written to
// users/{uid}) so the caller can pass them straight into the post-signup
// tour (window.__startTour(username, profilePic) in the original) without
// a second Firestore read.
export async function signupWithEmail(
  username: string,
  email: string,
  password: string,
  profilePic: string
): Promise<{ username: string; profilePic: string }> {
  const usernameError = validateUsername(username);
  if (usernameError) throw new Error(usernameError);

  const taken = await isUsernameTaken(username);
  if (taken) throw new Error("That username is already taken. Please choose another.");

  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const { username: finalUsername, profilePic: finalProfilePic } = await ensureUserDoc(cred.user, {
    username,
    profilePic,
  });
  return { username: finalUsername || username, profilePic: finalProfilePic || profilePic };
}

// Returns whether this was a brand-new account (so the caller can decide
// whether to show onboarding/tour — same as the old __doGoogle / __doGithub
// `isNew` flag) plus the final username/profilePic for the same reason as
// signupWithEmail above.
export async function loginWithGoogle(): Promise<{ isNew: boolean; username: string; profilePic: string }> {
  const provider = new GoogleAuthProvider();
  const cred = await signInWithPopup(auth, provider);
  const { created, username, profilePic } = await ensureUserDoc(cred.user);
  return { isNew: created, username, profilePic };
}

export async function loginWithGithub(): Promise<{ isNew: boolean; username: string; profilePic: string }> {
  const provider = new GithubAuthProvider();
  const cred = await signInWithPopup(auth, provider);
  const { created, username, profilePic } = await ensureUserDoc(cred.user);
  return { isNew: created, username, profilePic };
}

export async function sendForgotPasswordEmail(email: string): Promise<void> {
  if (!email) throw new Error("Enter your email first.");
  await sendPasswordResetEmail(auth, email);
}

export async function logout(): Promise<void> {
  try {
    await signOut(auth);
  } catch {
    // silent, matches old behavior
  }
  // Hard navigation back to home so no in-memory state from the previous
  // account lingers — same reasoning as the old __doLogout.
  if (typeof window !== "undefined") {
    window.location.href = window.location.origin + "/";
  }
}
