"use client";

// Ports the AI Support chat panel from Js/ai-support-chat.js (lines
// 1-200ish — window.__openAiSupportChat, its localStorage-backed
// per-account conversation log, and the send loop against
// /api/aistudio's `chat` action). That backend action is untouched
// legacy code (see app/api/aistudio/_handler.js) so this only needed a
// frontend port.
//
// NOT ported here (deliberately out of scope for this pass): the rest
// of ai-support-chat.js — window.__aiStudioCall, the listing
// auto-description buttons, and the deal-message AI assist — those are
// separate features tied to the listing forms / deal chat, not the
// support panel itself.
//
// Entry point: this is mounted globally via AiSupportChatModalProvider,
// same tier as BoostModalProvider/WalletModalProvider. It is NOT yet
// wired into the inbox's "AI Support" row (that still routes to /help) —
// left alone on purpose per current scope.

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { auth } from "@/lib/firebase";
import { useAuthModal } from "@/components/auth/AuthModalProvider";
import { useScrollLock } from "@/lib/useScrollLock";

const ASP_WELCOME =
  "Hi! I'm the Siterifty AI Support assistant. Ask me anything about deals, your account, or type @username if you need to report someone.";

type EntryType = "system" | "user" | "assistant";

interface LogEntry {
  type: EntryType;
  text: string;
}

function storageKey() {
  const u = auth.currentUser;
  return "siterifty_ai_chat_" + (u ? u.uid : "guest");
}

function loadStored(key: string): LogEntry[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error("AI chat: failed to read saved conversation", e);
    return [];
  }
}

function saveStored(key: string, messages: LogEntry[]) {
  try {
    localStorage.setItem(key, JSON.stringify(messages));
  } catch (e) {
    console.error("AI chat: failed to save conversation", e);
  }
}

