"use client";

import { useCallback, useState } from "react";
import { useScrollLock } from "./useScrollLock";

// Replaces the old global window.srfModal.confirm()/alert()/prompt()
// dialogs. The CSS for this (#srf-modal-overlay, #srf-modal-box,
// .srf-modal-btn, theme-* variants) already exists in app/globals.css —
// this hook now renders that exact markup instead of an ad-hoc inline
// overlay, matching the pattern lib/useAiLengthPicker.tsx already uses
// for #srfAiLenOverlay. One shared hook avoids ad-hoc copies of the same
// dialog scattered across settings panels, listing forms, and the deal
// chat panel.

export type ConfirmTheme = "success" | "warning" | "danger" | "info" | "report";

interface ConfirmOptions {
  theme?: ConfirmTheme;
  title: string;
  msg: string;
  confirmText?: string;
  cancelText?: string;
}

interface PromptOptions {
  theme?: ConfirmTheme;
  title: string;
  msg: string;
  inputPlaceholder?: string;
  confirmText?: string;
  cancelText?: string;
}

interface AlertOptions {
  theme?: ConfirmTheme;
  title: string;
  msg: string;
  okText?: string;
}

type PendingState =
  | { kind: "confirm"; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: "prompt"; opts: PromptOptions; resolve: (v: string | null) => void; value: string }
  | { kind: "alert"; opts: AlertOptions; resolve: () => void }
  | null;

// Maps our theme names to the .srf-modal-btn confirm-* modifier and the
// #srf-modal-icon theme-* modifier — both already defined in globals.css.
const THEME_CLASS: Record<ConfirmTheme, string> = {
  success: "success",
  warning: "warning",
  danger: "danger",
  info: "info",
  report: "report",
};

function ThemeIcon({ theme }: { theme: ConfirmTheme }) {
  switch (theme) {
    case "danger":
    case "warning":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      );
    case "success":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      );
    case "report":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
          <line x1="4" y1="22" x2="4" y2="15" />
        </svg>
      );
    case "info":
    default:
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      );
  }
}

export function useConfirm() {
  const [pending, setPending] = useState<PendingState>(null);

  // Every other modal/overlay in the app locks background scroll while
  // open (see useScrollLock.ts) — this dialog was the one exception,
  // which is why the page kept scrolling behind e.g. the "Restore Draft?"
  // prompt in the listing forms.
  useScrollLock(pending !== null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setPending({ kind: "confirm", opts, resolve });
    });
  }, []);

  const prompt = useCallback((opts: PromptOptions) => {
    return new Promise<string | null>((resolve) => {
      setPending({ kind: "prompt", opts, resolve, value: "" });
    });
  }, []);

  const alert = useCallback((opts: AlertOptions) => {
    return new Promise<void>((resolve) => {
      setPending({ kind: "alert", opts, resolve });
    });
  }, []);

  function close() {
    setPending(null);
  }

  const ConfirmHost = useCallback(() => {
    if (!pending) return null;
    const theme = pending.opts.theme || "info";
    const isPrompt = pending.kind === "prompt";
    const isAlert = pending.kind === "alert";
    const confirmBtnClass = isPrompt ? "confirm-input" : `confirm-${THEME_CLASS[theme]}`;

    function handleDismiss() {
      if (pending?.kind === "confirm") pending.resolve(false);
      else if (pending?.kind === "prompt") pending.resolve(null);
      else pending?.resolve();
      close();
    }

    function handleCancel() {
      if (pending?.kind === "confirm") pending.resolve(false);
      else if (pending?.kind === "prompt") pending.resolve(null);
      close();
    }

    function handleConfirm() {
      if (pending?.kind === "confirm") pending.resolve(true);
      else if (pending?.kind === "prompt") pending.resolve(pending.value.trim() || null);
      else pending?.resolve();
      close();
    }

    return (
      <div id="srf-modal-overlay" className="visible" onClick={handleDismiss}>
        <div id="srf-modal-box" onClick={(e) => e.stopPropagation()}>
          <div id="srf-modal-icon-wrap">
            <div id="srf-modal-icon" className={`theme-${isPrompt ? "input" : theme}`}>
              <ThemeIcon theme={theme} />
            </div>
          </div>

          <div id="srf-modal-body">
            <div id="srf-modal-title">{pending.opts.title}</div>
            <div id="srf-modal-msg">{pending.opts.msg}</div>
          </div>

          {isPrompt ? (
            <div id="srf-modal-input-wrap" style={{ display: "block" }}>
              <input
                id="srf-modal-input"
                autoFocus
                type="text"
                placeholder={(pending as Extract<PendingState, { kind: "prompt" }>).opts.inputPlaceholder || ""}
                value={(pending as Extract<PendingState, { kind: "prompt" }>).value}
                onChange={(e) =>
                  setPending((prev) =>
                    prev && prev.kind === "prompt" ? { ...prev, value: e.target.value } : prev
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleConfirm();
                }}
              />
            </div>
          ) : null}

          <div id="srf-modal-actions">
            {!isAlert ? (
              <button className="srf-modal-btn cancel" onClick={handleCancel}>
                {(pending.kind === "confirm" || pending.kind === "prompt") ? (pending.opts.cancelText || "Cancel") : "Cancel"}
              </button>
            ) : null}
            <button className={`srf-modal-btn ${isAlert ? "ok-only" : confirmBtnClass}`} onClick={handleConfirm}>
              {isAlert
                ? (pending.opts as AlertOptions).okText || "OK"
                : (pending.opts as ConfirmOptions | PromptOptions).confirmText || "Confirm"}
            </button>
          </div>
        </div>
      </div>
    );
  }, [pending]);

  return { confirm, prompt, alert, ConfirmHost };
}
