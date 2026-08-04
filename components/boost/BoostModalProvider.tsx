"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import BoostModal, { type BoostListingData } from "@/components/boost/BoostModal";
import { useAuth } from "@/lib/AuthContext";
import { useAuthModal } from "@/components/auth/AuthModalProvider";
import { useScrollLock } from "@/lib/useScrollLock";

// Ports window.__openBoostModal(listingId, listingData?) from
// sellers-transfer.js. Same shape as WalletModalProvider/AuthModalProvider
// — any component reaches this via useBoostModal().openBoost(id, data)
// instead of a global function.
interface BoostModalContextValue {
  openBoost: (listingId: string, listing?: BoostListingData | null) => void;
}

const BoostModalContext = createContext<BoostModalContextValue>({
  openBoost: () => {},
});

export function useBoostModal() {
  return useContext(BoostModalContext);
}

export function BoostModalProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { openAuthModal } = useAuthModal();
  const [open, setOpen] = useState(false);
  const [listingId, setListingId] = useState<string | null>(null);
  const [listing, setListing] = useState<BoostListingData | null>(null);
  useScrollLock(open);

  // Ports the __openBoostModal guard implied by the original's submit-time
  // "sign in required" check — surfaced earlier here (at open-time) for a
  // better UX, same as WalletModalProvider does for the wallet.
  function openBoost(id: string, data?: BoostListingData | null) {
    if (!user) {
      openAuthModal();
      return;
    }
    setListingId(id);
    setListing(data || null);
    setOpen(true);
  }

  return (
    <BoostModalContext.Provider value={{ openBoost }}>
      {children}
      <BoostModal open={open} onClose={() => setOpen(false)} listingId={listingId} listing={listing} />
    </BoostModalContext.Provider>
  );
}
