"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import AgentModal from "@/components/agent/AgentModal";
import { useAuth } from "@/lib/AuthContext";
import { useAuthModal } from "@/components/auth/AuthModalProvider";
import { useScrollLock } from "@/lib/useScrollLock";

// Ports window.__openAgentModal / window.__closeAgentModal from
// plans-boost.js. Same shape as BoostModalProvider/WalletModalProvider —
// any component reaches this via useAgentModal().openAgent() instead of a
// global function. profile-early.js's #pmAiAgentBtn handler and
// core-early.js's '/aiagent' path-router branch are the two original call
// sites; both are now just openAgent() calls (see NavDrawer/Header + the
// /aiagent route).
interface AgentModalContextValue {
  openAgent: () => void;
}

const AgentModalContext = createContext<AgentModalContextValue>({
  openAgent: () => {},
});

export function useAgentModal() {
  return useContext(AgentModalContext);
}

export function AgentModalProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { openAuthModal } = useAuthModal();
  const [open, setOpen] = useState(false);
  useScrollLock(open);

  // Original's button is only reachable from the profile menu (signed-in
  // only), so there's no existing "signed out" UI for it — same guard
  // pattern as BoostModalProvider for consistency if it's ever surfaced
  // somewhere a signed-out user could reach.
  function openAgent() {
    if (!user) {
      openAuthModal();
      return;
    }
    setOpen(true);
  }

  return (
    <AgentModalContext.Provider value={{ openAgent }}>
      {children}
      <AgentModal open={open} onClose={() => setOpen(false)} />
    </AgentModalContext.Provider>
  );
}
