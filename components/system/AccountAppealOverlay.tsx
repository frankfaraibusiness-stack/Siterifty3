"use client";

import { useRef, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { uploadAppealScreenshot, submitAppeal, type AppealAttachment } from "@/lib/accountAppeal";
import { useScrollLock } from "@/lib/useScrollLock";

// Ports #acctAppealOverlay — text description + up to 3 image
// attachments, uploaded to Imgur (not /api/storage, matching how
// screenshots are handled elsewhere in the old app). Submits via
// lib/accountAppeal's submitAppeal, which calls the real
// /api/account?action=submitAppeal endpoint (the old code's own inline
// comment pointed at /api/admin, which was stale — that action lives in
// account/_handler.js, not admin.js; verified directly against the
// server source before porting).
export default function AccountAppealOverlay({ onCancel }: { onCancel: () => void }) {
  const { user } = useAuth();
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<"idle" | "uploading" | "submitting" | "ok" | "error">("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  useScrollLock(true);

  function addFiles(picked: FileList | null) {
    if (!picked) return;
    const images = Array.from(picked).filter((f) => f.type.startsWith("image/"));
    const room = 3 - files.length;
    if (room <= 0) return;
    setFiles((prev) => [...prev, ...images.slice(0, room)]);
  }

  function removeFile(i: number) {
    setFiles((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = message.trim();
    setStatusMsg("");
    if (!trimmed) {
      setStatus("error");
      setStatusMsg("Please describe what happened.");
      return;
    }
    if (!user) {
      setStatus("error");
      setStatusMsg("Could not verify your session — please refresh and try again.");
      return;
    }

    try {
      setStatus("uploading");
      const attachments: AppealAttachment[] = [];
      for (const file of files) {
        setStatusMsg(`Uploading ${attachments.length + 1}/${files.length}…`);
        const url = await uploadAppealScreenshot(file);
        attachments.push({ url, fileName: file.name });
      }

      setStatus("submitting");
      setStatusMsg("");
      const idToken = await user.getIdToken();
      await submitAppeal({ idToken, message: trimmed, attachments });

      setStatus("ok");
      setStatusMsg("Your appeal was submitted — we'll review it and reach out if needed.");
    } catch (err) {
      setStatus("error");
      setStatusMsg(err instanceof Error ? err.message : "Something went wrong — try again.");
    }
  }

  const submitted = status === "ok";
  const busy = status === "uploading" || status === "submitting";

  return (
    <div id="acctAppealOverlay" className="mnt-active">
      <div className="mnt-glow" />
      <div className="mnt-content" style={{ maxWidth: 480 }}>
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
        <h1 className="mnt-heading" style={{ fontSize: "1.35rem" }}>
          Submit an appeal
        </h1>
        <p className="mnt-body">
          Explain what happened. An admin will review this and reach out if needed. You can attach up to 3
          screenshots.
        </p>

        <form
          style={{ width: "100%", display: "flex", flexDirection: "column", gap: 12 }}
          onSubmit={handleSubmit}
        >
          <textarea
            required
            placeholder="Explain what might have gone wrong…"
            disabled={submitted}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            style={{
              width: "100%",
              minHeight: 140,
              resize: "vertical",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 12,
              color: "#f1f1f3",
              fontFamily: "inherit",
              fontSize: 14,
              padding: "12px 14px",
              lineHeight: 1.5,
            }}
          />

          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: "none" }}
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className="mnt-notify-btn"
              style={{ width: "100%", background: "rgba(255,255,255,0.08)" }}
              disabled={files.length >= 3 || submitted}
              onClick={() => fileInputRef.current?.click()}
            >
              Attach screenshots (up to 3)
            </button>
            {files.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                {files.map((file, i) => (
                  <div key={i} className="acct-appeal-file-chip">
                    <img src={URL.createObjectURL(file)} alt="" />
                    <span>{file.name.length > 18 ? file.name.slice(0, 15) + "…" : file.name}</span>
                    <button type="button" onClick={() => removeFile(i)}>
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {statusMsg && (
            <div className={`mnt-notify-msg ${status === "error" ? "mnt-err" : status === "ok" ? "mnt-ok" : ""}`}>
              {statusMsg}
            </div>
          )}

          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              className="mnt-notify-btn"
              style={{ flex: 1, background: "rgba(255,255,255,0.06)" }}
              onClick={onCancel}
            >
              Back
            </button>
            <button type="submit" className="mnt-notify-btn" style={{ flex: 1 }} disabled={busy || submitted}>
              {submitted ? "Submitted ✓" : busy ? statusMsg || "Submitting…" : "Submit appeal"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
