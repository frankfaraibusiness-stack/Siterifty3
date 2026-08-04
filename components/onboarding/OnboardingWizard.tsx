"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { useScrollLock } from "@/lib/useScrollLock";

// Replaces the old TourModal at the same signup call site (see
// AuthModalProvider). Same open/username/onFinish contract, plus the
// avatar/bio/role writes this version needs that the old tour didn't.
//
// Ported from the user-provided static HTML/CSS/JS design 1:1 — same 6
// steps, same copy, same falling-dots finish animation — rebuilt as a
// controlled React component instead of direct DOM manipulation, and wired
// into real app state instead of the original's placeholders:
//   - role (step 2)     -> saved on users/{uid}.role
//   - username/bio/avatar (step 3) -> users/{uid} directly (bypassing the
//     avatar cooldown in useProfileData's uploadAvatar, since this is the
//     user's first-ever avatar, not a change)
//   - plans (step 5)    -> purely informational, no action (per product
//     decision — nothing charged/selected here)
//   - explore buttons (step 6) -> router.push to real routes instead of
//     the original's window.__open* placeholder globals
//   - header (logo + Logout) removed entirely — onboarding no longer
//     shows a page chrome/logout option, it's just the step flow itself

type Role = "buyer" | "seller" | "browsing";

export interface OnboardingWizardProps {
  open: boolean;
  username: string;
  onFinish: () => void;
}

