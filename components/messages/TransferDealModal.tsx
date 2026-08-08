"use client";

import React, { useEffect, useRef, useState } from "react";
import { useConfirm } from "@/lib/useConfirm";
import {
  useTransferDeal,
  TDM_CATEGORIES,
  TDM_TYPE_THEME,
  TDM_IMAGE_EXT_RE,
  type TdmListingType,
  type TdmItemType,
  type TdmPayload,
  type TdmChecklistItem,
} from "@/lib/useTransferDeal";
import { TdmIcon, TdmArrowIcon, TdmCheckmarkIcon } from "./tdmIcons";
import type { PaymentStatus } from "@/lib/useDealChat";
import { useScrollLock } from "@/lib/useScrollLock";

// Ports the UI layer of Js/transfer-deal.js (933 lines) — checklist grid
// (2-column, per .tdm-checklist-column in globals.css), per-item modal
// (upload/transfer/credential + login-form toggle), preview sheet,
// finalize-into-zip flow, real payment-status warning banner, and the
// GitHub collaborator card. Styling is 100% the already-ported .tdm-*
// classes in globals.css (verified 1:1 against the original — no new
// CSS was needed for this component).
//
// Opened from DealChatPanel.tsx's two "Coming soon" stubs:
//   - Seller's "Mark Delivered" button → opens straight into the
//     checklist for the buyer's listing type.
//   - "Transfer Deal" attach-pill → same modal.
// Both call sites pass the same props; this component doesn't care
// which one opened it.

const NAV_TABS: TdmListingType[] = ["website", "game", "app"];

