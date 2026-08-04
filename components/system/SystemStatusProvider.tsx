"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { useMaintenanceMode, deriveAccountStatus } from "@/lib/accountStatus";
import MaintenanceOverlay from "./MaintenanceOverlay";
import AccountStatusOverlay from "./AccountStatusOverlay";
import AccountAppealOverlay from "./AccountAppealOverlay";

// Mounted once in app/layout.tsx. Coordinates:
//  1. Site-wide maintenance mode (config/maintenance, applies to signed-
//     out visitors too — started independent of auth, same as the
//     original's firebase-init.js listener).
//  2. The signed-in user's own banned/suspended status (users/{uid}),
//     which takes priority over maintenance mode exactly like the
//     original: an overlay is an overlay, only one shows at a time, and
//     a banned/suspended user needs to see THEIR OWN restriction and
//     appeal path even if maintenance mode also happens to be active.
//
// Deliberately reads users/{uid} directly here rather than widening
// lib/AuthContext.tsx's UserProfile type — that type's own comment
// notes banned/admin fields are intentionally deferred to "a later
// step" rather than added speculatively, and this is the one place
// that currently needs them.
export default function SystemStatusProvider() {
  const { user } = useAuth();
  const maintenance = useMaintenanceMode();
  const [userData, setUserData] = useState<Record<string, unknown> | null>(null);
  const [appealOpen, setAppealOpen] = useState(false);

  useEffect(() => {
    setAppealOpen(false);
    if (!user) {
      setUserData(null);
      return;
    }
    let unsub: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      const { doc, onSnapshot } = await import("firebase/firestore");
      const { db } = await import("@/lib/firebase");
      if (cancelled) return;
      unsub = onSnapshot(
        doc(db, "users", user.uid),
        (snap) => setUserData(snap.exists() ? (snap.data() as Record<string, unknown>) : null),
        (err) => console.error("[SystemStatusProvider] user doc listener error:", err)
      );
    })();
    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [user]);

  const accountStatus = deriveAccountStatus(userData);
  const restricted = accountStatus.isBanned || accountStatus.isSuspendedActive;
  const anyOverlayActive = restricted || maintenance.active;

  // Ports the original's document.body/documentElement.classList.toggle
  // ('mnt-mode', ...) — that class is what actually locks scroll (see
  // globals.css's html.mnt-mode / body.mnt-mode rules); rendering the
  // overlay markup alone doesn't lock scroll on its own.
  useEffect(() => {
    document.documentElement.classList.toggle("mnt-mode", anyOverlayActive);
    document.body.classList.toggle("mnt-mode", anyOverlayActive);
    return () => {
      document.documentElement.classList.remove("mnt-mode");
      document.body.classList.remove("mnt-mode");
    };
  }, [anyOverlayActive]);

  // A restricted account's own overlay takes priority over the
  // site-wide maintenance takeover — the user needs to see and be able
  // to act on (appeal) their own restriction regardless of maintenance
  // state.
  if (restricted) {
    return appealOpen ? (
      <AccountAppealOverlay onCancel={() => setAppealOpen(false)} />
    ) : (
      <AccountStatusOverlay status={accountStatus} onAppeal={() => setAppealOpen(true)} />
    );
  }

  if (maintenance.active) {
    return <MaintenanceOverlay active={maintenance.active} heading={maintenance.heading} body={maintenance.body} />;
  }

  return null;
}
