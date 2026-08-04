"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import EditListingModal from "@/components/listing/EditListingModal";
import type { Listing } from "@/lib/listings";
import { useAuth } from "@/lib/AuthContext";
import { useAuthModal } from "@/components/auth/AuthModalProvider";
import { useScrollLock } from "@/lib/useScrollLock";

// Ports window.__openEditListingModal(listingId) from sellers-transfer.js.
// Same shape as BoostModalProvider/WalletModalProvider — any component
// reaches this via useEditListingModal().openEdit(id) instead of a global
// function. onSaved/onDeleted callbacks let the caller (e.g. MyProfileHub's
// listings list) update its own local state without a full refetch —
// mirrors the original's pmLoadListings()/lmLoadUserData() refresh calls.
interface EditListingModalContextValue {
  openEdit: (listingId: string, callbacks?: { onSaved?: (listing: Listing) => void; onDeleted?: (listingId: string) => void }) => void;
}

const EditListingModalContext = createContext<EditListingModalContextValue>({
  openEdit: () => {},
});

export function useEditListingModal() {
  return useContext(EditListingModalContext);
}

export function EditListingModalProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { openAuthModal } = useAuthModal();
  const [open, setOpen] = useState(false);
  const [listingId, setListingId] = useState<string | null>(null);
  const [onSaved, setOnSaved] = useState<((listing: Listing) => void) | undefined>(undefined);
  const [onDeleted, setOnDeleted] = useState<((listingId: string) => void) | undefined>(undefined);
  useScrollLock(open);

  function openEdit(id: string, callbacks?: { onSaved?: (listing: Listing) => void; onDeleted?: (listingId: string) => void }) {
    if (!user) {
      openAuthModal();
      return;
    }
    setListingId(id);
    // Stored via the functional form so React doesn't treat the callback
    // itself as a state updater function.
    setOnSaved(() => callbacks?.onSaved);
    setOnDeleted(() => callbacks?.onDeleted);
    setOpen(true);
  }

  return (
    <EditListingModalContext.Provider value={{ openEdit }}>
      {children}
      <EditListingModal
        open={open}
        onClose={() => setOpen(false)}
        listingId={listingId}
        onSaved={onSaved}
        onDeleted={onDeleted}
      />
    </EditListingModalContext.Provider>
  );
}