// Route-level (and pre-data) loading state for the Transfer Deals flow.
// Mirrors the real header/nav/checklist-grid shape so there's no visible
// swap-in jolt once the actual data (chat room, checklist progress) loads —
// same reasoning as CheckoutRouteSkeleton in CheckoutRoute.tsx. Used two
// places: TransferDealRoute renders this itself while chat.room is still
// loading, and app/messages/deal/[id]/transfer/loading.tsx renders it as
// the route's Suspense fallback for the gap before TransferDealRoute's own
// JS/data even starts resolving.
export function TransferDealModalSkeleton({ onBack }: { onBack?: () => void }) {
  return (
    <div id="transferDealModal" className="tdm-open">
      <header className="tdm-header">
        <div className="tdm-brand">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 1l4 4-4 4" />
            <path d="M3 11V9a4 4 0 014-4h14" />
            <path d="M7 23l-4-4 4-4" />
            <path d="M21 13v2a4 4 0 01-4 4H3" />
          </svg>
          <h2>TRANSFER DEALS</h2>
        </div>
        <button className="tdm-cancel-btn" onClick={onBack} disabled={!onBack}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
          Cancel
        </button>
      </header>

      <nav className="tdm-checklist-nav">
        {NAV_TABS.map((t, i) => (
          <button key={t} className={`tdm-nav-btn${i === 0 ? " active" : ""}`} disabled>
            {t.toUpperCase()}
          </button>
        ))}
      </nav>

      <main className="tdm-checklist-main" data-scroll-lock-exempt>
        <div className="tdm-checklist-container">
          <div className="tdm-checklist-column">
            {[0, 1, 2, 3].map((i) => (
              <div className="tdm-checklist-item" key={`l-${i}`}>
                <div className="skel-block" style={{ width: 34, height: 34, borderRadius: 9 }} />
                <div className="skel-block skel-text" style={{ width: "55%" }} />
              </div>
            ))}
          </div>
          <div className="tdm-checklist-column">
            {[0, 1, 2, 3].map((i) => (
              <div className="tdm-checklist-item" key={`r-${i}`}>
                <div className="skel-block" style={{ width: 34, height: 34, borderRadius: 9 }} />
                <div className="skel-block skel-text" style={{ width: "55%" }} />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

export interface TransferDealModalProps {
  chatRoomId: string;
  sellerUid: string | null;
  buyerUid: string | null;
  listingId: string | null;
  dealId: string | null;
  paymentStatus: PaymentStatus;
  isSeller: boolean;
  syncThreads: (previewText: string, sellerUid: string | null, buyerUid: string | null) => Promise<void>;
  onClose: () => void;
}

export default function TransferDealModal(props: TransferDealModalProps) {
  const { chatRoomId, sellerUid, buyerUid, listingId, dealId, paymentStatus, isSeller, syncThreads, onClose } = props;
  const { alert, ConfirmHost } = useConfirm();

  const tdm = useTransferDeal({ chatRoomId, sellerUid, buyerUid, listingId, dealId, paymentStatus, isSeller, syncThreads });

  const [activeItem, setActiveItem] = useState<{ key: string; item: TdmChecklistItem } | null>(null);
  // The full-screen "Protected Transaction" cover always shows first for
  // an opened item; Continue flips this to true to reveal the real
  // item panel (file upload / secure secret / collaborator invite / etc).
  const [itemPanelUnlocked, setItemPanelUnlocked] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [addOtherOpen, setAddOtherOpen] = useState(false);

  // Lock page scroll while open — shared reference-counted hook (see
  // lib/useScrollLock.ts). The previous plain body.style.overflow toggle
  // could stomp another modal's lock and restore scroll while that
  // modal was still open (e.g. this route can be reached while
  // DealChatPanel's own overlays are still logically "open" in history).
  useScrollLock(true);

  function handleClose() {
    onClose();
  }

  const warningBannerText = getWarningBanner(paymentStatus, tdm.isTabFinalized);

  return (
    <div id="transferDealModal" className="tdm-open">
      <header className="tdm-header">
        <div className="tdm-brand">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 1l4 4-4 4" />
            <path d="M3 11V9a4 4 0 014-4h14" />
            <path d="M7 23l-4-4 4-4" />
            <path d="M21 13v2a4 4 0 01-4 4H3" />
          </svg>
          <h2>TRANSFER DEALS</h2>
        </div>
        <button className="tdm-cancel-btn" onClick={handleClose}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
          Cancel
        </button>
      </header>

      {warningBannerText ? (
        <div className={`tdm-warning-banner active ${warningBannerClass(paymentStatus, tdm.isTabFinalized)}`} dangerouslySetInnerHTML={{ __html: warningBannerText }} />
      ) : null}

      {tdm.loadError ? (
        <div style={{ padding: "0.5rem 1.2rem", fontSize: "0.78rem", color: "#eab308", textAlign: "center" }}>{tdm.loadError}</div>
      ) : null}

      <GithubCard tdm={tdm} isSeller={isSeller} alert={alert} />

      <nav className="tdm-checklist-nav">
        {NAV_TABS.map((t) => (
          <button key={t} className={`tdm-nav-btn${tdm.tab === t ? " active" : ""}`} onClick={() => tdm.switchTab(t)}>
            {t.toUpperCase()}
          </button>
        ))}
      </nav>

      <main className="tdm-checklist-main" data-scroll-lock-exempt>
        <ChecklistGrid
          tab={tdm.tab}
          completed={tdm.completed}
          customItems={tdm.customItems}
          onOpenItem={(key, item) => {
            setActiveItem({ key, item });
            setItemPanelUnlocked(false);
          }}
          onAddOther={() => setAddOtherOpen(true)}
        />
      </main>

      <FloatingCta finalized={tdm.isTabFinalized} enabled={tdm.anyCompletedInTab} onClick={() => tdm.anyCompletedInTab && !tdm.isTabFinalized && setPreviewOpen(true)} />

      {activeItem && !itemPanelUnlocked ? (
        <ItemCoverScreen
          key={activeItem.key}
          item={activeItem.item}
          onCancel={() => setActiveItem(null)}
          onContinue={() => setItemPanelUnlocked(true)}
        />
      ) : null}

      {activeItem && itemPanelUnlocked ? (
        <ItemModal
          key={activeItem.key}
          item={activeItem.item}
          buyerEmail={tdm.buyerEmail}
          existing={tdm.payloads[activeItem.key]}
          attachedRepo={tdm.attachedRepo}
          githubStatus={tdm.githubStatus}
          githubCollabUsername={tdm.githubCollabUsername}
          inviteGithubCollaborator={tdm.inviteGithubCollaborator}
          onCancel={() => setActiveItem(null)}
          onDone={(payload) => {
            tdm.markCompleted(activeItem.key, payload);
            setActiveItem(null);
          }}
          alert={alert}
        />
      ) : null}

      {addOtherOpen ? (
        <AddOtherModal
          onCancel={() => setAddOtherOpen(false)}
          onCreate={(label, type) => {
            const created = tdm.addCustomItem(label, type);
            setAddOtherOpen(false);
            setActiveItem(created);
            setItemPanelUnlocked(false);
          }}
        />
      ) : null}

      {previewOpen ? (
        <PreviewSheet
          tab={tdm.tab}
          customItems={tdm.customItems}
          completedKeysForTab={tdm.completedKeysForTab}
          finalizing={tdm.finalizing}
          onRemove={(key) => {
            tdm.unmarkCompleted(key);
            if (tdm.completedKeysForTab(tdm.tab).length <= 1) setPreviewOpen(false);
          }}
          onClose={() => setPreviewOpen(false)}
          onConfirm={async () => {
            const result = await tdm.finalizeTransfer();
            if (result.ok === true) {
              setPreviewOpen(false);
            } else if (result.ok === false) {
              await alert({ theme: "danger", title: "Transfer Failed", msg: result.error });
            }
          }}
        />
      ) : null}

      <ConfirmHost />
    </div>
  );
}

function getWarningBanner(status: PaymentStatus, isFinalized: boolean): string | null {
  if (isFinalized) return "\u26a0\ufe0f <b>This cannot be reversed.</b> The deal is finalized. Thank you \u263a\ufe0f";
  if (status === "unfunded") return "<b>Payment hasn\u2019t been made yet.</b> You can prepare your delivery items now, but wait for the buyer\u2019s payment to be confirmed in escrow before sending credentials or files.";
  if (status === "funded") return "<b>Payment is locked in escrow.</b> It won\u2019t reach your wallet until the buyer confirms they\u2019ve received everything. Either side can open a dispute if something goes wrong.";
  if (status === "delivered") return "<b>Delivery sent.</b> Funds stay in escrow until the buyer confirms receipt \u2014 you\u2019ll be notified once they release payment.";
  if (status === "disputed") return "<b>This deal is under dispute.</b> Funds remain in escrow while our support team reviews it.";
  return "<b>Funds are secured in escrow</b> for the duration of this deal.";
}

function warningBannerClass(status: PaymentStatus, isFinalized: boolean): string {
  if (isFinalized) return "tdm-status-delivered";
  if (status === "funded") return "tdm-status-funded";
  if (status === "delivered") return "tdm-status-delivered";
  if (status === "disputed") return "tdm-status-disputed";
  return "";
}

function ChecklistGrid({
  tab,
  completed,
  customItems,
  onOpenItem,
  onAddOther,
}: {
  tab: TdmListingType;
  completed: Record<string, boolean>;
  customItems: TdmChecklistItem[];
  onOpenItem: (key: string, item: TdmChecklistItem) => void;
  onAddOther: () => void;
}) {
  const data = TDM_CATEGORIES[tab];
  const builtinCount = data.left.length + data.right.length;
  return (
    <div className="tdm-checklist-container">
      <div className="tdm-checklist-column">
        {data.left.map((item, idx) => (
          <ChecklistRow key={idx} item={item} itemKey={`${tab}-${idx}`} completed={!!completed[`${tab}-${idx}`]} onOpen={onOpenItem} />
        ))}
        {customItems.map((item, i) => {
          const realIdx = builtinCount + i;
          return <ChecklistRow key={`custom-${realIdx}`} item={item} itemKey={`${tab}-${realIdx}`} completed={!!completed[`${tab}-${realIdx}`]} onOpen={onOpenItem} />;
        })}
      </div>
      <div className="tdm-checklist-column">
        {data.right.map((item, idx) => {
          const realIdx = data.left.length + idx;
          return <ChecklistRow key={realIdx} item={item} itemKey={`${tab}-${realIdx}`} completed={!!completed[`${tab}-${realIdx}`]} onOpen={onOpenItem} />;
        })}
        <div className="tdm-checklist-item" onClick={onAddOther}>
          <div className="tdm-icon-wrapper">
            <TdmIcon id="other" />
          </div>
          <span className="tdm-item-label">Other (not listed here)</span>
          <div className="tdm-arrow-wrapper">
            <TdmArrowIcon />
          </div>
        </div>
      </div>
    </div>
  );
}

function ChecklistRow({
  item,
  itemKey,
  completed,
  onOpen,
}: {
  item: TdmChecklistItem;
  itemKey: string;
  completed: boolean;
  onOpen: (key: string, item: TdmChecklistItem) => void;
}) {
  return (
    <div className={`tdm-checklist-item${completed ? " tdm-completed" : ""}`} onClick={() => onOpen(itemKey, item)}>
      <div className="tdm-icon-wrapper">
        <TdmIcon id={item.icon} />
      </div>
      <span className="tdm-item-label">{item.label}</span>
      <div className="tdm-arrow-wrapper">
        <TdmArrowIcon />
      </div>
      <TdmCheckmarkIcon />
    </div>
  );
}

// ---------- "Other" prompt: name a custom item + pick its delivery type ----------
function AddOtherModal({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (label: string, type: "file_upload" | "secure_secret") => void;
}) {
  const [label, setLabel] = useState("");
  const [type, setType] = useState<"file_upload" | "secure_secret">("file_upload");

  return (
    <div className="tdm-item-modal-overlay active" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="tdm-item-modal" style={{ "--tdm-accent": TDM_TYPE_THEME[type].accent } as React.CSSProperties} data-scroll-lock-exempt>
        <div className="tdm-modal-theme-head" style={{ "--tdm-accent": TDM_TYPE_THEME[type].accent } as React.CSSProperties}>
          <div className="tdm-modal-theme-icon">
            <TdmIcon id="other" />
          </div>
          <div>
            <div className="tdm-modal-theme-kicker">Other</div>
            <h2 style={{ margin: 0 }}>Add a custom item</h2>
          </div>
        </div>
        <p className="tdm-modal-blurb">Not seeing what you need to transfer? Name it and choose how you'll deliver it.</p>

        <input
          className="tdm-gh-input"
          type="text"
          placeholder="e.g. Newsletter subscriber list"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={80}
          autoFocus
        />

        <div className="tdm-type-choice">
          <button
            type="button"
            className={`tdm-type-choice-btn${type === "file_upload" ? " active" : ""}`}
            style={{ "--tdm-accent": TDM_TYPE_THEME.file_upload.accent } as React.CSSProperties}
            onClick={() => setType("file_upload")}
          >
            {TDM_TYPE_THEME.file_upload.heading}
          </button>
          <button
            type="button"
            className={`tdm-type-choice-btn${type === "secure_secret" ? " active" : ""}`}
            style={{ "--tdm-accent": TDM_TYPE_THEME.secure_secret.accent } as React.CSSProperties}
            onClick={() => setType("secure_secret")}
          >
            {TDM_TYPE_THEME.secure_secret.heading}
          </button>
        </div>

        <div className="tdm-btn-group">
          <button type="button" className="tdm-cover-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="tdm-cover-continue"
            disabled={!label.trim()}
            onClick={() => onCreate(label, type)}
          >
            Add Item
          </button>
        </div>
      </div>
    </div>
  );
}

function FloatingCta({ finalized, enabled, onClick }: { finalized: boolean; enabled: boolean; onClick: () => void }) {
  const cls = finalized ? "tdm-floating-cta tdm-finalized" : enabled ? "tdm-floating-cta tdm-enabled" : "tdm-floating-cta";
  return (
    <button className={cls} disabled={finalized || !enabled} onClick={onClick}>
      {finalized ? "TRANSFERRED \u2713" : "TRANSFER NOW"}
    </button>
  );
}

// ---------- Full-screen "Protected Transaction" cover ----------
// Shown first whenever a checklist item is opened — a trust/reassurance
// screen, not an item-specific one, so its image and copy stay fixed
// (the Siterifty escrow branding, per instruction) rather than varying
// per item. Continue is currently a no-op placeholder; the per-item
// completion panels (ItemModal below) ship in a later pass.
const TDM_COVER_IMAGE = "https://cdn.phototourl.com/member/2026-07-22-9c8f1cef-62db-491b-8337-161189536aad.jpg";

function ItemCoverScreen({ item, onCancel, onContinue }: { item: TdmChecklistItem; onCancel: () => void; onContinue: () => void }) {
  const [scrolled, setScrolled] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll lock — shared reference-counted hook (see lib/useScrollLock.ts).
  // This screen renders while TransferDealModal is already locked; a
  // hand-rolled body.style.overflow toggle here would capture that
  // already-"hidden" value as its own "previous" and restore it on
  // close, leaving scroll stuck locked afterward.
  useScrollLock(true);

  return (
    <div className="tdm-cover-overlay">
      <button type="button" className="tdm-cover-cancel" onClick={onCancel}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
        Cancel
      </button>

      <div
        className="tdm-cover-scroll"
        ref={scrollRef}
        onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 12)}
      >
        <section className="tdm-cover-hero">
          <div className="tdm-cover-hero-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
          </div>
          <h1 className="tdm-cover-title">Protected Transaction</h1>
          <p className="tdm-cover-desc">
            This is a <strong>secured escrow</strong> — it&apos;s only between <strong>you and the buyer</strong>. This transaction is
            protected by <span className="tdm-cover-highlight">Siterifty</span>. In case you have questions or don&apos;t understand,{" "}
            <strong>contact us before sending anything.</strong>
          </p>
        </section>

        <div className="tdm-cover-image-section">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={TDM_COVER_IMAGE} alt="Siterifty Escrow — protected transaction" loading="eager" />
        </div>

        <div className="tdm-cover-content">
          <div className="tdm-cover-notice">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <p>
              <strong>Reminder:</strong> Only proceed once you fully understand the escrow terms for <strong>{item.label}</strong>. Your
              funds are held securely by <strong>Siterifty</strong> until both parties confirm.
            </p>
          </div>

          <a href="#" className="tdm-cover-footer-link" onClick={(e) => e.preventDefault()}>
            <span>Contact Siterifty Support</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="13" height="13">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </a>
        </div>
      </div>

      <button type="button" className={`tdm-cover-continue${scrolled ? "" : " tdm-cover-continue-fixed"}`} onClick={onContinue}>
        Continue
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      </button>
    </div>
  );
}

// ---------- Item modal ----------
// Branches on the 5 professional action types (registry_transfer,
// collaborator_invite, file_upload, secure_secret, account_ownership).
// Items with `altType` (e.g. Source Code Repository: collaborator_invite
// or file_upload) let the seller pick which path to complete it through —
// the choice is a local view toggle, not a separate checklist entry.
function ItemModal({
  item,
  buyerEmail,
  existing,
  attachedRepo,
  githubStatus,
  githubCollabUsername,
  inviteGithubCollaborator,
  onCancel,
  onDone,
  alert,
}: {
  item: TdmChecklistItem;
  buyerEmail: string;
  existing: TdmPayload | undefined;
  attachedRepo: import("@/lib/listings").AttachedRepo | null | undefined;
  githubStatus: "none" | "invited" | "added";
  githubCollabUsername: string;
  inviteGithubCollaborator: (username: string) => Promise<{ ok: true; status: "none" | "invited" | "added" } | { ok: false; error: string }>;
  onCancel: () => void;
  onDone: (payload: TdmPayload) => void;
  alert: (opts: { theme?: "success" | "warning" | "danger" | "info" | "report"; title: string; msg: string }) => Promise<void>;
}) {
  const hasChoice = !!item.altType;
  const [activeType, setActiveType] = useState<TdmItemType>(item.type);
  const theme = TDM_TYPE_THEME[activeType];
  const label = item.label;

  return (
    <div className="tdm-item-modal-overlay active" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="tdm-item-modal" style={{ "--tdm-accent": theme.accent } as React.CSSProperties} data-scroll-lock-exempt>
        <div className="tdm-modal-theme-head" style={{ "--tdm-accent": theme.accent } as React.CSSProperties}>
          <div className="tdm-modal-theme-icon">
            <TypeThemeIcon type={activeType} />
          </div>
          <div>
            <div className="tdm-modal-theme-kicker">{theme.heading}</div>
            <h2 style={{ margin: 0 }}>{label}</h2>
          </div>
        </div>
        <p className="tdm-modal-blurb">{theme.blurb}</p>

        {hasChoice ? (
          <div className="tdm-type-choice">
            <button
              type="button"
              className={`tdm-type-choice-btn${activeType === item.type ? " active" : ""}`}
              style={{ "--tdm-accent": TDM_TYPE_THEME[item.type].accent } as React.CSSProperties}
              onClick={() => setActiveType(item.type)}
            >
              {TDM_TYPE_THEME[item.type].heading}
            </button>
            <button
              type="button"
              className={`tdm-type-choice-btn${activeType === item.altType ? " active" : ""}`}
              style={{ "--tdm-accent": TDM_TYPE_THEME[item.altType!].accent } as React.CSSProperties}
              onClick={() => setActiveType(item.altType!)}
            >
              {TDM_TYPE_THEME[item.altType!].heading}
            </button>
          </div>
        ) : null}

        {activeType === "file_upload" ? (
          <FileUploadPanel label={label} existing={existing} onCancel={onCancel} onDone={onDone} alert={alert} accent={theme.accent} />
        ) : activeType === "secure_secret" ? (
          <SecureSecretPanel label={label} existing={existing} onCancel={onCancel} onDone={onDone} alert={alert} accent={theme.accent} />
        ) : activeType === "collaborator_invite" ? (
          <CollaboratorInvitePanel
            label={label}
            attachedRepo={attachedRepo}
            githubStatus={githubStatus}
            githubCollabUsername={githubCollabUsername}
            inviteGithubCollaborator={inviteGithubCollaborator}
            onCancel={onCancel}
            onDone={onDone}
            alert={alert}
            accent={theme.accent}
          />
        ) : (
          // registry_transfer + account_ownership share the same real
          // pattern: show the buyer's real account email to copy into the
          // third-party console (Play Console, domain registrar, hosting
          // panel, etc.), seller completes the transfer there, then
          // attaches screenshot proof.
          <RecipientProofPanel
            label={label}
            buyerEmail={buyerEmail}
            existing={existing}
            onCancel={onCancel}
            onDone={onDone}
            alert={alert}
            accent={theme.accent}
          />
        )}
      </div>
    </div>
  );
}

// ---------- file_upload: file(s) + freeform build info ----------
function FileUploadPanel({
  label,
  existing,
  onCancel,
  onDone,
  alert,
  accent,
}: {
  label: string;
  existing: TdmPayload | undefined;
  onCancel: () => void;
  onDone: (payload: TdmPayload) => void;
  alert: (opts: { theme?: "success" | "warning" | "danger" | "info" | "report"; title: string; msg: string }) => Promise<void>;
  accent: string;
}) {
  const [filesArray, setFilesArray] = useState<File[]>(existing?.kind === "files" ? existing.files : []);
  const [buildInfo, setBuildInfo] = useState(
    existing?.kind === "files" ? (existing as { buildInfo?: string }).buildInfo || "" : ""
  );
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const thumbUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    const thumbUrls = thumbUrlsRef.current;
    return () => {
      thumbUrls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  function addFiles(newFiles: File[]) {
    setFilesArray((f) => [...f, ...newFiles]);
  }
  function removeFile(idx: number) {
    setFilesArray((f) => f.filter((_, i) => i !== idx));
  }

  async function handleDone() {
    if (filesArray.length === 0) {
      await alert({ theme: "warning", title: "Missing Information", msg: "Please upload at least one file." });
      return;
    }
    onDone({ kind: "files", label, files: filesArray, buildInfo: buildInfo.trim() || undefined } as TdmPayload);
  }

  return (
    <>
      <label>Drop files or click to browse</label>
      <div
        className={`tdm-dropzone${dragOver ? " tdm-dragover" : ""}`}
        style={{ "--tdm-accent": accent } as React.CSSProperties}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          addFiles(Array.from(e.dataTransfer.files));
        }}
      >
        <DropzoneIcon />
        <p>Drag &amp; drop files here or click to select</p>
        <div className="tdm-file-list">
          {filesArray.map((f, i) =>
            TDM_IMAGE_EXT_RE.test(f.name) ? (
              <FileThumb key={i} file={f} onRemove={() => removeFile(i)} thumbUrlsRef={thumbUrlsRef} />
            ) : (
              <span key={i} className="tdm-file-chip">
                {f.name}
                <button type="button" className="tdm-file-chip-remove" onClick={(e) => (e.stopPropagation(), removeFile(i))}>
                  ✕
                </button>
              </span>
            )
          )}
        </div>
        <input ref={fileInputRef} type="file" multiple hidden onChange={(e) => e.target.files && addFiles(Array.from(e.target.files))} />
      </div>

      <div className="tdm-buildinfo-section">
        <div className="tdm-buildinfo-head">
          <BuildInfoIcon />
          <div>
            <div className="tdm-buildinfo-title">Tell the buyer how this was built</div>
            <div className="tdm-buildinfo-sub">Tech stack, how it works, setup steps — anything that helps them run it. Optional, but buyers trust listings more when this is filled in.</div>
          </div>
        </div>
        <textarea
          className="tdm-buildinfo-textarea"
          placeholder={"e.g. Built with Next.js 14 + Postgres. Auth via NextAuth. Run `npm install` then `npm run dev`. Env vars needed: DATABASE_URL, STRIPE_KEY..."}
          value={buildInfo}
          onChange={(e) => setBuildInfo(e.target.value)}
          rows={5}
        />
      </div>

      <div className="tdm-btn-group">
        <button className="tdm-btn tdm-btn-cancel" onClick={onCancel}>
          Cancel
        </button>
        <button className="tdm-btn tdm-btn-done" style={{ background: accent, color: "#000" }} disabled={filesArray.length === 0} onClick={handleDone}>
          {filesArray.length === 0 ? "Mark Done (upload required)" : "Mark Done"}
        </button>
      </div>
    </>
  );
}

// ---------- secure_secret: email/password or a single key string, with a mandatory rotate-after-receiving warning ----------
function SecureSecretPanel({
  label,
  existing,
  onCancel,
  onDone,
  alert,
  accent,
}: {
  label: string;
  existing: TdmPayload | undefined;
  onCancel: () => void;
  onDone: (payload: TdmPayload) => void;
  alert: (opts: { theme?: "success" | "warning" | "danger" | "info" | "report"; title: string; msg: string }) => Promise<void>;
  accent: string;
}) {
  const [mode, setMode] = useState<"login" | "key">(existing?.kind === "text" ? "key" : "login");
  const [loginUrl, setLoginUrl] = useState(existing?.kind === "credentials" ? existing.loginUrl : "");
  const [loginEmail, setLoginEmail] = useState(existing?.kind === "credentials" ? existing.loginEmail : "");
  const [loginPassword, setLoginPassword] = useState(existing?.kind === "credentials" ? existing.loginPassword : "");
  const [textValue, setTextValue] = useState(existing?.kind === "text" ? existing.textValue : "");

  async function handleDone() {
    if (mode === "key") {
      const val = textValue.trim();
      if (!val) {
        await alert({ theme: "warning", title: "Missing Information", msg: "Please enter the key or token." });
        return;
      }
      onDone({ kind: "text", label, textValue: val });
      return;
    }
    const url = loginUrl.trim();
    const email = loginEmail.trim();
    const password = loginPassword.trim();
    if (!email || !password) {
      await alert({ theme: "warning", title: "Missing Information", msg: "Please fill in at least the email and password." });
      return;
    }
    onDone({ kind: "credentials", label, loginUrl: url, loginEmail: email, loginPassword: password });
  }

  return (
    <>
      <div className="tdm-secret-warning">
        <SecretShieldIcon />
        <p>
          <strong>The buyer must change this password immediately after receiving it.</strong> It's encrypted in transit and delivered to the
          buyer only — never shown again once the deal closes.
        </p>
      </div>

      <div className="tdm-secret-tabs">
        <button type="button" className={`tdm-secret-tab${mode === "login" ? " active" : ""}`} onClick={() => setMode("login")}>
          <LoginIcon /> Login credentials
        </button>
        <button type="button" className={`tdm-secret-tab${mode === "key" ? " active" : ""}`} onClick={() => setMode("key")}>
          <KeyIcon /> API key / token
        </button>
      </div>

      {mode === "login" ? (
        <div className="tdm-secret-fields">
          <div className="tdm-field">
            <label><UrlIcon />Site / Console URL <span className="tdm-field-optional">(optional)</span></label>
            <input type="text" placeholder="https://example.com/admin" value={loginUrl} onChange={(e) => setLoginUrl(e.target.value)} />
          </div>
          <div className="tdm-field">
            <label><MailIcon />Email / Username</label>
            <input type="text" placeholder="user@example.com" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} />
          </div>
          <div className="tdm-field">
            <label><LockIcon />Password</label>
            <input type="password" placeholder="••••••••" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} />
          </div>
        </div>
      ) : (
        <div className="tdm-secret-fields">
          <div className="tdm-field">
            <label><KeyIcon />Key / Token</label>
            <input type="text" placeholder="API key, keystore password, etc." value={textValue} onChange={(e) => setTextValue(e.target.value)} />
          </div>
        </div>
      )}

      <div className="tdm-btn-group">
        <button className="tdm-btn tdm-btn-cancel" onClick={onCancel}>
          Cancel
        </button>
        <button className="tdm-btn tdm-btn-done" style={{ background: accent, color: "#000" }} onClick={handleDone}>
          Mark Done
        </button>
      </div>
    </>
  );
}

