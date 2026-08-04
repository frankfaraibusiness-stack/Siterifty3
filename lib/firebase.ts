// Client-side Firebase init.
// Replaces the old window.__auth / window.__db / window.__dbReady pattern
// from Js/firebase-init.js with a plain module you import where needed:
//
//   import { auth, db } from "@/lib/firebase";
//
// No polling, no globals — imports are resolved before your component
// code runs, so `auth` and `db` are always ready by the time you use them.

import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getAnalytics, isSupported, type Analytics } from "firebase/analytics";

// These are the Firebase *client* config values — safe to hardcode.
// They identify your Firebase project (like a public API endpoint), they
// are not secrets: they're visible to anyone in browser dev tools on any
// live Firebase web app. Actual access control happens through Firestore
// security rules, not by hiding these values. Hardcoding them here means
// you don't need to set 7 separate env vars in Vercel for the app to build
// and run — one less thing to configure.
//
// (The genuinely secret values — Firebase ADMIN credentials, used only in
// app/api/account's server-side code — are NOT here, and must stay as
// real env vars. Never hardcode those.)
const firebaseConfig = {
  apiKey: "AIzaSyCMdI_bIYse6j3GyGDBnbE6FoGNnPKaMao",
  authDomain: "siterifty.firebaseapp.com",
  projectId: "siterifty",
  storageBucket: "siterifty.firebasestorage.app",
  messagingSenderId: "621084177882",
  appId: "1:621084177882:web:457b20de4d5787b2e8fce3",
  measurementId: "G-55JGHRHKZK",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

export let analytics: Analytics | undefined;
if (typeof window !== "undefined") {
  isSupported().then((supported) => {
    if (supported) analytics = getAnalytics(app);
  });
}

export default app;