export default function OnboardingWizard({ open, username, onFinish }: OnboardingWizardProps) {
  const router = useRouter();

  const [step, setStep] = useState(1);
  const totalSteps = 6;

  const [role, setRole] = useState<Role | null>(null);
  const [profileUsername, setProfileUsername] = useState(username || "Builder");
  const [bio, setBio] = useState("");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset every time the wizard (re)opens, same as the intro/wizard
  // toggling in the original's IIFE.
  useEffect(() => {
    if (open) {
      setStep(1);
      setRole(null);
      setProfileUsername(username || "Builder");
      setBio("");
      setAvatarPreview(null);
      setAvatarFile(null);
      setError(null);
    }
  }, [open, username]);

  // Locks both wheel/keyboard scroll (body overflow) and iOS touch/
  // rubber-band scroll on the page behind the wizard for as long as it's
  // open. .ob-content-wrapper below is marked data-scroll-lock-exempt so
  // step content taller than the viewport can still scroll internally.
  useScrollLock(open);

  if (!open) return null;

  function handleAvatarPick() {
    fileInputRef.current?.click();
  }

  function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  }

  // Persists role + profile (username/bio/avatar) once, when leaving step
  // 3 into step 4 — not per-keystroke. Avatar upload goes straight to
  // Imgur + Firestore here (skipping useProfileData's cooldown check,
  // since a first-time upload on a brand-new account isn't a "change").
  async function persistProfileStep() {
    const user = auth.currentUser;
    if (!user) return;
    setSaving(true);
    setError(null);
    try {
      let profilePicUrl: string | undefined;
      if (avatarFile) {
        const fd = new FormData();
        fd.append("image", avatarFile);
        const res = await fetch("https://api.imgur.com/3/image", {
          method: "POST",
          headers: { Authorization: "Client-ID 891e5bb4aa94282" },
          body: fd,
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.data?.error || "Avatar upload failed.");
        profilePicUrl = json.data.link as string;
      }

      const cleanUsername = profileUsername.trim();
      const updates: Record<string, unknown> = {
        bio,
        role,
        updatedAt: serverTimestamp(),
      };
      if (cleanUsername) {
        updates.username = cleanUsername;
        updates.displayName = cleanUsername;
        updates.usernameLower = cleanUsername.toLowerCase().replace(/\s+/g, "_");
      }
      if (profilePicUrl) {
        updates.profilePic = profilePicUrl;
        updates.profilePicChangedAt = serverTimestamp();
      }

      await updateDoc(doc(db, "users", user.uid), updates);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save your profile. You can update it later in Settings.");
      // Non-blocking — original design has no per-step validation gate here
      // beyond role selection, so a save hiccup shouldn't trap the user.
    } finally {
      setSaving(false);
    }
  }

  async function handleNext() {
    if (step === 2 && !role) return;
    if (step === 3) {
      await persistProfileStep();
    }
    if (step < totalSteps) {
      setStep((s) => s + 1);
    } else {
      onFinish();
    }
  }

  const isLast = step === totalSteps;
  const nextDisabled = (step === 2 && !role) || saving;

  return (
    <div className="ob-wizard">
      <div className="ob-container">
            <div className="ob-progress-header">
              <div className="ob-progress-track">
                <div className="ob-progress-fill" style={{ width: `${(step / totalSteps) * 100}%` }} />
              </div>
              <div className="ob-step-counter">
                Step <span>{step}</span> of {totalSteps}
              </div>
            </div>

            <div className="ob-content-wrapper" data-scroll-lock-exempt>
              {step === 1 && (
                <div className="ob-step active">
                  <div className="ob-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="#a3e635" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2l1.5 5.5L19 9l-5.5 1.5L12 16l-1.5-5.5L5 9l5.5-1.5z" />
                      <path d="M21 4l-1 1" />
                      <path d="M3 4l1 1" />
                      <path d="M21 20l-1-1" />
                      <path d="M3 20l1-1" />
                    </svg>
                  </div>
                  <h1 className="ob-title">
                    Welcome to <span>siterifty</span>
                  </h1>
                  <p className="ob-subtitle">
                    The indie marketplace for buying and selling websites, apps, and games — with secure escrow protection on every deal.
                  </p>
                  <ul className="ob-features">
                    <li>
                      <span className="ob-check">✓</span> List your digital products in minutes
                    </li>
                    <li>
                      <span className="ob-check">✓</span> Escrow holds funds until delivery
                    </li>
                    <li>
                      <span className="ob-check">✓</span> Connect with real buyers &amp; sellers
                    </li>
                  </ul>
                </div>
              )}

              {step === 2 && (
                <div className="ob-step active">
                  <div className="ob-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="#a3e635" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                  </div>
                  <h1 className="ob-title">What brings you here?</h1>
                  <p className="ob-subtitle">Choose your role so we can tailor your experience.</p>
                  <div className="ob-role-grid">
                    <button
                      className={`ob-role-btn${role === "buyer" ? " selected" : ""}`}
                      onClick={() => setRole("buyer")}
                    >
                      <span className="ob-role-icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
                          <path d="M3 6h18" />
                          <path d="M16 10a4 4 0 0 1-8 0" />
                        </svg>
                      </span>
                      <span className="ob-role-label">I&apos;m a Buyer</span>
                      <span className="ob-role-desc">Looking to purchase sites &amp; apps</span>
                    </button>
                    <button
                      className={`ob-role-btn${role === "seller" ? " selected" : ""}`}
                      onClick={() => setRole("seller")}
                    >
                      <span className="ob-role-icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                          <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                        </svg>
                      </span>
                      <span className="ob-role-label">I&apos;m a Seller</span>
                      <span className="ob-role-desc">Here to list my digital products</span>
                    </button>
                    <button
                      className={`ob-role-btn${role === "browsing" ? " selected" : ""}`}
                      onClick={() => setRole("browsing")}
                    >
                      <span className="ob-role-icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" />
                          <path d="M2 12h20" />
                          <path d="M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10z" />
                        </svg>
                      </span>
                      <span className="ob-role-label">Just Browsing</span>
                      <span className="ob-role-desc">Exploring for both buying &amp; selling</span>
                    </button>
                  </div>
                  <div className="ob-hint">Select one to continue (you can change later).</div>
                </div>
              )}

              {step === 3 && (
                <div className="ob-step active">
                  <div className="ob-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="#a3e635" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  </div>
                  <h1 className="ob-title">Make it yours</h1>
                  <p className="ob-subtitle">Set up your profile so buyers and sellers can recognize you.</p>
                  <div className="ob-form-group">
                    <div className="ob-avatar-upload" onClick={handleAvatarPick}>
                      {avatarPreview ? (
                        <img
                          src={avatarPreview}
                          alt="Avatar preview"
                          style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }}
                        />
                      ) : (
                        <>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                            <circle cx="12" cy="7" r="4" />
                          </svg>
                          <span>Tap to upload</span>
                        </>
                      )}
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={handleAvatarChange}
                    />
                    <input
                      type="text"
                      className="ob-input"
                      placeholder="Your username (e.g. dev_john)"
                      value={profileUsername}
                      onChange={(e) => setProfileUsername(e.target.value)}
                    />
                    <textarea
                      className="ob-input ob-textarea"
                      placeholder="Short bio (e.g. Full-stack dev building SaaS tools)"
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                    />
                    {error && (
                      <div style={{ color: "#fca5a5", fontSize: 12, textAlign: "center" }}>{error}</div>
                    )}
                  </div>
                </div>
              )}

              {step === 4 && (
                <div className="ob-step active">
                  <div className="ob-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="#a3e635" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2 3 6v6c0 5 3.5 9 9 10 5.5-1 9-5 9-10V6z" />
                      <path d="M9 12l2 2 4-4" />
                    </svg>
                  </div>
                  <h1 className="ob-title">
                    Secure <span>Escrow</span> Protection
                  </h1>
                  <p className="ob-subtitle">
                    Your money is held safely until you confirm the asset was delivered as described.
                  </p>
                  <div className="ob-escrow-steps">
                    <div className="ob-escrow-item">
                      <span className="ob-escrow-num">1</span>
                      <div className="ob-escrow-text">
                        <strong>Buyer pays</strong> — funds go into escrow, not to the seller
                      </div>
                    </div>
                    <div className="ob-escrow-item">
                      <span className="ob-escrow-num">2</span>
                      <div className="ob-escrow-text">
                        <strong>Seller delivers</strong> — asset is transferred to the buyer
                      </div>
                    </div>
                    <div className="ob-escrow-item">
                      <span className="ob-escrow-num">3</span>
                      <div className="ob-escrow-text">
                        <strong>Buyer confirms</strong> — funds are released to the seller
                      </div>
                    </div>
                  </div>
                  <div className="ob-hint">No payment is ever sent directly — you&apos;re protected on both sides.</div>
                </div>
              )}

              {step === 5 && (
                <div className="ob-step active">
                  <div className="ob-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="#a3e635" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="6" width="20" height="14" rx="2.5" />
                      <path d="M2 10h20" />
                      <path d="M17 15h.01" />
                    </svg>
                  </div>
                  <h1 className="ob-title">
                    Plans &amp; <span>Fees</span>
                  </h1>
                  <p className="ob-subtitle">
                    Choose a plan that fits your selling volume. Higher plans mean lower fees and more listings.
                  </p>
                  <div className="ob-plans-grid">
                    <div className="ob-plan-card" style={{ ["--plan-color" as string]: "#71717a" }}>
                      <div className="ob-plan-name">Free</div>
                      <div className="ob-plan-fee">30% fee</div>
                      <div className="ob-plan-limit">5 listings per week</div>
                    </div>
                    <div className="ob-plan-card" style={{ ["--plan-color" as string]: "#60a5fa" }}>
                      <div className="ob-plan-name">Starter</div>
                      <div className="ob-plan-fee">24% fee</div>
                      <div className="ob-plan-limit">15 listings per week</div>
                    </div>
                    <div className="ob-plan-card" style={{ ["--plan-color" as string]: "#a3e635" }}>
                      <div className="ob-plan-name">Growth</div>
                      <div className="ob-plan-fee">18% fee</div>
                      <div className="ob-plan-limit">30 listings per week</div>
                    </div>
                    <div className="ob-plan-card" style={{ ["--plan-color" as string]: "#d8b4fe" }}>
                      <div className="ob-plan-name">Pro</div>
                      <div className="ob-plan-fee">12% fee</div>
                      <div className="ob-plan-limit">Unlimited</div>
                    </div>
                  </div>
                  <div className="ob-hint">Upgrade anytime from Settings. No lock-in.</div>
                </div>
              )}

              {step === 6 && (
                <div className="ob-step active">
                  <div className="ob-final-dots">
                    {[5, 12, 20, 28, 36, 44, 52, 60, 68, 76, 84, 92, 98].map((x, i) => (
                      <span
                        key={x}
                        className="green-dot"
                        style={{ ["--delay" as string]: `${(i % 5) * 0.3}s`, ["--x" as string]: `${x}%` }}
                      />
                    ))}
                  </div>
                  <div className="ob-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="#a3e635" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M2 12h20" />
                      <path d="M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10z" />
                    </svg>
                  </div>
                  <h1 className="ob-title">
                    You&apos;re all set, <span>{profileUsername || "Developer"}</span>!
                  </h1>
                  <p className="ob-subtitle">Here&apos;s what you can do next — take your pick.</p>
                  <div className="ob-explore-grid">
                    <button className="ob-explore-btn" onClick={() => router.push("/marketplace")}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
                        <path d="M3 6h18" />
                        <path d="M16 10a4 4 0 0 1-8 0" />
                      </svg>
                      Browse Marketplace
                    </button>
                    <button className="ob-explore-btn" onClick={() => router.push("/leaderboard")}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M6 9H4.5A2.5 2.5 0 0 1 2 6.5v-2A2.5 2.5 0 0 1 4.5 2h1" />
                        <path d="M18 9h1.5A2.5 2.5 0 0 0 22 6.5v-2A2.5 2.5 0 0 0 19.5 2h-1" />
                        <path d="M12 22V8" />
                        <path d="M8 22h8" />
                        <path d="M6 9a4 4 0 0 0 4 4h4a4 4 0 0 0 4-4" />
                      </svg>
                      View Leaderboard
                    </button>
                    <button className="ob-explore-btn ob-explore-primary" onClick={() => router.push("/sell")}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                      Start Selling
                    </button>
                  </div>
                  <div className="ob-hint">You can always come back to these from the main navigation.</div>
                </div>
              )}
            </div>

            <div className="ob-footer">
              <button className="ob-next" onClick={handleNext} disabled={nextDisabled}>
                <span>{saving ? "Saving…" : isLast ? "Finish & Explore" : "Continue"}</span>
                <svg className="ob-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M13 5l7 7-7 7" />
                </svg>
              </button>
            </div>
      </div>
    </div>
  );
}