// ---------- collaborator_invite: reuses the real GitHub invite flow already wired in useTransferDeal ----------
function CollaboratorInvitePanel({
  label,
  attachedRepo,
  githubStatus,
  githubCollabUsername,
  inviteGithubCollaborator,
  onCancel,
  onDone,
  alert,
  accent,
}: {
  label: string;
  attachedRepo: import("@/lib/listings").AttachedRepo | null | undefined;
  githubStatus: "none" | "invited" | "added";
  githubCollabUsername: string;
  inviteGithubCollaborator: (username: string) => Promise<{ ok: true; status: "none" | "invited" | "added" } | { ok: false; error: string }>;
  onCancel: () => void;
  onDone: (payload: TdmPayload) => void;
  alert: (opts: { theme?: "success" | "warning" | "danger" | "info" | "report"; title: string; msg: string }) => Promise<void>;
  accent: string;
}) {
  const [username, setUsername] = useState(githubCollabUsername);
  const [inviting, setInviting] = useState(false);
  const [status, setStatus] = useState(githubStatus);

  async function handleInvite() {
    const u = username.trim();
    if (!u) {
      await alert({ theme: "warning", title: "Missing Information", msg: "Enter the buyer's GitHub username first." });
      return;
    }
    setInviting(true);
    const result = await inviteGithubCollaborator(u);
    setInviting(false);
    if (result.ok === true) {
      setStatus(result.status);
    } else if (result.ok === false) {
      await alert({ theme: "danger", title: "Invite Failed", msg: result.error });
    }
  }

  if (!attachedRepo) {
    return (
      <>
        <div className="tdm-secret-warning">
          <SecretShieldIcon />
          <p>No repository is attached to this listing yet. Attach one from the listing editor, or use the file upload option above instead.</p>
        </div>
        <div className="tdm-btn-group">
          <button className="tdm-btn tdm-btn-cancel" onClick={onCancel}>
            Close
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="tdm-buyer-email">
        <span>{attachedRepo.fullName}</span>
        <a href={attachedRepo.htmlUrl || "#"} target="_blank" rel="noopener noreferrer" className="tdm-copy-btn">
          Open
        </a>
      </div>
      <div className="tdm-field">
        <label><GithubIcon />Buyer's GitHub username</label>
        <input type="text" placeholder="octocat" value={username} onChange={(e) => setUsername(e.target.value)} />
      </div>
      {status !== "none" ? (
        <div className={`tdm-gh-invite-msg${status === "added" ? " tdm-gh-msg-success" : ""}`}>
          {status === "invited" ? "Invite sent — waiting for the buyer to accept." : "Buyer has access to this repository."}
        </div>
      ) : null}
      <div className="tdm-btn-group">
        <button className="tdm-btn tdm-btn-cancel" onClick={onCancel}>
          Cancel
        </button>
        <button className="tdm-btn tdm-btn-done" style={{ background: accent, color: "#000" }} disabled={inviting} onClick={handleInvite}>
          {inviting ? "Inviting…" : status === "none" ? "Send Invite" : "Re-send Invite"}
        </button>
        <button
          className="tdm-btn tdm-btn-done"
          style={{ background: accent, color: "#000" }}
          disabled={status === "none"}
          onClick={() => onDone({ kind: "text", label, textValue: `GitHub collaborator invite: ${username} (${status})` })}
        >
          Mark Done
        </button>
      </div>
    </>
  );
}

// ---------- registry_transfer / account_ownership: show the buyer's real account email, seller transfers on the 3rd-party platform, then attaches proof ----------
function RecipientProofPanel({
  label,
  buyerEmail,
  existing,
  onCancel,
  onDone,
  alert,
  accent,
}: {
  label: string;
  buyerEmail: string;
  existing: TdmPayload | undefined;
  onCancel: () => void;
  onDone: (payload: TdmPayload) => void;
  alert: (opts: { theme?: "success" | "warning" | "danger" | "info" | "report"; title: string; msg: string }) => Promise<void>;
  accent: string;
}) {
  const [filesArray, setFilesArray] = useState<File[]>(
    existing?.kind === "screenshot_proof" ? (existing as { files: File[] }).files : []
  );
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const thumbUrlsRef = useRef<string[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const thumbUrls = thumbUrlsRef.current;
    return () => {
      thumbUrls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  function addFiles(newFiles: File[]) {
    setFilesArray((f) => [...f, ...newFiles]);
  }
  function removeFile(idx: number) {
    setFilesArray((f) => f.filter((_, i) => i !== idx));
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(buyerEmail || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  async function handleDone() {
    if (filesArray.length === 0) {
      await alert({ theme: "warning", title: "Missing Information", msg: "Please upload a screenshot or confirmation as proof of transfer." });
      return;
    }
    onDone({ kind: "screenshot_proof", label, files: filesArray, recipientEmail: buyerEmail } as TdmPayload);
  }

  return (
    <>
      <div className="tdm-recipient-steps">
        <div className="tdm-recipient-step">
          <span className="tdm-recipient-step-num">1</span>
          <div>
            <div className="tdm-recipient-step-title">Copy the buyer's account email</div>
            <div className="tdm-buyer-email">
              <span>{buyerEmail || "Buyer email unavailable — refresh and try again"}</span>
              <button className="tdm-copy-btn" onClick={handleCopy} disabled={!buyerEmail}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        </div>
        <div className="tdm-recipient-step">
          <span className="tdm-recipient-step-num">2</span>
          <div>
            <div className="tdm-recipient-step-title">Add the buyer on the platform's console</div>
            <div className="tdm-recipient-step-sub">Go to the official transfer/ownership tool for this item and add the email above as the new owner or team member.</div>
          </div>
        </div>
        <div className="tdm-recipient-step">
          <span className="tdm-recipient-step-num">3</span>
          <div className="tdm-recipient-step-title">Upload proof of the transfer</div>
        </div>
      </div>

      <div
        className={`tdm-dropzone${dragOver ? " tdm-dragover" : ""}`}
        style={{ "--tdm-accent": accent } as React.CSSProperties}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          addFiles(Array.from(e.dataTransfer.files));
        }}
      >
        <DropzoneIcon />
        <p>Drag &amp; drop a screenshot or confirmation here</p>
        <div className="tdm-file-list">
          {filesArray.map((f, i) =>
            TDM_IMAGE_EXT_RE.test(f.name) ? (
              <FileThumb key={i} file={f} onRemove={() => removeFile(i)} thumbUrlsRef={thumbUrlsRef} />
            ) : (
              <span key={i} className="tdm-file-chip">
                {f.name}
                <button type="button" className="tdm-file-chip-remove" onClick={(e) => (e.stopPropagation(), removeFile(i))}>
                  ✕
                </button>
              </span>
            )
          )}
        </div>
        <input ref={fileInputRef} type="file" multiple hidden onChange={(e) => e.target.files && addFiles(Array.from(e.target.files))} />
      </div>

      <div className="tdm-btn-group">
        <button className="tdm-btn tdm-btn-cancel" onClick={onCancel}>
          Cancel
        </button>
        <button className="tdm-btn tdm-btn-done" style={{ background: accent, color: "#000" }} disabled={filesArray.length === 0} onClick={handleDone}>
          {filesArray.length === 0 ? "Mark Done (proof required)" : "Mark Done"}
        </button>
      </div>
    </>
  );
}

function TypeThemeIcon({ type }: { type: TdmItemType }) {
  if (type === "registry_transfer")
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 1l4 4-4 4" />
        <path d="M3 11V9a4 4 0 014-4h14" />
        <path d="M7 23l-4-4 4-4" />
        <path d="M21 13v2a4 4 0 01-4 4H3" />
      </svg>
    );
  if (type === "account_ownership")
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21v-1a7 7 0 0114 0v1" />
        <path d="M17 8l2 2 3-4" />
      </svg>
    );
  if (type === "collaborator_invite")
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 00-3-3.87" />
        <path d="M17 3.13a4 4 0 010 7.75" />
      </svg>
    );
  if (type === "file_upload")
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  );
}

