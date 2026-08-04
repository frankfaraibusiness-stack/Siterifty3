"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { useAuthModal } from "@/components/auth/AuthModalProvider";

// Was the modal-opening context for the old PlansModal popup. PlansModal
// is now a full page at /upgrade (see app/upgrade/) for a more premium,
// dedicated feel than a centered overlay — this provider keeps the exact
// same openPlansModal(plan?) API every call site already uses (Profile
// hub, AnnouncementBar, NavDrawer, BillingPanel, sell picker,
// useAdGatedPreview) so none of them need to change; it now navigates to
// /upgrade?plan=... instead of flipping modal state.
type PlanKey = "starter" | "growth" | "pro";

interface PlansModalContextValue {
  openPlansModal: (preselect?: PlanKey) => void;
}

const PlansModalContext = createContext<PlansModalContextValue>({
  openPlansModal: () => {},
});

export function usePlansModal() {
  return useContext(PlansModalContext);
}

export function PlansModalProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { openAuthModal } = useAuthModal();
  const router = useRouter();

  function openPlansModal(plan?: PlanKey) {
    if (!user) {
      openAuthModal();
      return;
    }
    router.push(plan ? `/upgrade?plan=${plan}` : "/upgrade");
  }

  return <PlansModalContext.Provider value={{ openPlansModal }}>{children}</PlansModalContext.Provider>;
}
