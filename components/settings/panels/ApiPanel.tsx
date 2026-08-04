"use client";

import { useEffect, useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type { ApiKey, SettingsState } from "@/lib/useSettingsState";
import { useSrToast } from "@/components/system/SrToastProvider";
import { useConfirm } from "@/lib/useConfirm";

const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const RevokeIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

interface ExternalApiKey {
  key: string;
  addedAt: number;
  status: "active" | "pending";
  keyData: string;
}

export default function ApiPanel({
  state,
  setState,
}: {
  state: SettingsState;
  setState: React.Dispatch<React.SetStateAction<SettingsState>>;
}) {
  const { show: toast } = useSrToast();
  const { confirm, alert, ConfirmHost } = useConfirm();

  const [keyLabel, setKeyLabel] = useState("");
  const [externalKeyInput, setExternalKeyInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [validating, setValidating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [keyCountBadge, setKeyCountBadge] = useState("");

  const activeKeys = state.apiKeys.filter((k) => k.active !== false);
  const externalKeys = (state.externalApiKeys || []) as ExternalApiKey[];

  // Ports the key-count badge fetch — GET /api/deal?action=agent-limits&uid=...,
  // a public read-only lookup (route already ported server-side, Step 7).
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;
    fetch(`/api/deal?action=agent-limits&uid=${user.uid}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((ld) => {
        if (ld) setKeyCountBadge(`(${ld.keyCount} / ${ld.maxKeys} on ${ld.plan} plan)`);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ports addExternalApiBtn's handler — format check, then look the key
  // up in the apiKeys collection directly from the client (matches the
  // original, which does this as a raw Firestore query rather than a
  // server route).
  async function handleAddExternal() {
    const key = externalKeyInput.trim();
    if (!key) {
      toast("Please enter an API key to add.", "error");
      return;
    }
    setValidating(true);
    try {
      if (key.length < 20) {
        toast("That does not look like a valid API key.", "error");
        return;
      }
      const user = auth.currentUser;
      if (!user) {
        toast("Not signed in.", "error");
        return;
      }
      const { collection, query, where, getDocs } = await import("firebase/firestore");
      const q = query(collection(db, "apiKeys"), where("key", "==", key), where("active", "==", true));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const keyData = snap.docs[0].data() as any;
        const entry: ExternalApiKey = {
          key: key.slice(0, 8) + "…",
          addedAt: Date.now(),
          status: "active",
          keyData: keyData.label || "External Key",
        };
        const next = externalKeys.concat([entry]);
        await updateDoc(doc(db, "users", user.uid), { externalApiKeys: next });
        setState((prev) => ({ ...prev, externalApiKeys: next }));
        toast("API key validated and connected! Admin commands unlocked.", "success");
        setExternalKeyInput("");
      } else {
        toast("Key saved but could not auto-validate. Status set to pending.", "info");
      }
    } catch (err: any) {
      toast(`Validation error: ${err.message}`, "error");
    } finally {
      setValidating(false);
    }
  }

  // Ports generateApiKeyBtn's handler — server-side limit check via
  // /api/deal's agent-check-key-limit, then agent-create-key. No key
  // limits are hardcoded client-side, same as the original.
  async function handleGenerate() {
    const user = auth.currentUser;
    if (!user) {
      toast("Not signed in.", "error");
      return;
    }
    setGenerating(true);
    try {
      const idToken = await user.getIdToken();
      const chk = await fetch("/api/deal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "agent-check-key-limit", idToken }),
      });
      const chkData = await chk.json();
      if (!chkData.allowed) {
        setGenerating(false);
        await alert({
          theme: "warning",
          title: "Key Limit Reached",
          msg: `Your ${chkData.plan} plan allows up to ${chkData.maxKeys} active API key${
            chkData.maxKeys !== 1 ? "s" : ""
          }. You currently have ${chkData.activeCount}. Upgrade your plan or revoke an existing key to create a new one.`,
          okText: "Got it",
        });
        return;
      }

      const cr = await fetch("/api/deal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "agent-create-key", idToken, label: keyLabel.trim() || "My Key" }),
      });
      const created = await cr.json();
      if (!cr.ok) throw new Error(created.error || "Failed to create key");
      const newKey: ApiKey = {
        id: created.id,
        name: created.label,
        prefix: created.prefix,
        created: created.created,
        active: true,
      };
      setState((prev) => ({ ...prev, apiKeys: prev.apiKeys.concat([newKey]) }));
      setKeyLabel("");
      toast("API key saved — access it anytime via the Agent Model in your Profile section.", "success");
    } catch (err: any) {
      toast(`Error: ${err.message}`, "error");
    } finally {
      setGenerating(false);
    }
  }

  // Ports the revoke handler — ownership of keyId is verified
  // server-side in /api/account's revokeApiKey action, not trusted from
  // the client.
  async function handleRevoke(keyId: string) {
    const user = auth.currentUser;
    if (!user) return;
    const ok = await confirm({
      theme: "danger",
      title: "Revoke Key",
      msg: "This will permanently deactivate this API key. Automations using it will stop working immediately.",
      confirmText: "Revoke",
    });
    if (!ok) return;
    setRevokingId(keyId);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/account?action=revokeApiKey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken, keyId }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || "Revoke failed");
      setState((prev) => ({
        ...prev,
        apiKeys: prev.apiKeys.map((k) => (k.id === keyId ? { ...k, active: false } : k)),
      }));
      toast("API key revoked.", "success");
    } catch (err: any) {
      toast(`Error: ${err.message}`, "error");
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <>
      <div className="detail-panel-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </svg>
        <h3>API & Integrations</h3>
      </div>
      <p className="detail-panel-desc">
        Generate Siterifty API keys for automation. Keys use your UID + username + timestamp so they&apos;re unique
        and traceable.
      </p>
      <hr className="detail-divider" />

      <div style={{ fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#666", marginBottom: "0.5rem" }}>
        Your API Keys{" "}
        <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "#555", textTransform: "none", letterSpacing: 0, marginLeft: 4 }}>
          {keyCountBadge}
        </span>
      </div>

      {activeKeys.length === 0 ? (
        <p style={{ color: "#666", fontSize: "0.85rem", marginBottom: "0.75rem" }}>No API keys yet — generate one below.</p>
      ) : (
        activeKeys.map((k) => (
          <div
            key={k.id}
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "0.9rem",
              padding: "0.9rem 1rem",
              marginBottom: "0.6rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.6rem",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.5rem" }}>
              <div>
                <div style={{ fontWeight: 700, color: "#ddd", fontSize: "0.85rem" }}>{String(k.label || k.name || "")}</div>
                <div style={{ fontFamily: "monospace", color: "#555", fontSize: "0.7rem", marginTop: "0.15rem" }}>
                  {String(k.prefix || "—")}
                </div>
              </div>
              <span
                style={{
                  color: "#a3e635",
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  padding: "0.2rem 0.55rem",
                  background: "rgba(163,230,53,0.08)",
                  borderRadius: "2rem",
                }}
              >
                ● Active
              </span>
            </div>
            <div style={{ padding: "0.5rem 0.75rem", background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: "0.55rem" }}>
              <div style={{ fontSize: "0.66rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#a3e635", marginBottom: "0.25rem" }}>
                Capabilities
              </div>
              <div style={{ fontSize: "0.7rem", color: "#777", lineHeight: 1.6 }}>
                Auto-reply to buyers · Auto-accept/reject deals · Smart negotiation · Auto-relist &amp; price drops
              </div>
            </div>
            <button
              className="danger-btn"
              style={{ padding: "0.45rem 0.85rem", fontSize: "0.74rem", alignSelf: "flex-start" }}
              onClick={() => handleRevoke(k.id)}
              disabled={revokingId === k.id}
            >
              <RevokeIcon />
              {revokingId === k.id ? "Revoking…" : "Revoke API Key"}
            </button>
          </div>
        ))
      )}

      <div className="input-group" style={{ marginTop: "0.75rem" }}>
        <label>Key Label</label>
        <input
          className="input-field"
          type="text"
          value={keyLabel}
          onChange={(e) => setKeyLabel(e.target.value)}
          placeholder="e.g. Production Automation"
        />
        <span className="hint">Keys power your Agent — letting it auto-reply, auto-accept/reject offers, negotiate, and manage listings on your behalf.</span>
      </div>
      <button className="save-btn" onClick={handleGenerate} disabled={generating}>
        <PlusIcon />
        {generating ? "Generating…" : "Generate API Key"}
      </button>

      <hr className="detail-divider" />

      <div style={{ fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#60a5fa", marginBottom: "0.5rem" }}>
        Add External API Key
      </div>
      <p style={{ fontSize: "0.82rem", color: "#777", marginBottom: "0.75rem" }}>
        Have a key from another service? Add it here and we&apos;ll validate it. Active keys unlock Agent automation
        commands like auto-accepting deals and negotiating on your behalf.
      </p>
      {externalKeys.map((k, i) => (
        <div key={i} className="kv-row" style={{ background: "rgba(96,165,250,0.04)", border: "1px solid rgba(96,165,250,0.15)", borderRadius: "0.8rem", padding: "0.8rem 1rem", marginBottom: "0.5rem" }}>
          <span className="kv-key">
            {k.keyData || "External Key"}
            <br />
            <small style={{ color: "#555", fontFamily: "monospace" }}>{k.key}</small>
          </span>
          <span style={{ color: k.status === "active" ? "#a3e635" : "#f59e0b", fontSize: "0.72rem", fontWeight: 700 }}>
            {k.status === "active" ? "Validated ✓" : "Pending"}
          </span>
        </div>
      ))}
      <div className="input-group">
        <label>External API Key</label>
        <input
          className="input-field"
          type="text"
          value={externalKeyInput}
          onChange={(e) => setExternalKeyInput(e.target.value)}
          placeholder="Paste your API key…"
        />
      </div>
      <button
        className="save-btn"
        style={{ background: "rgba(96,165,250,0.12)", border: "1px solid rgba(96,165,250,0.3)", color: "#93c5fd" }}
        onClick={handleAddExternal}
        disabled={validating}
      >
        <PlusIcon />
        {validating ? "Checking…" : "Add & Validate"}
      </button>
      <span className="hint">If the key is active, you&apos;ll get Agent automation commands: auto-reply, auto-accept/reject offers, negotiation, and listing management.</span>

      <ConfirmHost />
    </>
  );
}
