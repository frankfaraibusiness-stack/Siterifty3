"use client";

import { useEffect, useState } from "react";
import { auth } from "@/lib/firebase";
import { useScrollLock } from "@/lib/useScrollLock";

// Ports the "── Webhooks panel ──" section of Js/dashboard.js — a
// lighter-weight list/add/delete/test UI than settings' WebhooksPanel
// (no delivery-log history, no SettingsState dependency), styled with
// the dashboard's own sd-webhook-* / sd-modal-* classes rather than
// settings' .info-card/.save-btn, matching what the original actually
// scoped this sub-modal to.
interface DashboardWebhook {
  id: string;
  url: string;
  events: string | string[];
}

const EVENT_OPTIONS = [
  "deal.accepted",
  "deal.rejected",
  "deal.cancelled",
  "deal.completed",
  "deal.disputed",
];

async function apiWebhooks<T = any>(action: string, extra?: Record<string, unknown>): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  const idToken = await user.getIdToken();
  const res = await fetch("/api/webhooks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, idToken, ...extra }),
  });
  const out = await res.json();
  if (!res.ok || !out.ok) throw new Error(out?.error?.message || "Request failed");
  return out.data;
}

export default function DashboardWebhooksModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  useScrollLock(open);
  const [webhooks, setWebhooks] = useState<DashboardWebhook[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [status, setStatus] = useState<{ kind: "" | "ok" | "err"; msg: string }>({ kind: "", msg: "" });
  const [testingId, setTestingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function loadWebhooks() {
    setWebhooks(null);
    setLoadError(false);
    try {
      const data = await apiWebhooks<{ webhooks: DashboardWebhook[] }>("webhook.list", {});
      setWebhooks(data.webhooks || []);
    } catch {
      setWebhooks([]);
      setLoadError(true);
    }
  }

  useEffect(() => {
    if (open) loadWebhooks();
  }, [open]);

  if (!open) return null;

  async function handleAdd() {
    const trimmed = url.trim();
    if (!trimmed) {
      setStatus({ kind: "err", msg: "Please enter a valid URL." });
      return;
    }
    setAdding(true);
    setStatus({ kind: "", msg: "Adding…" });
    try {
      await apiWebhooks("webhook.add", { url: trimmed, events: events.length ? events : undefined });
      setUrl("");
      setEvents([]);
      setStatus({ kind: "ok", msg: "Webhook added." });
      loadWebhooks();
    } catch (err: any) {
      setStatus({ kind: "err", msg: err.message || "Something went wrong." });
    } finally {
      setAdding(false);
    }
  }

  async function handleTest(id: string) {
    setTestingId(id);
    setStatus({ kind: "", msg: "Testing…" });
    try {
      const data = await apiWebhooks<{ delivery: { ok: boolean; statusCode?: number; latencyMs?: number; errorMessage?: string } }>(
        "webhook.test",
        { id }
      );
      const d = data.delivery || ({} as any);
      setStatus(
        d.ok
          ? { kind: "ok", msg: `✓ Delivered (HTTP ${d.statusCode}, ${d.latencyMs}ms)` }
          : { kind: "err", msg: `✗ ${d.errorMessage || "Delivery failed"}` }
      );
    } catch (err: any) {
      setStatus({ kind: "err", msg: `✗ ${err.message}` });
    } finally {
      setTestingId(null);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await apiWebhooks("webhook.delete", { id });
      loadWebhooks();
    } catch (err: any) {
      setStatus({ kind: "err", msg: `✗ ${err.message}` });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div
      className="sd-modal-overlay active"
      id="sdSettingsModal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sd-modal-card">
        <div className="sd-modal-header">
          <h2>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
            </svg>
            Webhooks
          </h2>
          <button className="sd-modal-close" id="sdSettingsClose" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <line x1={18} y1={6} x2={6} y2={18} />
              <line x1={6} y1={6} x2={18} y2={18} />
            </svg>
          </button>
        </div>

        <div className="sd-form-group">
          <label>Endpoint URL</label>
          <input id="whUrl" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-server.com/webhook" />
        </div>
        <div className="sd-form-group">
          <label>Events (leave unchecked for all)</label>
          <div className="sd-checkbox-grid" id="whEventsGrid">
            {EVENT_OPTIONS.map((ev) => (
              <label key={ev}>
                <input
                  type="checkbox"
                  value={ev}
                  checked={events.includes(ev)}
                  onChange={(e) =>
                    setEvents((prev) => (e.target.checked ? [...prev, ev] : prev.filter((x) => x !== ev)))
                  }
                />
                {ev}
              </label>
            ))}
          </div>
        </div>
        <button className="sd-btn sd-btn-primary" id="whAddBtn" disabled={adding} onClick={handleAdd}>
          {adding ? "Adding…" : "Add webhook"}
        </button>
        <div className={`sd-test-status${status.kind ? ` ${status.kind}` : ""}`} id="whAddStatus">
          {status.msg}
        </div>

        <div className="sd-webhook-list" id="whList">
          {webhooks === null ? (
            <div className="sd-webhook-empty">Loading…</div>
          ) : loadError ? (
            <div className="sd-webhook-empty">Couldn&apos;t load webhooks — try again in a moment.</div>
          ) : webhooks.length === 0 ? (
            <div className="sd-webhook-empty">No webhooks configured yet.</div>
          ) : (
            webhooks.map((w) => (
              <div className="sd-webhook-item" key={w.id}>
                <div className="wh-info">
                  <span className="wh-url">{w.url}</span>
                  <span className="wh-events">{w.events === "all" ? "all events" : String(w.events)}</span>
                </div>
                <div className="wh-actions">
                  <button
                    className="sd-btn sd-btn-secondary sd-btn-sm"
                    disabled={testingId === w.id}
                    onClick={() => handleTest(w.id)}
                  >
                    {testingId === w.id ? "Testing…" : "Test"}
                  </button>
                  <button
                    className="sd-btn sd-btn-danger sd-btn-sm"
                    disabled={deletingId === w.id}
                    onClick={() => handleDelete(w.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