export default function AiSupportChatPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { openAuthModal } = useAuthModal();
  const [log, setLog] = useState<LogEntry[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const loadedKeyRef = useRef<string | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const renderForKey = useCallback((key: string) => {
    let stored = loadStored(key);
    if (stored.length === 0) {
      stored = [{ type: "system", text: ASP_WELCOME }];
      saveStored(key, stored);
    }
    setLog(stored);
    loadedKeyRef.current = key;
  }, []);

  // Load/refresh the right account's conversation whenever the panel opens
  // (also re-checks on each open in case the signed-in user changed since
  // last time, matching the original's per-account key switch).
  useEffect(() => {
    if (!open) return;
    const key = storageKey();
    if (loadedKeyRef.current !== key) renderForKey(key);
  }, [open, renderForKey]);

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [log, sending]);

  // Scroll lock — shared across every modal/overlay in the app.
  useScrollLock(open);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  function persist(next: LogEntry[]) {
    setLog(next);
    saveStored(storageKey(), next);
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;
    const user = auth.currentUser;
    if (!user) {
      openAuthModal();
      return;
    }

    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    const afterUser = [...log, { type: "user" as const, text }];
    persist(afterUser);
    setSending(true);

    try {
      const idToken = await user.getIdToken();
      const history = afterUser
        .filter((e) => e.type === "user" || e.type === "assistant")
        .map((e) => ({ role: e.type, content: e.text }));

      const res = await fetch("/api/aistudio", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + idToken,
        },
        body: JSON.stringify({ action: "chat", messages: history }),
      });

      if (!res.ok) {
        persist([
          ...afterUser,
          { type: "system", text: "Something went wrong reaching support. Please try again in a moment." },
        ]);
      } else {
        const data = await res.json();
        const reply: string = data.reply || "Sorry, I didn't catch that — could you try again?";
        persist([...afterUser, { type: "assistant", text: reply }]);
      }
    } catch (e) {
      console.error("AI support error:", e);
      persist([...afterUser, { type: "system", text: "Connection issue — please try again." }]);
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }

  function handleClear() {
    const key = storageKey();
    const fresh: LogEntry[] = [{ type: "system", text: ASP_WELCOME }];
    saveStored(key, fresh);
    setLog(fresh);
    setConfirmingClear(false);
  }

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10050,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.55)",
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 440,
          height: "min(640px, 90vh)",
          background: "#15171c",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 16,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 16px",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                background: "linear-gradient(135deg,#6d5bff,#8f7bff)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 15,
              }}
            >
              ✨
            </div>
            <div style={{ color: "#fff", fontWeight: 600, fontSize: 15 }}>AI Support</div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => setConfirmingClear(true)}
              disabled={sending}
              style={{
                background: "transparent",
                border: "none",
                color: "rgba(255,255,255,0.55)",
                fontSize: 13,
                cursor: sending ? "default" : "pointer",
                padding: "4px 8px",
              }}
            >
              Clear
            </button>
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                background: "transparent",
                border: "none",
                color: "rgba(255,255,255,0.7)",
                fontSize: 18,
                cursor: "pointer",
                padding: "4px 8px",
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Messages */}
        <div
          ref={messagesRef}
          data-scroll-lock-exempt
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {log.map((entry, i) =>
            entry.type === "system" ? (
              <div
                key={i}
                style={{
                  alignSelf: "center",
                  color: "rgba(255,255,255,0.5)",
                  fontSize: 12.5,
                  textAlign: "center",
                  maxWidth: "90%",
                  padding: "6px 10px",
                }}
              >
                {entry.text}
              </div>
            ) : (
              <div
                key={i}
                style={{
                  alignSelf: entry.type === "user" ? "flex-end" : "flex-start",
                  maxWidth: "80%",
                }}
              >
                <div
                  style={{
                    background: entry.type === "user" ? "#6d5bff" : "rgba(255,255,255,0.06)",
                    color: "#fff",
                    padding: "9px 13px",
                    borderRadius: 14,
                    fontSize: 14,
                    lineHeight: 1.4,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {entry.text}
                </div>
              </div>
            )
          )}
          {sending ? (
            <div style={{ alignSelf: "flex-start" }}>
              <div
                style={{
                  background: "rgba(255,255,255,0.06)",
                  padding: "10px 14px",
                  borderRadius: 14,
                  display: "flex",
                  gap: 4,
                }}
              >
                <span style={dotStyle} />
                <span style={{ ...dotStyle, animationDelay: "0.15s" }} />
                <span style={{ ...dotStyle, animationDelay: "0.3s" }} />
              </div>
            </div>
          ) : null}
        </div>

        {/* Composer */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 8,
            padding: 12,
            borderTop: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              const el = e.target;
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, 120) + "px";
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Ask a question…"
            rows={1}
            style={{
              flex: 1,
              resize: "none",
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 10,
              color: "#fff",
              padding: "9px 12px",
              fontSize: 14,
              lineHeight: 1.4,
              maxHeight: 120,
              fontFamily: "inherit",
            }}
          />
          <button
            onClick={handleSend}
            disabled={sending || !input.trim()}
            style={{
              background: "#6d5bff",
              border: "none",
              borderRadius: 10,
              color: "#fff",
              padding: "10px 16px",
              fontSize: 14,
              fontWeight: 600,
              cursor: sending || !input.trim() ? "default" : "pointer",
              opacity: sending || !input.trim() ? 0.5 : 1,
            }}
          >
            Send
          </button>
        </div>
      </div>

      {/* Clear-conversation confirm — inline overlay, same lightweight
          pattern as useConfirm.tsx, since the shared srfModal replacement
          this originally used (window.srfModal.confirm) was never
          ported as a global. */}
      {confirmingClear ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10060,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.6)",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirmingClear(false);
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 340,
              background: "#1c1e24",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 14,
              padding: 20,
              margin: 16,
            }}
          >
            <div style={{ color: "#fff", fontWeight: 700, fontSize: 16, marginBottom: 8 }}>
              Clear Conversation
            </div>
            <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 14, marginBottom: 18 }}>
              Clear this conversation? This can&apos;t be undone.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={() => setConfirmingClear(false)}
                style={{
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.15)",
                  color: "#fff",
                  borderRadius: 8,
                  padding: "8px 14px",
                  fontSize: 13.5,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleClear}
                style={{
                  background: "#e5484d",
                  border: "none",
                  color: "#fff",
                  borderRadius: 8,
                  padding: "8px 14px",
                  fontSize: 13.5,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const dotStyle: CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: "50%",
  background: "rgba(255,255,255,0.6)",
  display: "inline-block",
  animation: "asp-typing-bounce 1s infinite ease-in-out",
};
