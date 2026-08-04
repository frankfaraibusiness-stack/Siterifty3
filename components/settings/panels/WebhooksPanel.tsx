"use client";

import { useEffect, useState } from "react";
import { auth } from "@/lib/firebase";
import type { SettingsState, Webhook } from "@/lib/useSettingsState";
import { useSrToast } from "@/components/system/SrToastProvider";

const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a3e635" strokeWidth="2">
    <path d="M9 12l2 2 4-4" />
    <path d="M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z" />
  </svg>
);

const AlertIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e74c3c" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

interface WebhookLog {
  event: string;
  url?: string;
  ok: boolean;
  statusCode?: number;
  errorMessage?: string;
  latencyMs?: number;
  createdAt?: { _seconds?: number } | string | number | null;
}

// Ports the shared _apiWebhooks() helper — every action needs a fresh
// idToken and follows the same { ok, data } / { ok:false, error }
// envelope as deal.js/listings.js. Route already ported server-side
// (Step 7); this is only the client-side caller.
async function apiWebhooks(action: string, params: Record<string, unknown> = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error("You must be signed in.");
  const idToken = await user.getIdToken();
  const resp = await fetch("/api/webhooks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, idToken, ...params }),
  });
  const json = await resp.json();
  if (!resp.ok || !json.ok) {
    throw new Error(json?.error?.message || "Something went wrong.");
  }
  return json.data;
}

function fmtLogDate(v: WebhookLog["createdAt"]) {
  if (!v) return "—";
  try {
    const ts = typeof v === "object" && v?._seconds ? v._seconds * 1000 : v;
    const d = new Date(ts as any);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString();
  } catch {
    return "—";
  }
}

