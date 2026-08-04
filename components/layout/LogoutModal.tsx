"use client";

// Ports the #logoutModalOverlay markup 1:1 from index.html. Styling lives
// in app/globals.css under "LOGOUT CONFIRMATION MODAL" (also ported 1:1
// from styles/siterifty.css). Original show/hide logic (toggling the
// `.visible` class, wiring confirm/cancel) lived in Js/logout-share.js —
// here that's just `open` controlling the class, same as ThemeModal.

interface LogoutModalProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function LogoutModal({ open, onConfirm, onCancel }: LogoutModalProps) {
  return (
    <div
      id="logoutModalOverlay"
      className={open ? "visible" : ""}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div id="logoutModalBox">
        <div id="logoutModalIconWrap">
          <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </div>
        <div id="logoutModalTitle">Sign out?</div>
        <div id="logoutModalMsg">
          You&apos;ll need to sign back in to access your <b>chats, deals, and listings</b>.
        </div>
        <div className="logout-modal-actions">
          <button className="logout-modal-btn confirm" id="logoutModalConfirmBtn" onClick={onConfirm}>
            <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Sign Out
          </button>
          <button className="logout-modal-btn cancel" id="logoutModalCancelBtn" onClick={onCancel}>
            Stay signed in
          </button>
        </div>
      </div>
    </div>
  );
}
