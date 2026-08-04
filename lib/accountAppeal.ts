// Client wrappers for the notifyOnRestore and submitAppeal actions in
// app/api/account/_handler.js — both already exist and work
// server-side; this file is the missing client-side piece, matching
// lib/reports.ts's pattern for listing.report.

const IMGUR_CLIENT_ID_APPEAL = "891e5bb4aa94282"; // same public client id used elsewhere in the old app for screenshot uploads

export interface AppealAttachment {
  url: string;
  fileName: string;
}

// Uploads one image to Imgur (not /api/storage — appeal screenshots use
// the same public Imgur flow the old app used for other in-app
// screenshot attachments, not Siterifty's own Firebase Storage).
export async function uploadAppealScreenshot(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("image", file);
  const res = await fetch("https://api.imgur.com/3/image", {
    method: "POST",
    headers: { Authorization: "Client-ID " + IMGUR_CLIENT_ID_APPEAL },
    body: fd,
  });
  const json = await res.json();
  if (!json.success) throw new Error("Image upload failed: " + (json.data && json.data.error));
  return json.data.link;
}

// PUBLIC — no auth required. Stores an email in maintenanceNotifyList
// so the person gets emailed once maintenance mode is lifted.
export async function notifyOnRestore(email: string): Promise<void> {
  const res = await fetch("/api/account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "notifyOnRestore", email }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || "Could not save your email — try again.");
}

// Requires the caller's own Firebase ID token — verified server-side,
// only ever creates an appeal doc tied to that caller's own uid. Never
// changes banned/suspended state itself, purely a message into a
// review queue an admin reads later.
export async function submitAppeal(params: {
  idToken: string;
  message: string;
  attachments: AppealAttachment[];
}): Promise<{ appealId: string }> {
  const res = await fetch("/api/account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "submitAppeal", ...params }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || "Could not submit your appeal — try again.");
  return out;
}
