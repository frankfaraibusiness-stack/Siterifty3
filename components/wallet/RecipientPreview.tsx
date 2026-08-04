"use client";

import type { WalletRecipient } from "@/lib/useRecipientLookup";

// Ports the wrp-avatar / wrp-mid / wrp-badge markup built inline by
// _walletLookupRecipient / _asendLookupRecipient in wallet.js. Uses the
// real .wallet-recipient-preview / .wrp-* classes from globals.css
// instead of duplicating their look with inline styles.
export default function RecipientPreview({
  status,
  recipient,
  errorMsg,
}: {
  status: "idle" | "loading" | "ok" | "err";
  recipient: WalletRecipient | null;
  errorMsg: string;
}) {
  if (status === "idle") return null;

  const isErr = status === "err";
  const isLoading = status === "loading";
  const name = recipient ? recipient.displayName || recipient.username || recipient.email : "";
  const initials = (name || "?").slice(0, 2).toUpperCase();

  return (
    <div className={`wallet-recipient-preview${isErr ? " err" : ""}`}>
      <div className="wrp-avatar">
        {isLoading ? (
          "…"
        ) : isErr ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        ) : recipient?.profilePic ? (
          <img
            src={recipient.profilePic}
            alt=""
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          initials
        )}
      </div>
      <div className="wrp-mid">
        <div className="wrp-name">{isLoading ? "Looking up recipient…" : isErr ? errorMsg : name}</div>
        {!isLoading && !isErr && recipient ? <div className="wrp-email">{recipient.email}</div> : null}
      </div>
      {!isLoading && !isErr && recipient ? (
        <div className="wrp-badge">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Available
        </div>
      ) : null}
    </div>
  );
}
