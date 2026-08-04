"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import WalletModal from "@/components/wallet/WalletModal";
import { useAuth } from "@/lib/AuthContext";
import { useAuthModal } from "@/components/auth/AuthModalProvider";
import { useScrollLock } from "@/lib/useScrollLock";

// Ports window.__openWallet / window.__closeWallet from wallet.js. Same
// shape as AuthModalProvider — any component reaches this via
// useWalletModal().openWallet() instead of a global function.
interface WalletModalContextValue {
  openWallet: () => void;
}

const WalletModalContext = createContext<WalletModalContextValue>({
  openWallet: () => {},
});

export function useWalletModal() {
  return useContext(WalletModalContext);
}

export function WalletModalProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { openAuthModal } = useAuthModal();
  const [open, setOpen] = useState(false);
  useScrollLock(open);

  // Ports window.__openWallet's __requireAuth guard: signed-out visitors
  // get the auth modal instead of the wallet.
  function openWallet() {
    if (!user) {
      openAuthModal();
      return;
    }
    setOpen(true);
  }

  return (
    <WalletModalContext.Provider value={{ openWallet }}>
      {children}
      <WalletModal open={open} onClose={() => setOpen(false)} />
    </WalletModalContext.Provider>
  );
}