// ---------- small inline icons used inside the panels above (SVG only, no emoji) ----------
function DropzoneIcon() {
  return (
    <svg className="tdm-dropzone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}
function BuildInfoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}
function SecretShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}
function LoginIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
      <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4" />
      <polyline points="10 17 15 12 10 7" />
      <line x1="15" y1="12" x2="3" y2="12" />
    </svg>
  );
}
function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  );
}
function UrlIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
    </svg>
  );
}
function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M22 4L12 13 2 4" />
    </svg>
  );
}
function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0110 0v4" />
    </svg>
  );
}
function GithubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
      <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

function FileThumb({ file, onRemove, thumbUrlsRef }: { file: File; onRemove: () => void; thumbUrlsRef: React.MutableRefObject<string[]> }) {
  const [url] = useState(() => {
    const u = URL.createObjectURL(file);
    thumbUrlsRef.current.push(u);
    return u;
  });
  return (
    <div className="tdm-file-thumb">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={file.name} />
      <button type="button" className="tdm-file-thumb-remove" onClick={(e) => (e.stopPropagation(), onRemove())}>
        ✕
      </button>
      <span>{file.name}</span>
    </div>
  );
}

// ---------- Preview sheet ----------
function PreviewSheet({
  tab,
  customItems,
  completedKeysForTab,
  finalizing,
  onRemove,
  onClose,
  onConfirm,
}: {
  tab: TdmListingType;
  customItems: TdmChecklistItem[];
  completedKeysForTab: (t: TdmListingType) => string[];
  finalizing: boolean;
  onRemove: (key: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const keys = completedKeysForTab(tab);
  const items = { ...TDM_CATEGORIES[tab] };
  const flat = [...items.left, ...items.right, ...customItems];

  return (
    <div className="tdm-preview-overlay active" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="tdm-preview-sheet" data-scroll-lock-exempt>
        <h3>Review completed items</h3>
        {keys.map((key) => {
          const idx = parseInt(key.split("-")[1], 10);
          const item = flat[idx];
          return (
            <div className="tdm-preview-item" key={key}>
              <span>{item.label}</span>
              <button className="tdm-remove-btn" onClick={() => onRemove(key)}>
                ✕
              </button>
            </div>
          );
        })}
        <button className="tdm-confirm-btn" disabled={finalizing} onClick={onConfirm}>
          {finalizing ? "BUNDLING\u2026" : "CONFIRM TRANSFER"}
        </button>
      </div>
    </div>
  );
}

// ---------- GitHub repo card ----------
function GithubCard({
  tdm,
  isSeller,
  alert,
}: {
  tdm: ReturnType<typeof useTransferDeal>;
  isSeller: boolean;
  alert: (opts: { theme?: "success" | "warning" | "danger" | "info" | "report"; title: string; msg: string }) => Promise<void>;
}) {
  const [inviteUsername, setInviteUsername] = useState(tdm.githubCollabUsername);
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<{ text: string; kind: "success" | "error" | "" }>({ text: "", kind: "" });

  useEffect(() => {
    setInviteUsername(tdm.githubCollabUsername);
  }, [tdm.githubCollabUsername]);

  // Still loading
  if (tdm.attachedRepo === undefined) return null;

  // Buyer with no repo yet — nothing to show.
  if (!tdm.attachedRepo && !isSeller) return null;

  if (!tdm.attachedRepo && isSeller) {
    // No repo attached. The original mounted a repo picker here via
    // window.__srfMountRepoPicker, which itself called the (absent in
    // this backend) /api/github to list the seller's repos — see
    // port-status.md. Rather than render a picker with nothing to
    // populate it, this is shown as a clear informational state.
    return (
      <div id="tdmGithubCard" style={{ display: "block" }}>
        <div className="tdm-gh-card">
          <div className="tdm-gh-card-top">
            <GithubMarkIcon />
            <span className="tdm-gh-repo-name" style={{ color: "rgba(255,255,255,0.6)" }}>
              GitHub Repository
            </span>
          </div>
          <div className="tdm-gh-status">No repository attached to this listing yet.</div>
        </div>
      </div>
    );
  }

  const repo = tdm.attachedRepo!;
  const status = tdm.githubStatus;
  const statusLine =
    status === "invited" ? (
      <span className="tdm-gh-status tdm-gh-status-pending">Invite sent to @{tdm.githubCollabUsername} — awaiting acceptance</span>
    ) : status === "added" ? (
      <span className="tdm-gh-status tdm-gh-status-done">@{tdm.githubCollabUsername} has access</span>
    ) : (
      <span className="tdm-gh-status">Not shared with buyer yet</span>
    );

  async function handleInvite() {
    const username = inviteUsername.trim();
    if (!username) {
      setInviteMsg({ text: "Enter the buyer's GitHub username first.", kind: "error" });
      return;
    }
    setInviting(true);
    setInviteMsg({ text: "", kind: "" });
    const result = await tdm.inviteGithubCollaborator(username);
    setInviting(false);
    if (result.ok === true) {
      setInviteMsg({
        text: result.status === "invited" ? "Invite sent! The buyer will see it in their GitHub notifications." : "Buyer added successfully.",
        kind: "success",
      });
    } else if (result.ok === false) {
      setInviteMsg({ text: result.error, kind: "error" });
    }
  }

  return (
    <div id="tdmGithubCard" style={{ display: "block" }}>
      <div className="tdm-gh-card">
        <div className="tdm-gh-card-top">
          <GithubMarkIcon />
          <a href={repo.htmlUrl || "#"} target="_blank" rel="noopener noreferrer" className="tdm-gh-repo-name">
            {repo.fullName}
          </a>
          <span className="tdm-gh-badge">{repo.private ? "Private" : "Public"}</span>
          {isSeller ? (
            <button className="tdm-gh-change-btn" onClick={() => tdm.clearRepoSelection()}>
              Change
            </button>
          ) : null}
        </div>
        <div className="tdm-gh-status-row">{statusLine}</div>
        {isSeller ? (
          <>
            <div className="tdm-gh-invite-row">
              <input
                type="text"
                className="tdm-gh-input"
                placeholder="Buyer's GitHub username"
                value={inviteUsername}
                onChange={(e) => setInviteUsername(e.target.value)}
              />
              <button className="tdm-gh-invite-btn" disabled={inviting} onClick={handleInvite}>
                {inviting ? "Inviting\u2026" : status === "none" ? "Add as Collaborator" : "Re-send Invite"}
              </button>
            </div>
            {inviteMsg.text ? <div className={`tdm-gh-invite-msg${inviteMsg.kind === "success" ? " tdm-gh-msg-success" : inviteMsg.kind === "error" ? " tdm-gh-msg-error" : ""}`}>{inviteMsg.text}</div> : null}
          </>
        ) : status === "invited" ? (
          <div className="tdm-gh-invite-msg">Check your GitHub notifications (or email) for the invite to accept.</div>
        ) : null}
      </div>
    </div>
  );
}

function GithubMarkIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
      <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
    </svg>
  );
}
