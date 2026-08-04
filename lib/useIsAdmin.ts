"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";

// Asks the server "is the signed-in user the admin" via the existing
// amIAdmin action (app/api/account/_handler.js actionAmIAdmin) — reused
// as-is rather than duplicated, so there's exactly one place that knows
// the ADMIN_EMAIL check. This hook only controls whether the blog's "+"
// button renders; it is NOT the security boundary (a hidden button
// proves nothing) — every actual write is re-verified server-side in
// app/api/blog/route.ts.
export function useIsAdmin(): boolean {
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!user) {
      setIsAdmin(false);
      return;
    }
    let cancelled = false;
    user.getIdToken().then((idToken) => {
      fetch("/api/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "amIAdmin", idToken }),
      })
        .then((res) => res.json())
        .then((json) => {
          if (!cancelled) setIsAdmin(!!json.isAdmin);
        })
        .catch(() => {
          if (!cancelled) setIsAdmin(false);
        });
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  return isAdmin;
}
