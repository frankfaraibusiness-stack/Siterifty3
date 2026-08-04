"use client";

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type { SettingsState } from "@/lib/useSettingsState";

interface SessionInfo {
  id?: string;
  device?: string;
  browser?: string;
  os?: string;
  isMobile?: boolean;
  createdAt?: any;
  lastSeen?: any;
}

const MobileIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a3e635" strokeWidth="1.8">
    <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
    <line x1="12" y1="18" x2="12.01" y2="18" strokeLinecap="round" />
  </svg>
);

const DesktopIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a3e635" strokeWidth="1.8">
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
    <polyline points="8 21 12 17 16 21" />
    <line x1="8" y1="21" x2="16" y2="21" />
  </svg>
);

function fmtDate(v: any) {
  if (!v) return "—";
  try {
    const d = typeof v?.toDate === "function" ? v.toDate() : typeof v?.toMillis === "function" ? new Date(v.toMillis()) : new Date(v);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "—";
  }
}

// Ports the userAgent-sniffing fallback used both when no session key
// exists in localStorage and when the session doc lookup finds nothing —
// same detection logic, same defaults, in both original code paths.
function sessionFromUserAgent(): SessionInfo {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const browser = ua.includes("Edg/")
    ? "Edge"
    : ua.includes("Chrome/")
    ? "Chrome"
    : ua.includes("Firefox/")
    ? "Firefox"
    : ua.includes("Safari/")
    ? "Safari"
    : "Browser";
  const os = /iPhone/.test(ua)
    ? "iOS"
    : /iPad/.test(ua)
    ? "iPadOS"
    : /Android/.test(ua)
    ? "Android"
    : /Windows/.test(ua)
    ? "Windows"
    : /Mac OS X/.test(ua)
    ? "macOS"
    : /Linux/.test(ua)
    ? "Linux"
    : "Unknown OS";
  const isMobile = /Mobi|Android|iPhone|iPad/i.test(ua);
  return {
    device: `${isMobile ? "Mobile" : "Desktop"} · ${browser} on ${os}`,
    browser,
    os,
    isMobile,
    createdAt: null,
    lastSeen: null,
  };
}

function SessionCard({ s }: { s: SessionInfo | null }) {
  if (!s) return <p style={{ color: "#666", fontSize: "0.85rem" }}>No session data available.</p>;
  return (
    <div className="info-card" style={{ gap: "0.6rem", flexDirection: "column", alignItems: "flex-start" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
        {s.isMobile ? <MobileIcon /> : <DesktopIcon />}
        <div>
          <span className="info-text" style={{ fontWeight: 600 }}>
            {s.device || "Unknown Device"}
          </span>
          <span style={{ color: "#a3e635", fontSize: "0.7rem", marginLeft: "0.4rem" }}>● This Device</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", paddingLeft: "0.1rem" }}>
        <span className="hint">Browser: {s.browser || "—"}</span>
        <span className="hint">OS: {s.os || "—"}</span>
        <span className="hint">First seen: {fmtDate(s.createdAt)}</span>
        <span className="hint">Last active: {fmtDate(s.lastSeen)}</span>
      </div>
    </div>
  );
}

export default function SessionsPanel({
  state,
  setState,
}: {
  state: SettingsState;
  setState: React.Dispatch<React.SetStateAction<SettingsState>>;
}) {
  const [session, setSession] = useState<SessionInfo | null>(state.currentSession as SessionInfo | null);
  const [loadFailed, setLoadFailed] = useState(false);

  // Fetches only this device's session doc — identified by the stable
  // localStorage key the original writes at login (window.__srSK /
  // localStorage['__srSK']). Nothing in this codebase ever writes that
  // key (grepped the full original source — only read, never set), so
  // in practice this almost always falls through to the userAgent-based
  // card, exactly as the original does whenever the key is missing. Not
  // a gap introduced by this port — preserved as-is per the "port
  // faithfully" rule rather than inventing a session-key writer that
  // doesn't exist in the source.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const user = auth.currentUser;
      if (!user) return;
      const sKey = typeof window !== "undefined" ? localStorage.getItem("__srSK") : null;

      if (!sKey) {
        const s = sessionFromUserAgent();
        if (!cancelled) {
          setSession(s);
          setState((prev) => ({ ...prev, currentSession: s }));
        }
        return;
      }

      try {
        const snap = await getDoc(doc(db, "users", user.uid, "sessions", sKey));
        if (cancelled) return;
        const s: SessionInfo = snap.exists() ? { id: snap.id, ...(snap.data() as any) } : sessionFromUserAgent();
        setSession(s);
        setState((prev) => ({ ...prev, currentSession: s }));
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className="detail-panel-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="3" ry="3" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="9" y1="21" x2="9" y2="9" />
        </svg>
        <h3>Active Session</h3>
      </div>
      <p className="detail-panel-desc">This is the device currently signed into your account.</p>
      <hr className="detail-divider" />

      {loadFailed ? (
        <p style={{ color: "#666", fontSize: "0.85rem" }}>Could not load session data.</p>
      ) : session ? (
        <SessionCard s={session} />
      ) : (
        <p style={{ color: "#666", fontSize: "0.85rem" }}>Loading session info…</p>
      )}
    </>
  );
}
