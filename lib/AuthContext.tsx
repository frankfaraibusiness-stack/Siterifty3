"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { onAuthStateChanged, type User as FirebaseUser } from "firebase/auth";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

// Fields we read from users/{uid} in Firestore. Only the subset the UI
// currently needs (Header pill, nav drawer account card) — more fields
// (banned status, admin flag, etc.) can be added here in a later step
// without touching any consumer of this context.
export interface UserProfile {
  username: string;
  profilePic: string | null;
  walletBalance: number;
  plan: string;
  currency: string | null;
}

interface AuthContextValue {
  // `undefined` = we don't know yet (initial load).
  // `null` = we checked, nobody is signed in.
  // FirebaseUser = signed in.
  user: FirebaseUser | null | undefined;
  profile: UserProfile | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  user: undefined,
  profile: null,
  loading: true,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<FirebaseUser | null | undefined>(undefined);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Firestore doesn't open its real network channel (the underlying
  // gRPC/WebSocket connection + auth handshake) until its first actual
  // read or listener fires — everything before that is just local SDK
  // setup. For a signed-in user the profile listener below happens to
  // warm it immediately, but a signed-out visitor (or any session where
  // the first Firestore touch is deep in some other component — the
  // marketplace grid, a seller page, the wallet modal) pays that
  // one-time connection cost on whatever they happen to click first.
  // Firing one cheap, throwaway read here — as early as possible, tied
  // to nothing else — means that cost is already paid by the time any
  // button is clicked, session-wide, regardless of sign-in state.
  useEffect(() => {
    getDoc(doc(db, "_warmup", "ping")).catch(() => {
      /* connection warmup only — result and any error are irrelevant */
    });
  }, []);

  // Auth state: replaces window.__authReady / onAuthStateChanged wiring
  // from firebase-init.js. Fires once on load with the current user (or
  // null), then again on every login/logout.
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // Profile doc: replaces the getDoc(doc(db,'users',uid)) call inside
  // __syncUserSession. Using onSnapshot instead of a one-time getDoc so
  // wallet balance / plan changes (e.g. after a PayPal webhook updates
  // Firestore) reflect live without a manual refresh.
  useEffect(() => {
    if (!user) {
      setProfile(null);
      return;
    }
    const ref = doc(db, "users", user.uid);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setProfile(null);
          return;
        }
        const data = snap.data();
        setProfile({
          username: data.username || user.displayName || user.email?.split("@")[0] || "User",
          profilePic: data.profilePic || null,
          walletBalance: Number(data.walletBalance || 0),
          plan: data.plan || "free",
          currency: data.currency || null,
        });
      },
      (err) => {
        console.error("[AuthContext] profile listener error:", err);
      }
    );
    return () => unsub();
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, profile, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

// One-time profile fetch, for places that need a value without subscribing
// (e.g. right after signup, before the listener above has necessarily fired).
export async function fetchUserProfileOnce(uid: string): Promise<UserProfile | null> {
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) return null;
  const data = snap.data();
  return {
    username: data.username || "User",
    profilePic: data.profilePic || null,
    walletBalance: Number(data.walletBalance || 0),
    plan: data.plan || "free",
    currency: data.currency || null,
  };
}
