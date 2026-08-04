"use client";

import { useCallback, useState } from "react";

// Ports window.__pickAiDescriptionLength from Js/misc-modals.js
// (lines 98-151) + the #srfAiLenOverlay markup (index.html lines
// 5347-5375). CSS (.srfAiLen*, .srf-modal-btn) already exists in
// app/globals.css from Step 1, unchanged here.
//
// Same hook + <XHost/> shape as lib/useConfirm.tsx (this app's own
// replacement for window.srfModal) — a promise-returning function plus a
// small render-prop component the caller mounts locally, rather than a
// new global provider. pick(cap, plan) resolves with the chosen target
// character count, or null if the user cancels — same contract as the
// original.
export function useAiLengthPicker() {
  const [pending, setPending] = useState<{
    cap: number;
    plan: string;
    value: number;
    resolve: (v: number | null) => void;
  } | null>(null);

  const pick = useCallback((cap: number, plan: string) => {
    return new Promise<number | null>((resolve) => {
      const min = Math.min(20, cap);
      // Default opening position: ~10% of the plan's cap (never below
      // the slider's own minimum), so the picker doesn't default to
      // maxing out the plan — same as the original.
      const defaultVal = Math.max(min, Math.round(cap * 0.1));
      setPending({ cap, plan, value: defaultVal, resolve });
    });
  }, []);

  function close(value: number | null) {
    if (pending) pending.resolve(value);
    setPending(null);
  }

  const AiLengthPickerHost = useCallback(() => {
    if (!pending) return null;
    const min = Math.min(20, pending.cap);

    return (
      <div
        id="srfAiLenOverlay"
        className="visible"
        style={{ display: "flex" }}
        onClick={(e) => {
          if (e.target === e.currentTarget) close(null);
        }}
      >
        <div id="srfAiLenBox">
          <div id="srfAiLenIconWrap">
            <div id="srfAiLenIcon">
              <svg viewBox="0 0 24 24">
                <path d="M12 3l1.9 4.3L18 9l-4.1 1.7L12 15l-1.9-4.3L6 9l4.1-1.7L12 3z" />
                <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z" />
              </svg>
            </div>
          </div>
          <div id="srfAiLenBody">
            <div id="srfAiLenTitle">Description length</div>
            <div id="srfAiLenSub">Choose roughly how long you&apos;d like the AI-generated description to be.</div>
          </div>
          <div id="srfAiLenSliderWrap">
            <div id="srfAiLenCountRow">
              <span id="srfAiLenCount">{pending.value}</span>
              <span id="srfAiLenCountUnit">characters</span>
            </div>
            <input
              type="range"
              id="srfAiLenSlider"
              min={min}
              max={pending.cap}
              step={1}
              value={pending.value}
              onChange={(e) => setPending({ ...pending, value: parseInt(e.target.value, 10) })}
            />
            <div id="srfAiLenScaleRow">
              <span>Short</span>
              <span id="srfAiLenCapLabel">Plan max ({pending.cap})</span>
            </div>
          </div>
          <div id="srfAiLenPlanNote">
            Your {pending.plan} plan allows up to {pending.cap} characters.
          </div>
          <div id="srfAiLenActions">
            <button className="srf-modal-btn cancel" id="srfAiLenCancel" onClick={() => close(null)}>
              Cancel
            </button>
            <button className="srf-modal-btn confirm-input" id="srfAiLenConfirm" onClick={() => close(pending.value)}>
              Generate
            </button>
          </div>
        </div>
      </div>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  return { pick, AiLengthPickerHost };
}