export default function WebhooksPanel({
  state,
  setState,
}: {
  state: SettingsState;
  setState: React.Dispatch<React.SetStateAction<SettingsState>>;
}) {
  const { show: toast } = useSrToast();

  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookEvents, setWebhookEvents] = useState("");
  const [adding, setAdding] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [logs, setLogs] = useState<WebhookLog[]>(state.webhookLogs as WebhookLog[]);
  const [loadFailed, setLoadFailed] = useState(false);

  // Loads webhooks + logs the first time this panel opens, guarded by
  // webhooksLoaded so switching tabs back and forth doesn't refetch every
  // time — same guard the original uses. Only marks loaded on success so
  // a failed load can be retried by revisiting the panel, not permanently
  // cached as "No webhooks registered yet."
  useEffect(() => {
    if (state.webhooksLoaded) return;
    let cancelled = false;
    Promise.all([
      apiWebhooks("webhook.list").catch((e) => {
        toast(`Error loading webhooks: ${e.message}`, "error");
        return { webhooks: [] as Webhook[] };
      }),
      apiWebhooks("webhook.logs", { limit: 50 }).catch((e) => {
        console.error("[webhook.logs]", e.message);
        return { logs: [] as WebhookLog[] };
      }),
    ]).then(([listData, logsData]) => {
      if (cancelled) return;
      const listFailed = !listData.webhooks;
      setState((prev) => ({
        ...prev,
        webhooks: listData.webhooks || [],
        webhookLogs: logsData.logs || [],
        webhooksLoaded: !listFailed,
      }));
      setLogs(logsData.logs || []);
      setLoadFailed(listFailed);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.webhooksLoaded]);

  async function handleAdd() {
    const url = webhookUrl.trim();
    const events = webhookEvents.trim();
    if (!url) {
      toast("Please enter a webhook URL.", "error");
      return;
    }
    setAdding(true);
    try {
      const { webhook } = await apiWebhooks("webhook.add", { url, events });
      setState((prev) => ({ ...prev, webhooks: prev.webhooks.concat([webhook]) }));
      setWebhookUrl("");
      setWebhookEvents("");
      toast("Webhook added.", "success");
    } catch (err: any) {
      toast(`Error: ${err.message}`, "error");
    } finally {
      setAdding(false);
    }
  }

  async function handleTest(id: string) {
    setTestingId(id);
    try {
      const { delivery } = await apiWebhooks("webhook.test", { id });
      toast(
        delivery.ok
          ? `Test delivered · HTTP ${delivery.statusCode}`
          : `Test failed: ${delivery.errorMessage || "HTTP " + delivery.statusCode}`,
        delivery.ok ? "success" : "error"
      );
      const { logs: freshLogs } = await apiWebhooks("webhook.logs", { limit: 50 });
      setLogs(freshLogs || []);
      setState((prev) => ({ ...prev, webhookLogs: freshLogs || [] }));
    } catch (err: any) {
      toast(`Error: ${err.message}`, "error");
    } finally {
      setTestingId(null);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await apiWebhooks("webhook.delete", { id });
      setState((prev) => ({ ...prev, webhooks: prev.webhooks.filter((w) => w.id !== id) }));
      toast("Webhook removed.", "success");
    } catch (err: any) {
      toast(`Error: ${err.message}`, "error");
      setDeletingId(null);
    }
  }

  return (
    <>
      <div className="detail-panel-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
        <h3>Webhooks</h3>
      </div>
      <p className="detail-panel-desc">
        Register an endpoint on your own server — we&apos;ll POST an event payload there whenever something happens
        on your account (a deal is accepted, rejected, or cancelled). You&apos;re responsible for running the
        receiving server; we only send the request.
      </p>
      <hr className="detail-divider" />

      {!state.webhooksLoaded ? (
        <p style={{ color: "#666", fontSize: "0.85rem", marginBottom: "0.75rem" }}>
          {loadFailed ? "Couldn't load webhooks — revisit this panel to retry." : "Loading…"}
        </p>
      ) : state.webhooks.length === 0 ? (
        <p style={{ color: "#666", fontSize: "0.85rem", marginBottom: "0.75rem" }}>No webhooks registered yet.</p>
      ) : (
        state.webhooks.map((w) => (
          <div key={w.id} className="info-card" style={{ flexDirection: "column", alignItems: "stretch", marginBottom: "0.5rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
              <span className="info-text" style={{ fontFamily: "monospace", fontSize: "0.8rem", wordBreak: "break-all" }}>
                <strong>{String(w.url)}</strong>
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexShrink: 0 }}>
                <span style={{ color: w.active ? "#a3e635" : "#666", fontSize: "0.7rem", fontWeight: 700 }}>
                  {w.active ? "Active" : "Inactive"}
                </span>
                <button
                  className="save-btn"
                  style={{ padding: "0.25rem 0.6rem", fontSize: "0.7rem" }}
                  onClick={() => handleTest(w.id!)}
                  disabled={testingId === w.id}
                >
                  {testingId === w.id ? "Sending…" : "Test"}
                </button>
                <button
                  className="danger-btn"
                  style={{ padding: "0.25rem 0.6rem", fontSize: "0.7rem" }}
                  onClick={() => handleDelete(w.id!)}
                  disabled={deletingId === w.id}
                >
                  <TrashIcon />
                </button>
              </div>
            </div>
            {w.events && w.events !== "all" ? (
              <span className="hint">Events: {w.events}</span>
            ) : (
              <span className="hint">Subscribed to all events</span>
            )}
          </div>
        ))
      )}

      <div className="input-group">
        <label>Webhook Endpoint URL</label>
        <input
          className="input-field"
          type="url"
          value={webhookUrl}
          onChange={(e) => setWebhookUrl(e.target.value)}
          placeholder="https://your-server.com/webhook"
        />
        <span className="hint">Must be an HTTPS URL on your own server that accepts POST requests.</span>
      </div>
      <div className="input-group">
        <label>Events (comma-separated, or leave blank for all)</label>
        <input
          className="input-field"
          type="text"
          value={webhookEvents}
          onChange={(e) => setWebhookEvents(e.target.value)}
          placeholder="deal.accepted, deal.rejected, deal.cancelled"
        />
      </div>
      <button className="save-btn" onClick={handleAdd} disabled={adding}>
        <PlusIcon />
        {adding ? "Adding…" : "Add webhook"}
      </button>

      <hr className="detail-divider" style={{ marginTop: "1.25rem" }} />
      <div className="detail-panel-header" style={{ marginBottom: "0.4rem" }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 3v18h18" />
          <path d="M18 9l-5 5-3-3-4 4" />
        </svg>
        <h3 style={{ fontSize: "0.95rem" }}>Delivery Logs</h3>
      </div>
      <p className="detail-panel-desc" style={{ marginBottom: "0.6rem" }}>
        Recent attempts to deliver events to your endpoints, newest first.
      </p>
      {state.webhooksLoaded ? (
        logs.length === 0 ? (
          <p style={{ color: "#666", fontSize: "0.85rem" }}>No deliveries yet.</p>
        ) : (
          logs.map((l, i) => (
            <div key={i} className="info-card" style={{ alignItems: "flex-start", gap: "0.6rem", marginBottom: "0.4rem" }}>
              {l.ok ? <CheckIcon /> : <AlertIcon />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
                  <span className="info-text" style={{ fontSize: "0.8rem" }}>
                    <strong>{l.event}</strong>
                  </span>
                  <span style={{ fontSize: "0.7rem", color: "#666", flexShrink: 0 }}>{fmtLogDate(l.createdAt)}</span>
                </div>
                <div style={{ fontSize: "0.75rem", color: "#888", wordBreak: "break-all" }}>{l.url || ""}</div>
                <div style={{ fontSize: "0.75rem", color: l.ok ? "#a3e635" : "#e74c3c" }}>
                  {l.ok
                    ? `Delivered · HTTP ${l.statusCode}`
                    : `Failed${l.statusCode ? " · HTTP " + l.statusCode : ""}${l.errorMessage ? " · " + l.errorMessage : ""}`}
                  {typeof l.latencyMs === "number" ? ` · ${l.latencyMs}ms` : ""}
                </div>
              </div>
            </div>
          ))
        )
      ) : null}

    </>
  );
}
