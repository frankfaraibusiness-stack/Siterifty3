"use client";

import { createContext, useContext, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import LogoutModal from "@/components/layout/LogoutModal";
import { logout } from "@/lib/authActions";
import { useScrollLock } from "@/lib/useScrollLock";

// Ports window.__confirmLogout / window.__logoutWithConfirm from
// Js/logout-share.js. confirmLogout() resolves true if the user confirmed
// sign-out (and has already called authActions.logout() by the time it
// resolves) or false if they cancelled — same contract as the original
// __logoutWithConfirm, minus the afterConfirmCallback param (callers can
// just await confirmLogout() then run their own cleanup, e.g. closeNav()).

interface LogoutModalContextValue {
  confirmLogout: () => Promise<boolean>;
}

const LogoutModalContext = createContext<LogoutModalContextValue>({
  confirmLogout: async () => false,
});

export function useLogoutModal() {
  return useContext(LogoutModalContext);
}

export function LogoutModalProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const resolveRef = useRef<((result: boolean) => void) | null>(null);

  // Scroll lock — shared across every modal/overlay in the app.
  useScrollLock(open);

  // Escape-to-cancel, matching the original's document-level keydown guard.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close(result: boolean) {
    setOpen(false);
    if (resolveRef.current) {
      resolveRef.current(result);
      resolveRef.current = null;
    }
  }

  const confirmLogout = useCallback(() => {
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    }).then(async (ok) => {
      if (ok) await logout();
      return ok;
    });
  }, []);

  return (
    <LogoutModalContext.Provider value={{ confirmLogout }}>
      {children}
      <LogoutModal open={open} onConfirm={() => close(true)} onCancel={() => close(false)} />
    </LogoutModalContext.Provider>
  );
}
