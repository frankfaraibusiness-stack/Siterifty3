"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import { useAuth } from "@/lib/AuthContext";
import { useScrollLock } from "@/lib/useScrollLock";

// Ports the Autopilot Agent modal from Js/plans-boost.js (openAgentModal /
// window.__openAgentModal, lines 336-776) + the #agentModal markup in
// index.html. CSS classes (#agentModal, .agent-plan-card, .agent-toggle-card,
// #agentSaveBtn, etc.) already exist in app/globals.css from Step 1 —
// unchanged here, only the DOM is now React-driven instead of
// getElementById.
//
// Data flow mirrors the original exactly:
//  - GET /api/deal?action=agent-limits&uid=... (public, no auth) for the
//    plan comparison cards + daily usage bar
//  - users/{uid}.apiKeyIds -> apiKeys/{id} docs for the key selector
//  - users/{uid}.agentConfig for saved toggle state (read on open, written
//    on Save/Deactivate)
//  - users/{uid}/agentLog (onSnapshot, ordered desc, limit 8) for the
//    activity feed

const ALL_TOGGLES = [
  "autoReply",
  "autoAccept",
  "autoReject",
  "dealScore",
  "negotiate",
  "autoRelist",
  "priceDrop",
] as const;
type ToggleId = (typeof ALL_TOGGLES)[number];
const EXTRAS: ToggleId[] = ["autoReply", "autoAccept", "autoReject", "negotiate", "autoRelist", "priceDrop"];

interface ApiKeyOption {
  id: string;
  label?: string;
  name?: string;
  prefix?: string;
  active?: boolean;
}

interface AgentLimitsData {
  plan: string;
  rpd: number;
  maxKeys: number;
  usedToday: number;
  keyCount: number;
  linkedKeyId?: string | null;
  allPlans: Record<string, { rpd: number; maxKeys: number }>;
}

interface AgentConfig {
  active?: boolean;
  keyId?: string;
  autoReply?: { enabled?: boolean; tone?: string };
  autoAccept?: { enabled?: boolean; minPercent?: number };
  autoReject?: { enabled?: boolean; floor?: number; sendCounter?: boolean };
  dealScore?: { enabled?: boolean };
  negotiate?: { enabled?: boolean; maxDiscount?: number };
  autoRelist?: { enabled?: boolean; maxCount?: number };
  priceDrop?: { enabled?: boolean; pct?: number; days?: number };
}

interface ActivityRow {
  id: string;
  type: string;
  msg: string;
  ts: Date;
}

const DOT_COLOR: Record<string, string> = {
  config_saved: "green",
  deactivated: "red",
  auto_reply: "violet",
  auto_accept: "green",
  auto_reject: "red",
  hold: "amber",
  skipped: "amber",
  quota_hit: "amber",
  error: "red",
  negotiate: "amber",
  price_drop: "amber",
  relist: "violet",
};

const PLAN_META: Record<string, { name: string; color: string; rgb: string; price: string }> = {
  free: { name: "Free", color: "#71717a", rgb: "113,113,122", price: "Free" },
  starter: { name: "Starter", color: "#60a5fa", rgb: "96,165,250", price: "$10/mo" },
  growth: { name: "Growth", color: "#a3e635", rgb: "163,230,53", price: "$20/mo" },
  pro: { name: "Pro", color: "#d8b4fe", rgb: "216,180,254", price: "$30/mo" },
};

function tsAgo(date: Date): string {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return "Just now";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
  return Math.floor(diff / 86400) + "d ago";
}

