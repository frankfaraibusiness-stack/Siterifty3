"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAgentModal } from "@/components/agent/AgentModalProvider";
import NavSpinnerIcon from "@/components/shared/NavSpinnerIcon";

// Ports core-early.js's path-router branch: `path === '/aiagent' &&
// window.__openAgentModal` — the original never rendered a real page here,
// it just opened the modal over whatever was already showing and reset the
// path to '/' on close (see AgentModal's onClose). Mirrored here: this
// route's only job is to open the modal, then immediately clear itself
// back to '/' so the URL bar doesn't get stuck on a route with no page
// content of its own once the modal is closed by the user.
//
// Renders a brief centered spinner instead of returning null — this
// route has no loading.tsx (there's nothing to skeleton, since it's not
// a real content page), so without something here the tap-to-modal-open
// gap was a blank screen, same "silence reads as broken" issue
// lib/useNavigating.ts documents for the outbound side of a nav.
export default function AiAgentPage() {
  const router = useRouter();
  const { openAgent } = useAgentModal();

  useEffect(() => {
    openAgent();
    router.replace("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh", color: "var(--mp-text-sec, rgba(255,255,255,0.4))" }}>
      <NavSpinnerIcon size={22} />
    </div>
  );
}
