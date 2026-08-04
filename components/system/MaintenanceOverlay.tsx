"use client";

import { useState } from "react";
import { notifyOnRestore } from "@/lib/accountAppeal";
import type { MaintenanceState } from "@/lib/accountStatus";
import { useScrollLock } from "@/lib/useScrollLock";

// Full-screen, no-dismiss, no-nav takeover — same markup/ids as the
// original's #maintenanceOverlay so the existing .mnt-* CSS in
// globals.css applies unchanged. The only interaction is the notify
// form; there is deliberately no close/back control.
export default function MaintenanceOverlay({ heading, body }: MaintenanceState) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "ok" | "error">("idle");
  const [message, setMessage] = useState("");
  useScrollLock(true);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setStatus("sending");
    setMessage("");
    try {
      await notifyOnRestore(trimmed);
      setStatus("ok");
      setMessage("You're on the list — we'll email you the moment we're back.");
      setEmail("");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Something went wrong — try again.");
    }
  }

  return (
    <div id="maintenanceOverlay" className="mnt-active">
      <div className="mnt-glow" />
      <div className="mnt-content">
        <div className="mnt-status-pill">
          <span className="mnt-status-dot" /> Under maintenance
        </div>
        <div className="mnt-mark">
          <div className="mnt-mark-glyph">
            <img
              src="/boot-mark-glyph.png"
              alt="Siterifty"
              width={40}
              height={40}
              style={{ display: "block" }}
            />
          </div>
          <div className="mnt-mark-text">
            Siterifty<span>.</span>
          </div>
        </div>
        <h1 className="mnt-heading">{heading || "We're offline for a bit"}</h1>
        <p className="mnt-body">
          {body ||
            "We're making some improvements behind the scenes. Your listings, wallet, and deals are safe — we'll be back shortly."}
        </p>

        {status === "ok" ? (
          <div className="mnt-notify-msg mnt-ok">{message}</div>
        ) : (
          <>
            <form className="mnt-notify-row" onSubmit={handleSubmit}>
              <input
                type="email"
                className="mnt-notify-input"
                placeholder="you@email.com"
                autoComplete="email"
                required
                disabled={status === "sending"}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <button type="submit" className="mnt-notify-btn" disabled={status === "sending"}>
                {status === "sending" ? "Sending…" : "Notify me"}
              </button>
            </form>
            {status === "error" && <div className="mnt-notify-msg mnt-err">{message}</div>}
          </>
        )}
      </div>
    </div>
  );
}