export default function AgentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const router = useRouter();

  // AgentModal never had a scroll lock of its own — see
  // lib/useScrollLock.ts's top comment; this was one of the
  // modals/overlays that let the page underneath keep scrolling while
  // it was open. Reference-counted, so it stacks safely with whatever
  // opened this (e.g. MyProfileHub) already having its own lock active.
  useScrollLock(open);

  const [loading, setLoading] = useState(false);
  const [limits, setLimits] = useState<AgentLimitsData | null>(null);
  const [keys, setKeys] = useState<ApiKeyOption[]>([]);
  const [selectedKeyId, setSelectedKeyId] = useState("");
  const [toggles, setToggles] = useState<Record<ToggleId, boolean>>({
    autoReply: false,
    autoAccept: false,
    autoReject: false,
    dealScore: false,
    negotiate: false,
    autoRelist: false,
    priceDrop: false,
  });
  const [replyTone, setReplyTone] = useState("friendly");
  const [acceptMin, setAcceptMin] = useState("");
  const [rejectFloor, setRejectFloor] = useState("");
  const [rejectCounter, setRejectCounter] = useState(false);
  const [negotiateDisc, setNegotiateDisc] = useState("");
  const [relistMax, setRelistMax] = useState("");
  const [dropPct, setDropPct] = useState("");
  const [dropDays, setDropDays] = useState("");

  const [isActive, setIsActive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const unsubLogRef = useRef<(() => void) | null>(null);

  // Load everything each time the modal opens.
  useEffect(() => {
    if (!open || !user) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const lr = await fetch("/api/deal?action=agent-limits&uid=" + user!.uid);
        if (lr.ok) {
          const data = await lr.json();
          if (!cancelled) setLimits(data);
        }
      } catch (e) {
        console.warn("[agent] limits fetch failed", e);
      }

      try {
        const { doc, getDoc } = await import("firebase/firestore");
        const userSnap = await getDoc(doc(db, "users", user!.uid));
        const userData = userSnap.exists() ? (userSnap.data() as Record<string, unknown>) : {};
        const keyIds = (userData.apiKeyIds as string[]) || [];

        let activeKeys: ApiKeyOption[] = [];
        if (keyIds.length) {
          const snaps = await Promise.all(keyIds.map((id) => getDoc(doc(db, "apiKeys", id))));
          activeKeys = snaps
            .filter((s) => s.exists() && (s.data() as ApiKeyOption).active)
            .map((s) => ({ id: s.id, ...(s.data() as object) }) as ApiKeyOption);
        }
        if (cancelled) return;
        setKeys(activeKeys);

        const agentConfig = (userData.agentConfig as AgentConfig) || {};
        setIsActive(agentConfig.active === true);
        setSelectedKeyId(agentConfig.keyId && activeKeys.some((k) => k.id === agentConfig.keyId) ? agentConfig.keyId : "");

        setToggles({
          autoReply: !!agentConfig.autoReply?.enabled,
          autoAccept: !!agentConfig.autoAccept?.enabled,
          autoReject: !!agentConfig.autoReject?.enabled,
          dealScore: !!agentConfig.dealScore?.enabled,
          negotiate: !!agentConfig.negotiate?.enabled,
          autoRelist: !!agentConfig.autoRelist?.enabled,
          priceDrop: !!agentConfig.priceDrop?.enabled,
        });
        if (agentConfig.autoReply?.tone) setReplyTone(agentConfig.autoReply.tone);
        if (agentConfig.autoAccept?.minPercent != null) setAcceptMin(String(agentConfig.autoAccept.minPercent));
        if (agentConfig.autoReject?.floor != null) setRejectFloor(String(agentConfig.autoReject.floor));
        setRejectCounter(!!agentConfig.autoReject?.sendCounter);
        if (agentConfig.negotiate?.maxDiscount != null) setNegotiateDisc(String(agentConfig.negotiate.maxDiscount));
        if (agentConfig.autoRelist?.maxCount != null) setRelistMax(String(agentConfig.autoRelist.maxCount));
        if (agentConfig.priceDrop?.pct != null) setDropPct(String(agentConfig.priceDrop.pct));
        if (agentConfig.priceDrop?.days != null) setDropDays(String(agentConfig.priceDrop.days));
      } catch (e) {
        console.warn("[agent] load failed", e);
      } finally {
        if (!cancelled) setLoading(false);
      }

      // Activity log stream
      try {
        const { collection, query, orderBy, limit, onSnapshot } = await import("firebase/firestore");
        if (unsubLogRef.current) {
          unsubLogRef.current();
          unsubLogRef.current = null;
        }
        const logRef = collection(db, "users", user!.uid, "agentLog");
        const q = query(logRef, orderBy("ts", "desc"), limit(8));
        unsubLogRef.current = onSnapshot(
          q,
          (snap) => {
            if (cancelled) return;
            setActivity(
              snap.docs.map((d) => {
                const data = d.data() as { type?: string; msg?: string; ts?: { toDate?: () => Date } };
                return {
                  id: d.id,
                  type: data.type || "",
                  msg: data.msg || "\u2014",
                  ts: data.ts?.toDate ? data.ts.toDate()! : new Date(),
                };
              })
            );
          },
          (err) => console.warn("[agent] log stream error", err)
        );
      } catch (e) {
        console.warn("[agent] log stream setup error", e);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user]);

  // Unsubscribe from the log stream on close/unmount.
  useEffect(() => {
    if (!open && unsubLogRef.current) {
      unsubLogRef.current();
      unsubLogRef.current = null;
    }
    return () => {
      if (unsubLogRef.current) {
        unsubLogRef.current();
        unsubLogRef.current = null;
      }
    };
  }, [open]);

  if (!open) return null;

  const hasKey = !!selectedKeyId;
  const selectedKeyLabel = (() => {
    const k = keys.find((k) => k.id === selectedKeyId);
    return k ? (k.label || k.name || "Key") + (k.prefix ? "  \u00b7  " + k.prefix : "") : "";
  })();
  const selectedKeyLabelShort = selectedKeyLabel.split("\u00b7")[0].trim();

  function toggleExtra(id: ToggleId, on: boolean) {
    setToggles((prev) => ({ ...prev, [id]: on }));
  }

  async function handleSave() {
    const currentUser = auth.currentUser;
    if (!currentUser || !hasKey) return;
    setSaving(true);
    try {
      const { doc, updateDoc, addDoc, collection, serverTimestamp } = await import("firebase/firestore");

      const config: AgentConfig & { updatedAt: number } = {
        active: true,
        keyId: selectedKeyId,
        updatedAt: Date.now(),
        autoReply: { enabled: toggles.autoReply, tone: replyTone },
        autoAccept: { enabled: toggles.autoAccept, minPercent: parseFloat(acceptMin) || 100 },
        autoReject: {
          enabled: toggles.autoReject,
          floor: parseFloat(rejectFloor) || 0,
          sendCounter: rejectCounter,
        },
        dealScore: { enabled: toggles.dealScore },
        negotiate: { enabled: toggles.negotiate, maxDiscount: parseFloat(negotiateDisc) || 10 },
        autoRelist: { enabled: toggles.autoRelist, maxCount: parseInt(relistMax, 10) || 3 },
        priceDrop: {
          enabled: toggles.priceDrop,
          pct: parseFloat(dropPct) || 10,
          days: parseInt(dropDays, 10) || 7,
        },
      };

      await updateDoc(doc(db, "users", currentUser.uid), { agentConfig: config });

      const enabledCount = ALL_TOGGLES.filter((id) => toggles[id]).length;
      await addDoc(collection(db, "users", currentUser.uid, "agentLog"), {
        type: "config_saved",
        msg: `Agent activated with ${enabledCount} automation${enabledCount !== 1 ? "s" : ""} enabled.`,
        ts: serverTimestamp(),
      });

      setIsActive(true);
    } catch (err) {
      console.error("[agent] save error", err);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate() {
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    try {
      const { doc, updateDoc, addDoc, collection, serverTimestamp } = await import("firebase/firestore");
      await updateDoc(doc(db, "users", currentUser.uid), { "agentConfig.active": false });
      await addDoc(collection(db, "users", currentUser.uid, "agentLog"), {
        type: "deactivated",
        msg: "Agent deactivated by user.",
        ts: serverTimestamp(),
      });
      setIsActive(false);
    } catch (err) {
      console.error("[agent] deactivate error", err);
    }
  }

  function handleGoToApiSettings() {
    onClose();
    router.push("/settings/api");
  }

  const plans = ["free", "starter", "growth", "pro"] as const;
  const activePlan = limits?.plan || "free";
  const usedToday = limits?.usedToday || 0;
  const rpd = limits?.rpd || 1;
  const usagePct = Math.min(100, Math.round((usedToday / rpd) * 100));

  return (
    <div id="agentModal" className="active" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div id="agentModalInner">
        <div id="agentModalHeader">
          <div id="agentModalHeaderLeft">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="10" rx="2" />
              <circle cx="12" cy="5" r="2" />
              <path d="M12 7v4" />
              <line x1="8" y1="16" x2="8" y2="16" strokeWidth="3" />
              <line x1="16" y1="16" x2="16" y2="16" strokeWidth="3" />
            </svg>
            <div>
              <div id="agentModalTitle">Autopilot Agent</div>
              <div id="agentModalSub">Automate your deals, replies &amp; listings</div>
            </div>
          </div>
          <button id="agentModalClose" aria-label="Close agent" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div id="agentModalBody" data-scroll-lock-exempt>
          <div id="agentModalContent">
            <div id="agentStatusBar">
              <div id="agentStatusIconWrap" className={isActive ? "online" : ""}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="10" rx="2" />
                  <circle cx="12" cy="5" r="2" />
                  <path d="M12 7v4" />
                  <line x1="8" y1="16" x2="8" y2="16" strokeWidth="3" />
                  <line x1="16" y1="16" x2="16" y2="16" strokeWidth="3" />
                </svg>
              </div>
              <div id="agentStatusMeta">
                <div id="agentStatusName">Your Autopilot Agent</div>
                <div id="agentStatusLine">
                  {isActive
                    ? "Running on key: " + (selectedKeyLabelShort || "\u2014")
                    : hasKey
                      ? "Key ready \u2014 configure automations below"
                      : "Select an API key to activate"}
                </div>
              </div>
              <div id="agentStatusPill" className={isActive ? "online" : ""}>
                {isActive ? "Active" : "Offline"}
              </div>
            </div>

            <div className="agent-section-head">Your Plan &amp; Limits</div>
            <div id="agentPlanWrap">
              {plans.map((p) => {
                const meta = PLAN_META[p];
                const isYours = p === activePlan;
                const planData = limits?.allPlans?.[p];
                return (
                  <div
                    key={p}
                    className={"agent-plan-card" + (isYours ? " apc-active" : "")}
                    style={{ ["--apc-color" as string]: meta.color, ["--apc-rgb" as string]: meta.rgb }}
                  >
                    <div className="apc-name">{meta.name}</div>
                    <div className="apc-rpd">
                      {planData ? planData.rpd.toLocaleString() : "\u2014"} <span>req/day</span>
                    </div>
                    <div className="apc-keys">
                      {planData ? `${planData.maxKeys} API key${planData.maxKeys !== 1 ? "s" : ""}` : "\u2014"}
                    </div>
                    <div className={"apc-badge" + (isYours ? "" : " apc-upgrade")}>
                      {isYours ? "Your Plan" : meta.price}
                    </div>
                  </div>
                );
              })}
            </div>

            <div id="agentUsageCard">
              <div id="agentUsageTop">
                <div id="agentUsageLabel">Daily requests used {limits?.linkedKeyId ? "(this key)" : ""}</div>
                <div id="agentUsageCount">
                  {usedToday.toLocaleString()} / {rpd.toLocaleString()}
                </div>
              </div>
              <div id="agentUsageTrack">
                <div
                  id="agentUsageFill"
                  className={usagePct >= 95 ? "full" : usagePct >= 70 ? "warn" : ""}
                  style={{ width: usagePct + "%" }}
                />
              </div>
              <div id="agentUsageReset">
                {limits?.linkedKeyId
                  ? "Each linked API key gets its own daily quota \u00b7 resets at midnight UTC"
                  : "Link an API key to start tracking usage \u00b7 resets at midnight UTC"}
              </div>
            </div>

            <div id="agentKeyCard">
              <div id="agentKeyLimitRow">
                <div className="agent-card-label">Identity &amp; Authorization</div>
                <div id="agentKeyLimitBadge">
                  {limits ? `${limits.keyCount} / ${limits.maxKeys} keys` : "\u2014 / \u2014 keys"}
                </div>
              </div>
              {keys.length > 0 ? (
                <select
                  id="agentKeySelect"
                  value={selectedKeyId}
                  onChange={(e) => setSelectedKeyId(e.target.value)}
                >
                  <option value="">{"\u2014 Select an API key \u2014"}</option>
                  {keys.map((k) => (
                    <option key={k.id} value={k.id}>
                      {(k.label || k.name || "API Key") + "  \u00b7  " + (k.prefix || "")}
                    </option>
                  ))}
                </select>
              ) : (
                <div id="agentNoKeyBanner" className="visible">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(139,92,246,.6)" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 8v4M12 16h.01" />
                  </svg>
                  <div>
                    <div className="agent-nokey-text">
                      No API keys found. Generate one in Settings \u2192 API &amp; Integrations to power your agent.
                    </div>
                    <button id="agentCreateKeyBtn" onClick={handleGoToApiSettings}>
                      Go to API Settings \u2192
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="agent-section-head">Automations</div>

            <ToggleCard
              id="autoReply"
              disabled={!hasKey}
              iconClass="ati-violet"
              title="Auto-Reply to Buyers"
              desc="Agent sends instant replies to new inquiries using your listing info and custom tone."
              checked={toggles.autoReply}
              onChange={(v) => toggleExtra("autoReply", v)}
              icon={<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />}
              extra={
                EXTRAS.includes("autoReply") && toggles.autoReply ? (
                  <div className="agent-threshold-row">
                    <span className="agent-threshold-label">Reply tone:</span>
                    <select
                      className="agent-threshold-input"
                      value={replyTone}
                      onChange={(e) => setReplyTone(e.target.value)}
                      style={{ width: "auto", paddingRight: 28 }}
                    >
                      <option value="professional">Professional</option>
                      <option value="friendly">Friendly</option>
                      <option value="concise">Concise</option>
                    </select>
                  </div>
                ) : null
              }
            />

            <ToggleCard
              id="autoAccept"
              disabled={!hasKey}
              iconClass="ati-green"
              title="Auto-Accept Deals"
              desc="Automatically accept incoming offers at or above a percentage of your listed price."
              checked={toggles.autoAccept}
              onChange={(v) => toggleExtra("autoAccept", v)}
              icon={<polyline points="20 6 9 17 4 12" />}
              extra={
                toggles.autoAccept ? (
                  <div className="agent-threshold-row">
                    <span className="agent-threshold-label">Min. offer (% of listed price):</span>
                    <input
                      type="number"
                      className="agent-threshold-input"
                      placeholder="e.g. 80"
                      min={1}
                      max={100}
                      value={acceptMin}
                      onChange={(e) => setAcceptMin(e.target.value)}
                    />
                  </div>
                ) : null
              }
            />

            <ToggleCard
              id="autoReject"
              disabled={!hasKey}
              iconClass="ati-red"
              title="Auto-Reject Low Offers"
              desc="Decline offers below your floor price and optionally send a polite counter note."
              checked={toggles.autoReject}
              onChange={(v) => toggleExtra("autoReject", v)}
              icon={
                <>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </>
              }
              extra={
                toggles.autoReject ? (
                  <>
                    <div className="agent-threshold-row">
                      <span className="agent-threshold-label">Floor price ($):</span>
                      <input
                        type="number"
                        className="agent-threshold-input"
                        placeholder="e.g. 200"
                        min={1}
                        value={rejectFloor}
                        onChange={(e) => setRejectFloor(e.target.value)}
                      />
                    </div>
                    <div className="agent-threshold-row" style={{ marginTop: 6 }}>
                      <span className="agent-threshold-label">Send counter note:</span>
                      <label className="agent-sw" style={{ width: 32, height: 18 }}>
                        <input
                          type="checkbox"
                          checked={rejectCounter}
                          onChange={(e) => setRejectCounter(e.target.checked)}
                        />
                        <div className="agent-sw-track" style={{ borderRadius: 9 }}>
                          <div className="agent-sw-thumb" style={{ width: 12, height: 12, top: 2, left: 2 }} />
                        </div>
                      </label>
                    </div>
                  </>
                ) : null
              }
            />

            <div className="agent-section-head">Intelligence</div>

            <ToggleCard
              id="dealScore"
              disabled={!hasKey}
              iconClass="ati-amber"
              title="Buyer Trust Scoring"
              desc="Agent checks buyer history, review score, and wallet balance before acting on their offer."
              checked={toggles.dealScore}
              onChange={(v) => toggleExtra("dealScore", v)}
              icon={<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />}
            />

            <ToggleCard
              id="negotiate"
              disabled={!hasKey}
              iconClass="ati-cyan"
              title="Smart Price Negotiation"
              desc="Agent counters low offers with a calculated price (listing price \u00d7 your wiggle %) instead of flat rejection."
              checked={toggles.negotiate}
              onChange={(v) => toggleExtra("negotiate", v)}
              icon={
                <>
                  <line x1="12" y1="1" x2="12" y2="23" />
                  <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </>
              }
              extra={
                toggles.negotiate ? (
                  <div className="agent-threshold-row">
                    <span className="agent-threshold-label">Max discount (%):</span>
                    <input
                      type="number"
                      className="agent-threshold-input"
                      placeholder="e.g. 15"
                      min={1}
                      max={50}
                      value={negotiateDisc}
                      onChange={(e) => setNegotiateDisc(e.target.value)}
                    />
                  </div>
                ) : null
              }
            />

            <div className="agent-section-head">Listings &amp; Visibility</div>

            <ToggleCard
              id="autoRelist"
              disabled={!hasKey}
              iconClass="ati-blue"
              title="Auto-Relist Expired Listings"
              desc="Automatically repost listings that expire without a sale, keeping your catalogue fresh."
              checked={toggles.autoRelist}
              onChange={(v) => toggleExtra("autoRelist", v)}
              icon={
                <>
                  <polyline points="1 4 1 10 7 10" />
                  <path d="M3.51 15a9 9 0 1 0 .49-3.99" />
                </>
              }
              extra={
                toggles.autoRelist ? (
                  <div className="agent-threshold-row">
                    <span className="agent-threshold-label">Max re-lists per listing:</span>
                    <input
                      type="number"
                      className="agent-threshold-input"
                      placeholder="e.g. 3"
                      min={1}
                      max={10}
                      value={relistMax}
                      onChange={(e) => setRelistMax(e.target.value)}
                    />
                  </div>
                ) : null
              }
            />

            <ToggleCard
              id="priceDrop"
              disabled={!hasKey}
              iconClass="ati-rose"
              title="Timed Price Drop"
              desc="Agent lowers listing price by a set % if no deal is struck after a number of days."
              checked={toggles.priceDrop}
              onChange={(v) => toggleExtra("priceDrop", v)}
              icon={
                <>
                  <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                  <polyline points="17 6 23 6 23 12" />
                </>
              }
              extra={
                toggles.priceDrop ? (
                  <div className="agent-threshold-row">
                    <span className="agent-threshold-label">Drop by (%):</span>
                    <input
                      type="number"
                      className="agent-threshold-input"
                      placeholder="e.g. 10"
                      min={1}
                      max={40}
                      style={{ width: 70 }}
                      value={dropPct}
                      onChange={(e) => setDropPct(e.target.value)}
                    />
                    <span className="agent-threshold-label">after (days):</span>
                    <input
                      type="number"
                      className="agent-threshold-input"
                      placeholder="e.g. 7"
                      min={1}
                      style={{ width: 60 }}
                      value={dropDays}
                      onChange={(e) => setDropDays(e.target.value)}
                    />
                  </div>
                ) : null
              }
            />

            <div className="agent-section-head">Recent Activity</div>
            <div id="agentActivityCard">
              <div className="agent-card-label">Agent Log</div>
              <div id="agentActivityList">
                {activity.length === 0 ? (
                  <div id="agentNoActivity">No activity yet \u2014 activate the agent to start logging actions here.</div>
                ) : (
                  activity.map((row) => (
                    <div className="agent-act-row" key={row.id}>
                      <div className={"agent-act-dot " + (DOT_COLOR[row.type] || "violet")} />
                      <div className="agent-act-body">
                        <div className="agent-act-msg">{row.msg}</div>
                        <div className="agent-act-time">{tsAgo(row.ts)}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <button
              id="agentSaveBtn"
              disabled={!hasKey || saving || loading}
              className={isActive ? "active-state" : hasKey ? "enabled" : ""}
              onClick={handleSave}
            >
              {saving ? "Saving\u2026" : isActive ? "Update Agent" : "Activate Agent"}
            </button>

            {isActive && (
              <div id="agentDangerCard">
                <div className="agent-danger-meta">
                  <div className="agent-danger-title">Deactivate Agent</div>
                  <div className="agent-danger-desc">Pause all automations. Settings are preserved.</div>
                </div>
                <button id="agentDeactivateBtn" onClick={handleDeactivate}>
                  Deactivate
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ToggleCard({
  id,
  disabled,
  iconClass,
  title,
  desc,
  checked,
  onChange,
  icon,
  extra,
}: {
  id: string;
  disabled: boolean;
  iconClass: string;
  title: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  icon: React.ReactNode;
  extra?: React.ReactNode;
}) {
  return (
    <div className={"agent-toggle-card" + (disabled ? " disabled" : "")} id={"atCard-" + id}>
      <div className={"agent-toggle-icon " + iconClass}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {icon}
        </svg>
      </div>
      <div className="agent-toggle-meta">
        <div className="agent-toggle-title">{title}</div>
        <div className="agent-toggle-desc">{desc}</div>
        {extra ? (
          <div className="agent-toggle-extra visible" id={"atExtra-" + id}>
            {extra}
          </div>
        ) : null}
      </div>
      <label className="agent-sw">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <div className="agent-sw-track">
          <div className="agent-sw-thumb" />
        </div>
      </label>
    </div>
  );
}
