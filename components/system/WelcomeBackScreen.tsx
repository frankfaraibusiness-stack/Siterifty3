"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { auth } from "@/lib/firebase";
import { useSrToast } from "@/components/system/SrToastProvider";
import { useCurrency } from "@/lib/CurrencyContext";

// Ports the "WELCOME BACK" full-screen daily-objectives takeover from
// Js/sellers-transfer.js (index.html lines 26401-26599) + the
// #welcomeBackScreen markup from index.html. Mounted once in
// app/layout.tsx, same tier as BootOverlay/SystemStatusProvider.
//
// Original trigger (firebase-init.js): on every onAuthStateChanged with a
// user, isReturning = user.metadata.creationTime is before today (UTC) —
// "new" only means "account created today". window.__welcomeBackPending
// is then read by __dismissBootOverlay, which opens this screen right
// after the boot splash fades (its own 1.5s hold +
// setTimeout(__dismissBootOverlay, 8000) safety net). This component
// mirrors that same timing off useAuth().loading directly rather than
// threading a signal through BootOverlay, since BootOverlay doesn't
// currently expose "I've fully faded" to siblings.
//
// Progress/rewards are never computed client-side — always fetched from
// /api/objectives (get-today/claim), same principle as the original.
// Wallet balance updates are picked up for free via AuthContext's
// Firestore onSnapshot listener on users/{uid} once the claim API writes
// walletBalance/withdrawableBalance — no manual "_walletSyncHeaderBalance"
// call needed like the original required.
const BOOT_HOLD_MS = 1500;

// How long the takeover stays suppressed after it's been shown once,
// before it's allowed to show again. Previously this screen re-opened on
// every single page load/refresh for a returning user (the only guard
// was an in-memory uidRef, which resets to null on every mount) — every
// hard refresh re-triggered it, which got old fast for anyone refreshing
// a few times in a row. Persisting a last-shown timestamp in localStorage
// (keyed per-uid, so switching accounts on the same device doesn't
// inherit someone else's cooldown) makes "already saw this recently"
// survive refreshes, tab closes, and reopens, same as the currency/theme
// preference pattern elsewhere in the app.
const REOPEN_COOLDOWN_MS = 30 * 60 * 1000;
const LAST_SHOWN_KEY_PREFIX = "srf_welcomeback_last_shown:";

function getLastShownAt(uid: string): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LAST_SHOWN_KEY_PREFIX + uid);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function setLastShownAt(uid: string, ms: number) {
  try {
    localStorage.setItem(LAST_SHOWN_KEY_PREFIX + uid, String(ms));
  } catch {
    // Silent — worst case it shows again next load, same as before this fix
  }
}

const OBJ_ICONS: Record<string, string> = {
  list_3: '<path d="M12 5v14M5 12h14" stroke-linecap="round"/>',
  list_1: '<path d="M12 5v14M5 12h14" stroke-linecap="round"/>',
  send_5_deals: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>',
  send_2_deals: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>',
  message_10_users:
    '<path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/>',
  message_3_users:
    '<path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/>',
  edit_profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a7 7 0 0114 0v1"/>',
};
const DEFAULT_ICON =
  '<circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 2" stroke-linecap="round" stroke-linejoin="round"/>';

interface Objective {
  id: string;
  label: string;
  desc: string;
  goal: number;
  progress: number;
  reward: number;
  completed: boolean;
  claimed: boolean;
  unavailable?: boolean;
}

// Takes an optional `fmt` (WelcomeBackScreen passes CurrencyContext's
// formatBalance) so reward amounts — real wallet credits — convert to
// the seller's selected display currency like every other balance figure
// in the app. Falls back to raw USD if no converter is passed.
function money(n: number, fmt?: (n: number) => string): string {
  if (fmt) return fmt(n);
  return "$" + n.toFixed(3).replace(/0+$/, "").replace(/\.$/, ".00");
}

