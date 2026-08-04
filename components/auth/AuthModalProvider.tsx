"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import AuthModal from "@/components/auth/AuthModal";

type AuthModalTab = "login" | "signup";

interface AuthModalContextValue {
  // Accepts `unknown` rather than just `AuthModalTab | undefined` because
  // this function is used two ways: called directly with a tab
  // ("signup"/"login") from code that wants a specific tab, AND passed
  // as-is to onClick={openAuthModal} in older call sites, where React
  // invokes it with a MouseEvent instead. The implementation below
  // narrows and validates whatever comes in.
  openAuthModal: (tab?: unknown) => void;
}

const AuthModalContext = createContext<AuthModalContextValue>({
  openAuthModal: () => {},
});

export function useAuthModal() {
  return useContext(AuthModalContext);
}

export function AuthModalProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  // Defaults to "login" to match the modal's own pre-existing default —
  // only overridden when a caller (e.g. the homepage's ?auth=signup
  // handoff from /r/[username]) explicitly asks to open on signup.
  const [initialTab, setInitialTab] = useState<AuthModalTab>("login");
  const router = useRouter();

  return (
    <AuthModalContext.Provider
      value={{
        openAuthModal: (tab) => {
          // openAuthModal is still passed directly as onClick={openAuthModal}
          // in a couple of older call sites (SignInRequired,
          // SellerProfileClient) — React calls those handlers with the
          // MouseEvent as the first argument, not a tab string. Only
          // "login"/"signup" are treated as an explicit tab request;
          // anything else (a MouseEvent, undefined) falls back to
          // "login", same as calling openAuthModal() with no args always
          // did before initialTab existed.
          setInitialTab(tab === "login" || tab === "signup" ? tab : "login");
          setOpen(true);
        },
      }}
    >
      {children}
      <AuthModal
        open={open}
        initialTab={initialTab}
        onClose={() => setOpen(false)}
        onSignupComplete={(username) => {
          // Onboarding now lives at its own /onboarding route instead of
          // opening as a modal over the current page. Same 300ms delay
          // after the auth modal closes as before.
          setTimeout(() => {
            setOpen(false);
            router.push(`/onboarding?username=${encodeURIComponent(username)}`);
          }, 300);
        }}
      />
    </AuthModalContext.Provider>
  );
}
