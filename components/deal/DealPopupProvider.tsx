"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import DealPopup from "@/components/deal/DealPopup";
import { useAuth } from "@/lib/AuthContext";
import { useAuthModal } from "@/components/auth/AuthModalProvider";
import type { Listing } from "@/lib/listings";

// Ports window.__openDeal / mpOpenDeal's sign-in gate as a real provider,
// same shape as BoostModalProvider/WalletModalProvider — any component
// reaches this via useDealPopup().openDeal(listing) instead of a global
// function + getElementById.
interface DealPopupContextValue {
  openDeal: (listing: Listing) => void;
}

const DealPopupContext = createContext<DealPopupContextValue>({
  openDeal: () => {},
});

export function useDealPopup() {
  return useContext(DealPopupContext);
}

export function DealPopupProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { openAuthModal } = useAuthModal();
  const [listing, setListing] = useState<Listing | null>(null);

  // Ports mpOpenDeal's `if (!window.__auth?.currentUser) { document
  // .querySelector('.btn-login')?.click(); return; }` guard — this app's
  // sign-in entry point is useAuthModal() rather than a DOM query.
  function openDeal(l: Listing) {
    if (!user) {
      openAuthModal();
      return;
    }
    setListing(l);
  }

  return (
    <DealPopupContext.Provider value={{ openDeal }}>
      {children}
      <DealPopup listing={listing} onClose={() => setListing(null)} />
    </DealPopupContext.Provider>
  );
}
