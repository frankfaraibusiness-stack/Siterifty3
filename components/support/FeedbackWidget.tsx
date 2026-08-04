"use client";

// Redesigned feedback widget — previously had vote cycles, score
// breakdowns, countdown timers, "Working On" archive tabs, and weekly
// batch grouping. Now: floating launcher → clean modal → textarea →
// send. One job done cleanly. Backend action (feedback-submit) unchanged.
import { useEffect, useRef, useState } from "react";
import { auth } from "@/lib/firebase";
import { useScrollLock } from "@/lib/useScrollLock";

async function authedFetch<T = any>(action: string, extra?: Record<string, unknown>): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in to send feedback.");
  const idToken = await user.getIdToken();
  const res = await fetch("/api/aistudio", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ action, ...extra }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

export default function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [nudgeShown, setNudgeShown] = useState(false);

  // Daily random nudge — signed-in users only, small random delay
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsub = auth.onAuthStateChanged((u) => {
      if (!u) return;
      const delay = 10000 + Math.random() * 80000;
      timer = setTimeout(async () => {
        if (open) return;
        try {
          const data = await authedFetch<{ shouldShow: boolean }>("check-nudge");
          if (data.shouldShow) setNudgeShown(true);
        } catch {}
      }, delay);
    });
    return () => { unsub(); if (timer) clearTimeout(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openModal() {
    setOpen(true);
    setNudgeShown(false);
  }

  return (
    <>
      <button id="fbLauncher" type="button" onClick={openModal} aria-label="Give feedback">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        </svg>
        Feedback
      </button>

      {nudgeShown && (
        <div id="fbNudge" className="fb-show">
          <div className="fb-nudge-txt">Got a minute? We'd love to hear what you think.</div>
          <div className="fb-nudge-row">
            <button type="button" className="fb-nudge-yes" onClick={openModal}>Sure</button>
            <button type="button" className="fb-nudge-no" onClick={() => setNudgeShown(false)}>Not now</button>
          </div>
        </div>
      )}

      {open && <FeedbackModal onClose={() => setOpen(false)} />}
    </>
  );
}

function FeedbackModal({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<{ kind: "idle" | "ok" | "err"; msg: string }>({ kind: "idle", msg: "" });
  const [busy, setBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Scroll lock — shared reference-counted hook (see lib/useScrollLock.ts).
  // The previous plain body.style.overflow toggle here could capture a
  // stale "previous" value if another modal was locked at the same time,
  // then restore that stale value on close and leave scroll stuck.
  useScrollLock(true);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  async function handleSend() {
    const trimmed = text.trim();
    if (trimmed.length < 4) {
      setStatus({ kind: "err", msg: "Tell us a bit more first." });
      return;
    }
    setBusy(true);
    setStatus({ kind: "idle", msg: "" });
    try {
      const data = await authedFetch<{ message?: string }>("feedback-submit", { text: trimmed });
      setStatus({ kind: "ok", msg: data.message || "Thanks — we read every one! 🙏" });
      setText("");
    } catch (err: any) {
      setStatus({ kind: "err", msg: err.message || "Something went wrong." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      id="fbModal"
      role="dialog"
      aria-modal="true"
      aria-label="Feedback"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="fb-card">
        <div className="fb-head">
          <div className="fb-head-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
            Share Feedback
          </div>
          <button type="button" className="fb-close-btn" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="fb-body">
          <div className="fb-label">What's on your mind?</div>
          <textarea
            ref={textareaRef}
            className="fb-textarea"
            placeholder="A bug, an idea, something you love or hate — anything helps."
            value={text}
            maxLength={500}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSend();
            }}
          />
          <div className="fb-footer">
            <span className="fb-char">{text.length} / 500</span>
            <button type="button" className="fb-send-btn" disabled={busy} onClick={handleSend}>
              {busy ? "Sending…" : "Send Feedback"}
            </button>
          </div>
          {status.kind !== "idle" && (
            <div className={`fb-status ${status.kind}`}>{status.msg}</div>
          )}
        </div>
      </div>
    </div>
  );
}
