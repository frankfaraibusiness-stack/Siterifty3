"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import DisputePicker from "@/components/dispute/DisputePicker";
import { useAuth } from "@/lib/AuthContext";
import { useAuthModal } from "@/components/auth/AuthModalProvider";

// Ports window.__openDisputePicker as a real provider, same shape as
// DealPopupProvider/BoostModalProvider — any component reaches this via
// useDisputePicker().openDisputePicker() instead of a global function.
interface DisputePickerContextValue {
  openDisputePicker: () => void;
}

const DisputePickerContext = createContext<DisputePickerContextValue>({
  openDisputePicker: () => {},
});

export function useDisputePicker() {
  return useContext(DisputePickerContext);
}

export function DisputePickerProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { openAuthModal } = useAuthModal();
  const [open, setOpen] = useState(false);

  // The original's _loadDeals throws "Please sign in first." as an
  // in-picker error state if opened signed-out; this app has a real
  // sign-in entry point (useAuthModal()) to surface earlier instead,
  // same UX upgrade DealPopupProvider/BoostModalProvider already apply
  // to their own original inline-error/DOM-query guards.
  function openDisputePicker() {
    if (!user) {
      openAuthModal();
      return;
    }
    setOpen(true);
  }

  return (
    <DisputePickerContext.Provider value={{ openDisputePicker }}>
      {children}
      <DisputePicker open={open} onClose={() => setOpen(false)} />
    </DisputePickerContext.Provider>
  );
}
