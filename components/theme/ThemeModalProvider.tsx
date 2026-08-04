"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { doc, setDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useAuth } from "@/lib/AuthContext";
import ThemeModal from "@/components/theme/ThemeModal";
import { useScrollLock } from "@/lib/useScrollLock";

export interface SiteTheme {
  id: string;
  type: "color" | "image";
  src?: string;
  color?: string;
  overlay?: string;
  textmode?: string;
}

const STORAGE_KEY = "siterifty_theme";

export const DEFAULT_THEME: SiteTheme = {
  id: "color-black",
  type: "color",
  color: "#000000",
  overlay: "rgba(0,0,0,0)",
  textmode: "dark",
};

// Ports __applyTheme from auth-modal.js: writes the CSS custom properties
// #appThemeBg / body.theme-active read, exactly matching the original's
// color-vs-gradient-vs-image branches.
export function applyTheme(theme: SiteTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement.style;
  if (theme.type === "color") {
    const color = theme.color || "#000000";
    const isGradient = color.startsWith("linear-gradient") || color.startsWith("radial-gradient");
    if (isGradient) {
      root.setProperty("--app-theme-bg", color);
      root.setProperty("--app-theme-color", "transparent");
    } else {
      root.setProperty("--app-theme-bg", "none");
      root.setProperty("--app-theme-color", color);
    }
    root.setProperty("--app-theme-overlay", theme.overlay || "rgba(0,0,0,0)");
  } else {
    root.setProperty("--app-theme-bg", `url('${theme.src}')`);
    root.setProperty("--app-theme-color", "transparent");
    root.setProperty("--app-theme-overlay", "rgba(0,0,0,0.55)");
  }
  document.getElementById("appThemeBg")?.classList.add("active");
  document.body.classList.add("theme-active");
  document.body.classList.remove("theme-light");
}

// Ports __saveThemeToFirestore — best-effort, never blocks the UI.
async function saveThemeToFirestore(theme: SiteTheme) {
  const user = auth.currentUser;
  if (!user) return;
  try {
    await setDoc(doc(db, "users", user.uid), { theme }, { merge: true });
  } catch {
    // silent — local theme already applied, Firestore sync is non-critical
  }
}

export function persistTheme(theme: SiteTheme) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
  } catch {}
  saveThemeToFirestore(theme);
}

interface ThemeModalContextValue {
  openThemePicker: () => void;
  closeThemePicker: () => void;
}

const ThemeModalContext = createContext<ThemeModalContextValue>({
  openThemePicker: () => {},
  closeThemePicker: () => {},
});

export function useThemeModal() {
  return useContext(ThemeModalContext);
}

export function ThemeModalProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  useScrollLock(open);

  // Restore a previously chosen theme on page load — ports the
  // `_restoreTheme` IIFE in auth-modal.js. localStorage wins on first
  // paint (no network round trip needed); Firestore's copy of `theme`
  // on users/{uid} is what synced it here across devices in the first
  // place, but AuthContext doesn't currently carry that field (Step 2's
  // own comment: only the subset the UI needs so far), so this is
  // local-only for now, same as a signed-out visitor in the original.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed) {
          applyTheme(parsed);
          return;
        }
      }
    } catch {
      // ignore corrupted storage
    }
    // No saved theme yet — default to Black.
    applyTheme(DEFAULT_THEME);
  }, []);

  const plan = profile?.plan || "free";

  return (
    <ThemeModalContext.Provider
      value={{
        openThemePicker: () => setOpen(true),
        closeThemePicker: () => setOpen(false),
      }}
    >
      {children}
      <ThemeModal open={open} onClose={() => setOpen(false)} plan={plan} />
    </ThemeModalContext.Provider>
  );
}
