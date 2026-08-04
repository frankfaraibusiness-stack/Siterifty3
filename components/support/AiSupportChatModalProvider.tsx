"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import AiSupportChatPanel from "@/components/support/AiSupportChatPanel";

// Ports window.__openAiSupportChat from Js/ai-support-chat.js. Same
// shape as BoostModalProvider/WalletModalProvider — any component
// reaches this via useAiSupportChatModal().openAiSupportChat() instead
// of a global window function.
//
// Not yet wired to any caller (e.g. the inbox's "AI Support" row still
// routes to /help) — that hookup is a separate, later step. This just
// makes the panel itself available app-wide.
interface AiSupportChatModalContextValue {
  openAiSupportChat: () => void;
}

const AiSupportChatModalContext = createContext<AiSupportChatModalContextValue>({
  openAiSupportChat: () => {},
});

export function useAiSupportChatModal() {
  return useContext(AiSupportChatModalContext);
}

export function AiSupportChatModalProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <AiSupportChatModalContext.Provider value={{ openAiSupportChat: () => setOpen(true) }}>
      {children}
      <AiSupportChatPanel open={open} onClose={() => setOpen(false)} />
    </AiSupportChatModalContext.Provider>
  );
}
