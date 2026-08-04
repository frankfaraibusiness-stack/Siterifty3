"use client";

import { useEffect, useState } from "react";
import {
  loginWithEmail,
  signupWithEmail,
  loginWithGoogle,
  loginWithGithub,
  sendForgotPasswordEmail,
  friendlyAuthError,
} from "@/lib/authActions";
import { useScrollLock } from "@/lib/useScrollLock";

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  /** Fired once a signup (email, or a brand-new Google/GitHub account)
   *  finishes, so the parent can show the post-signup tour — ports
   *  window.__startTour(username, profilePic), called unconditionally
   *  after email signup and only when isNew is true after OAuth, exactly
   *  like the original's setTimeout(() => window.__startTour(...), 300). */
  onSignupComplete?: (username: string, profilePic: string) => void;
  /** Which tab to land on when the modal opens (default "login", same as
   *  before). Lets callers like the /r/[username] referral page and the
   *  homepage's ?auth=signup handoff open straight into the signup form
   *  instead of making a referred visitor click the tab themselves. */
  initialTab?: Tab;
}

type Tab = "login" | "signup";


// Redesign notes (see the .am-* CSS block in globals.css for the full
// rationale): this used to be ~400 lines of inline styles with one-off
// grays that never touched the site's actual design tokens. All visual
// styling now lives in CSS classes built from --mp-* tokens, so this
// modal actually looks like it belongs to the same product as the rest
// of the site. No behavior, prop, or handler changed — every function
// below is byte-for-byte the same logic as before, only the JSX markup
// and styling approach changed.
export default function AuthModal({ open, onClose, onSignupComplete, initialTab }: AuthModalProps) {
  const [tab, setTab] = useState<Tab>(initialTab || "login");
  const [oauthError, setOauthError] = useState("");

  // Re-sync the tab whenever the modal transitions to open (not just on
  // mount) — AuthModal is mounted once by AuthModalProvider and toggled
  // via `open`, so without this a visitor who opens the modal in "login"
  // mode, closes it, then triggers a "signup" open (e.g. from the /r/
  // referral flow) would still see whatever tab they left it on.
  useEffect(() => {
    if (open) setTab(initialTab || "login");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  const [signupUsername, setSignupUsername] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupError, setSignupError] = useState("");
  const [signupLoading, setSignupLoading] = useState(false);

  // Locks wheel/keyboard scroll on the page behind the modal for as
  // long as it's open.
  useScrollLock(open);

  // `overflow:hidden` on body doesn't stop iOS Safari from rubber-band
  // scrolling the page behind a fixed-position modal via touch drag.
  // Block touchmove at the document level while open — but only for
  // touches that start outside the modal's own scrollable content
  // area (data-sr-modal-scroll), so the form itself can still be
  // scrolled normally on a small screen.
  useEffect(() => {
    if (!open) return;
    const blockTouch = (e: TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest("[data-sr-modal-scroll]")) return;
      e.preventDefault();
    };
    document.addEventListener("touchmove", blockTouch, { passive: false });
    return () => document.removeEventListener("touchmove", blockTouch);
  }, [open]);

  if (!open) return null;

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError("");
    setLoginLoading(true);
    try {
      await loginWithEmail(loginEmail, loginPassword);
      onClose();
    } catch (err: any) {
      setLoginError(friendlyAuthError(err?.code));
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleForgotPassword() {
    setLoginError("");
    try {
      await sendForgotPasswordEmail(loginEmail);
      setLoginError("✓ Reset email sent — check your inbox.");
    } catch (err: any) {
      setLoginError(err?.code ? friendlyAuthError(err.code) : err.message);
    }
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setSignupError("");

    setSignupLoading(true);
    try {
      const { username, profilePic } = await signupWithEmail(
        signupUsername,
        signupEmail,
        signupPassword,
        ""
      );
      onClose();
      // Reset form
      setSignupUsername("");
      setSignupEmail("");
      setSignupPassword("");
      // Tour fires unconditionally after email signup, same as the
      // original's setTimeout(() => window.__startTour(username,
      // profilePic), 300) right after the signup success path.
      onSignupComplete?.(username, profilePic);
    } catch (err: any) {
      setSignupError(err?.code ? friendlyAuthError(err.code) : err.message);
    } finally {
      setSignupLoading(false);
    }
  }

  async function handleGoogle() {
    setOauthError("");
    try {
      const { isNew, username, profilePic } = await loginWithGoogle();
      onClose();
      // Original only fires the tour for a brand-new account
      // (if (isNew) { await _finishOauthSignup(cred.user); }) — an
      // existing user logging back in via Google never sees it again.
      if (isNew) onSignupComplete?.(username, profilePic);
    } catch (err: any) {
      setOauthError(friendlyAuthError(err?.code));
    }
  }

  async function handleGithub() {
    setOauthError("");
    try {
      const { isNew, username, profilePic } = await loginWithGithub();
      onClose();
      if (isNew) onSignupComplete?.(username, profilePic);
    } catch (err: any) {
      setOauthError(friendlyAuthError(err?.code));
    }
  }

  return (
    <div
      className="am-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="am-card" role="dialog" aria-modal="true" aria-label={tab === "login" ? "Log in" : "Sign up"}>
        <div className="am-head">
          <div className="am-brand">
            <img
              src="/images/siterifty-logo.png"
              alt="Siterifty.com"
              className="am-brand-logo"
            />
          </div>
          <button onClick={onClose} className="am-close-btn" aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div data-scroll-lock-exempt className="am-body">
          {oauthError && <div className="am-banner am-banner-error">{oauthError}</div>}

          {/* Tab switch — one sliding indicator behind whichever tab is
              active, instead of each button independently repainting its
              own background. */}
          <div className="am-tabs" role="tablist">
            <div className={`am-tabs-indicator${tab === "signup" ? " is-signup" : ""}`} aria-hidden="true" />
            <button
              type="button"
              role="tab"
              aria-selected={tab === "login"}
              className={`am-tab-btn${tab === "login" ? " active" : ""}`}
              onClick={() => setTab("login")}
            >
              Log In
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "signup"}
              className={`am-tab-btn${tab === "signup" ? " active" : ""}`}
              onClick={() => setTab("signup")}
            >
              Sign Up
            </button>
          </div>

          <div className="am-oauth-row">
            <button onClick={handleGoogle} className="am-oauth-btn" type="button">
              <svg viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
              </svg>
              Google
            </button>
            <button onClick={handleGithub} className="am-oauth-btn" type="button">
              <svg viewBox="0 0 24 24" fill="#ffffff">
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                />
              </svg>
              GitHub
            </button>
          </div>

          <div className="am-divider">OR CONTINUE WITH EMAIL</div>

          {tab === "login" ? (
            <form onSubmit={handleLogin} className="am-form">
              {loginError && (
                <div className={`am-banner ${loginError.startsWith("✓") ? "am-banner-success" : "am-banner-error"}`}>
                  {loginError}
                </div>
              )}
              <AmField label="Email Address" icon={EmailIcon}>
                <input
                  type="email"
                  placeholder="you@domain.com"
                  required
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  className="am-input"
                />
              </AmField>
              <AmField label="Password" icon={PasswordIcon}>
                <input
                  type="password"
                  placeholder="••••••••"
                  required
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  className="am-input"
                />
              </AmField>
              <div className="am-forgot-row">
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    handleForgotPassword();
                  }}
                  className="am-forgot-link"
                >
                  Forgot password?
                </a>
              </div>
              <button type="submit" disabled={loginLoading} className="am-submit-btn">
                {loginLoading ? "Please wait…" : "Log In"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleSignup} className="am-form">
              {signupError && <div className="am-banner am-banner-error">{signupError}</div>}
              <AmField label="Username" icon={UsernameIcon}>
                <input
                  type="text"
                  placeholder="player_one"
                  required
                  value={signupUsername}
                  onChange={(e) => setSignupUsername(e.target.value)}
                  className="am-input"
                />
              </AmField>
              <AmField label="Email Address" icon={EmailIcon}>
                <input
                  type="email"
                  placeholder="you@domain.com"
                  required
                  value={signupEmail}
                  onChange={(e) => setSignupEmail(e.target.value)}
                  className="am-input"
                />
              </AmField>
              <AmField label="Password" icon={PasswordIcon}>
                <input
                  type="password"
                  placeholder="Create secure password"
                  required
                  value={signupPassword}
                  onChange={(e) => setSignupPassword(e.target.value)}
                  className="am-input"
                />
              </AmField>
              <button type="submit" disabled={signupLoading} className="am-submit-btn">
                {signupLoading ? "Please wait…" : "Create Account"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function AmField({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="am-field">
      <label className="am-field-label">{label}</label>
      <div className="am-field-wrap">
        {icon && (
          <span className="am-field-icon" aria-hidden="true">
            {icon}
          </span>
        )}
        {children}
      </div>
    </div>
  );
}

const EmailIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75"
    />
  </svg>
);

const PasswordIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
    />
  </svg>
);

const UsernameIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z"
    />
  </svg>
);