export default function WelcomeBackScreen() {
  const { user, profile, loading } = useAuth();
  const { show: toast } = useSrToast();
  const { formatBalance } = useCurrency();

  const [active, setActive] = useState(false);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [totalEarnedToday, setTotalEarnedToday] = useState(0);
  const [objState, setObjState] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [claimingId, setClaimingId] = useState<string | null>(null);

  const uidRef = useRef<string | null>(null);

  // Decide whether to open, once per sign-in, after the same boot-splash
  // hold the original waited on __dismissBootOverlay before firing
  // __openWelcomeBack. Additionally gated by REOPEN_COOLDOWN_MS so a
  // refresh (or ten in a row) within the cooldown window doesn't
  // re-trigger it — only reopens once enough real time has passed since
  // it was last actually shown.
  useEffect(() => {
    if (loading) return;
    if (!user) {
      uidRef.current = null;
      return;
    }
    if (uidRef.current === user.uid) return; // already decided (or deciding) this sign-in

    uidRef.current = user.uid;
    const createdMs = user.metadata?.creationTime
      ? new Date(user.metadata.creationTime).getTime()
      : null;
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const isReturning = createdMs !== null && createdMs < todayStart.getTime();

    const lastShown = getLastShownAt(user.uid);
    const cooldownElapsed = lastShown === null || Date.now() - lastShown >= REOPEN_COOLDOWN_MS;

    const t = setTimeout(() => {
      if (isReturning && cooldownElapsed) {
        setActive(true);
        setLastShownAt(user.uid, Date.now());
      }
    }, BOOT_HOLD_MS);
    return () => clearTimeout(t);
  }, [user, loading]);

  // Lock scroll while open — same html.mnt-mode/body.mnt-mode rules the
  // maintenance/account-status overlays use for their own full-screen
  // takeovers (see globals.css).
  useEffect(() => {
    document.documentElement.classList.toggle("mnt-mode", active);
    document.body.classList.toggle("mnt-mode", active);
    return () => {
      document.documentElement.classList.remove("mnt-mode");
      document.body.classList.remove("mnt-mode");
    };
  }, [active]);

  async function loadObjectives() {
    if (!auth.currentUser) return;
    setObjState("loading");
    try {
      const idToken = await auth.currentUser.getIdToken();
      const res = await fetch("/api/objectives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get-today", idToken }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not load objectives");
      const objs: Objective[] = d.objectives || [];
      setObjectives(objs);
      setTotalEarnedToday(Number(d.totalEarnedToday || 0));
      setObjState(objs.length ? "ready" : "empty");
    } catch (err) {
      console.error("[WelcomeBackScreen] load objectives failed:", err);
      setObjState("error");
    }
  }

  useEffect(() => {
    if (active) loadObjectives();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  async function handleClaim(objectiveId: string) {
    if (!auth.currentUser || claimingId) return;
    setClaimingId(objectiveId);
    try {
      const idToken = await auth.currentUser.getIdToken();
      const res = await fetch("/api/objectives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "claim", idToken, objectiveId }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not claim reward");
      if (d.reward) toast(`+${money(d.reward, formatBalance)} added to your wallet!`, "success");
      // Wallet balance itself refreshes via AuthContext's Firestore
      // listener once the API writes walletBalance/withdrawableBalance —
      // just re-pull today's objectives to reflect the now-claimed state.
      await loadObjectives();
    } catch (err) {
      console.error("[WelcomeBackScreen] claim failed:", err);
    } finally {
      setClaimingId(null);
    }
  }

  if (!active) return null;

  const displayName = profile?.username || "there";
  const photo = profile?.profilePic || null;
  const dateText = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <>
      <div id="welcomeBackScreen" className="active">
        <div className="wb-orb" />
        <div className="wb-shell">
          <button
            type="button"
            className="wb-corner-close"
            aria-label="Continue to Siterifty"
            onClick={() => setActive(false)}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
          <div className="wb-sticky-top">
            <div className="wb-top">
              <div
                className="wb-avatar"
                id="wbAvatar"
                style={photo ? { backgroundImage: `url('${photo}')` } : undefined}
              >
                {!photo && (displayName[0] || "?").toUpperCase()}
              </div>
              <div className="wb-greeting">
                <div className="wb-hello">Welcome back,</div>
                <div className="wb-name" id="wbName">
                  {displayName}
                </div>
              </div>
            </div>

            <div className="wb-earn-card">
              <div className="wb-earn-label">Earned Today</div>
              <div className="wb-earn-amt" id="wbEarnedToday">
                {money(totalEarnedToday, formatBalance)}
              </div>
              <div className="wb-date" id="wbDate">
                {dateText}
              </div>
            </div>

            <div className="wb-obj-header">
              <div className="wb-obj-title">Today&apos;s Objectives</div>
              <div className="wb-obj-sub">Complete tasks to earn wallet rewards</div>
            </div>
          </div>

          <div className="wb-right-pane">
          {/* Duplicate of .wb-obj-header above, shown only at ≥1024px once
              the left pane is pinned and this becomes its own scrolling
              column with its own heading (see welcome-back.css). */}
          <div className="wb-right-header">
            <div className="wb-obj-title">Today&apos;s Objectives</div>
            <div className="wb-obj-sub">Complete tasks to earn wallet rewards</div>
          </div>

          <div className="wb-obj-scroll">
            <div className="wb-obj-list" id="wbObjList">
              {objState === "loading" && (
                <>
                  <div className="wb-skel-obj" />
                  <div className="wb-skel-obj" />
                  <div className="wb-skel-obj" />
                </>
              )}
              {objState === "empty" && (
                <div
                  className="wb-skel-obj"
                  style={{
                    animation: "none",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "rgba(255,255,255,.35)",
                    fontSize: 12.5,
                  }}
                >
                  No objectives available right now — check back soon.
                </div>
              )}
              {objState === "error" && (
                <div
                  className="wb-skel-obj"
                  style={{
                    animation: "none",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "rgba(255,255,255,.35)",
                    fontSize: 12.5,
                    textAlign: "center",
                    padding: "0 16px",
                  }}
                >
                  Couldn&apos;t load today&apos;s objectives. Pull down to refresh once you&apos;re in.
                </div>
              )}
              {objState === "ready" &&
                objectives.map((o, i) => {
                  const pct = Math.min(100, Math.round((o.progress / o.goal) * 100));
                  const icon = OBJ_ICONS[o.id] || DEFAULT_ICON;
                  const stateClass = o.claimed
                    ? "is-claimed is-complete"
                    : o.completed
                      ? "is-complete"
                      : "";
                  const rewardStr = "+" + money(o.reward, formatBalance);

                  return (
                    <div
                      key={o.id}
                      className={`wb-obj-card ${stateClass}`}
                      style={{ animationDelay: `${i * 0.06}s` }}
                    >
                      <div className="wb-obj-row1">
                        <div className="wb-obj-icon">
                          <svg
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.1"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            dangerouslySetInnerHTML={{ __html: icon }}
                          />
                        </div>
                        <div className="wb-obj-mid">
                          <div className="wb-obj-label">{o.label}</div>
                          <div className="wb-obj-desc">{o.desc}</div>
                        </div>
                        <div className="wb-obj-reward">{rewardStr}</div>
                      </div>

                      {o.unavailable ? (
                        <div
                          className="wb-obj-progress-text"
                          style={{ marginTop: 12, textAlign: "left", opacity: 0.6 }}
                        >
                          Progress will update shortly — check back in a bit.
                        </div>
                      ) : (
                        <div className="wb-obj-progress-wrap">
                          <div className="wb-obj-progress-track">
                            <div className="wb-obj-progress-fill" style={{ width: `${pct}%` }} />
                          </div>
                          <div className="wb-obj-progress-text">
                            {o.progress}/{o.goal}
                          </div>
                        </div>
                      )}

                      {o.claimed ? (
                        <div className="wb-obj-claimed-tag">
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.6"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                          Reward claimed
                        </div>
                      ) : o.completed ? (
                        <button
                          className="wb-obj-claim-btn"
                          disabled={claimingId === o.id}
                          onClick={() => handleClaim(o.id)}
                        >
                          {claimingId === o.id ? "Claiming…" : `Claim ${rewardStr}`}
                        </button>
                      ) : null}
                    </div>
                  );
                })}
            </div>
          </div>

          <div className="wb-sticky-bottom">
            <button className="wb-continue-btn" onClick={() => setActive(false)}>
              <span>Continue to Siterifty</span>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12h14M13 5l7 7-7 7" />
              </svg>
            </button>
          </div>
          </div>
        </div>
      </div>
    </>
  );
}
