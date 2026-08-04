"use client";

import { useEffect, useState } from "react";

// ── Maintenance mode ─────────────────────────────────────────────────
//
// Live-reads config/maintenance in Firestore, same doc shape as the
// original (Js/firebase-init.js's listener):
//   { active: boolean, heading?: string, body?: string, updatedAt, updatedBy }
// Only admin.js's setMaintenanceMode action can write this doc — this
// hook is read-only.
//
// ADMIN BYPASS — NOT IMPLEMENTED HERE. The original lifts the overlay
// for a signed-in admin (window.__isAdmin, set via a server-verified
// amIAdmin check after login) so admins can keep working while
// maintenance mode is active for everyone else. Next.js has no
// isAdmin/amIAdmin client wiring anywhere yet (checked: no such
// state exists in lib/AuthContext.tsx or elsewhere) — building that is
// a separate, real piece of work (server-verified admin-status check +
// auth context wiring), not something to bolt on inside a maintenance
// hook. Until that exists, this hook has no way to know if the current
// user is an admin, so maintenance mode applies to EVERYONE while
// active, admins included. Flagging this clearly rather than silently
// shipping a bypass that doesn't actually check anything.
export interface MaintenanceState {
  active: boolean;
  heading: string | null;
  body: string | null;
}

export function useMaintenanceMode(): MaintenanceState {
  const [state, setState] = useState<MaintenanceState>({ active: false, heading: null, body: null });

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      const { doc, onSnapshot } = await import("firebase/firestore");
      const { db } = await import("@/lib/firebase");
      if (cancelled) return;

      unsub = onSnapshot(
        doc(db, "config", "maintenance"),
        (snap) => {
          const data = snap.exists() ? snap.data() : {};
          setState({
            active: !!data.active,
            heading: data.heading || null,
            body: data.body || null,
          });
        },
        (err) => {
          // Missing Firestore rule or offline — fail OPEN (don't lock
          // visitors out due to a read error), matching the original's
          // documented behavior.
          console.error("[useMaintenanceMode] listener error, failing open:", err);
          setState({ active: false, heading: null, body: null });
        }
      );
    })();

    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, []);

  return state;
}

// ── Banned / suspended account status ────────────────────────────────
//
// Purely a display layer over whatever the user's own Firestore doc
// already says — this hook never writes banned/suspended/suspendedUntil
// itself (only the admin console can). Derives "is this restriction
// currently active" the same way the original did: a suspension only
// counts if suspendedUntil is still in the future (an expired
// suspendedUntil left stale in Firestore must not block forever); a ban
// has no expiry and is always active once set.
export interface AccountStatus {
  isBanned: boolean;
  isSuspendedActive: boolean;
  banReason: string | null;
  suspendReason: string | null;
  suspendedUntilMs: number | null;
}

function toMillis(v: unknown): number | null {
  if (!v) return null;
  const obj = v as { toDate?: () => Date };
  if (typeof obj.toDate === "function") return obj.toDate().getTime();
  const d = new Date(v as string | number);
  return isNaN(d.getTime()) ? null : d.getTime();
}

export function deriveAccountStatus(userData: Record<string, unknown> | null | undefined): AccountStatus {
  const isBanned = !!(userData && userData.banned);
  const suspendedUntilMs = userData ? toMillis(userData.suspendedUntil) : null;
  const isSuspendedActive = !!(userData && userData.suspended && suspendedUntilMs && suspendedUntilMs > Date.now());

  return {
    isBanned,
    isSuspendedActive,
    banReason: (userData?.banReason as string) || null,
    suspendReason: (userData?.suspendReason as string) || null,
    suspendedUntilMs,
  };
}
