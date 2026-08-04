// Ports window.__aiStudioCall from Js/ai-support-chat.js (lines 204-219) —
// the shared helper "used by: listing auto-description buttons, deal-message
// assist, and anywhere else on the page that needs an AI Studio action."
//
// This app already has several inline `fetch('/api/aistudio', ...)` call
// sites (AiSupportChatPanel, FeedbackWidget, DealChatPanel,
// SellerProfileHeader) that predate this file and were each ported
// independently before this shared helper existed here — left as-is rather
// than churned, since none of them were broken. This helper exists so the
// two NEW call sites this step adds (listing auto-description, deal-message
// AI assist) don't duplicate a third/fourth copy of the same idToken +
// fetch + error-unwrap logic, matching the original's own "shared helper"
// intent for exactly those two features.
import { auth } from "@/lib/firebase";

export class AiStudioError extends Error {}

export async function aiStudioCall<T = any>(
  action: string,
  payload: Record<string, unknown> = {}
): Promise<T> {
  const user = auth.currentUser;
  if (!user) {
    throw new AiStudioError("You must be signed in to use AI features.");
  }
  const idToken = await user.getIdToken();

  const res = await fetch("/api/aistudio", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new AiStudioError(data.error || "AI request failed");
  }
  return data as T;
}

// Plan char caps mirror the server (aistudio.js PLAN_LIMITS): free=100,
// start=500, growth=1500, pro=5000. Server enforces the real cap
// regardless of what's sent here — this is just so the user isn't offered
// a length their plan doesn't allow.
export const AI_PLAN_CAPS: Record<string, number> = {
  free: 100,
  start: 500,
  growth: 1500,
  pro: 5000,
};

export function aiPlanCap(plan: string | undefined | null): number {
  return AI_PLAN_CAPS[plan || "free"] ?? AI_PLAN_CAPS.free;
}
