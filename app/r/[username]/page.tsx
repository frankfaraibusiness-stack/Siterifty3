import type { Metadata } from "next";
import Link from "next/link";
import { getPublicBaseUrl } from "@/lib/server/adminDb";
import { getReferrer } from "./getReferrer";

// Was previously an instant server-side redirect() straight to
// /?r=username — see the old comment history for why that page existed
// at all (ReferralsPanel hands out /r/{username} links; nothing served
// that path before). This is now a real landing page: it looks the
// referrer up, shows who invited the visitor, and only THEN sends them
// on to the homepage with ?r=username&auth=signup once they tap the CTA
// — same destination format authActions.ts's getReferralCode() already
// reads (?r= as a query param), just reached a click later instead of
// instantly. The homepage's AutoOpenAuth effect reads the new
// ?auth=signup flag to pop the auth modal straight to its signup tab.
//
// The 7-day figure below matches a real backend rule now, not just
// copy: account.js's actionEnsureAccount stamps referredAt at the
// referred user's OWN signup moment, and paypal.js's handleActivateSub
// only pays the referrer's 30% bonus if that user activates a paid plan
// within REFERRAL_WINDOW_MS (7 days) of that stamp. This page can't
// know the visitor's future signup timestamp, so it always shows the
// full 7-day window rather than a live countdown — the real clock only
// starts once they actually create an account.
const USERNAME_RE = /^[a-zA-Z0-9_.-]{1,20}$/;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const url = `${getPublicBaseUrl()}/r/${encodeURIComponent(username)}`;
  const safe = USERNAME_RE.test(username) ? username.toLowerCase() : null;
  const referrer = safe ? await getReferrer(safe) : null;

  return {
    title: referrer ? `${referrer.username} invited you to Siterifty` : "You're invited to Siterifty",
    description: "Join Siterifty — the marketplace for indie developers to buy and sell websites, apps, and games.",
    alternates: { canonical: url },
    robots: { index: false, follow: false },
  };
}

function initial(username: string): string {
  return username.charAt(0).toUpperCase();
}

export default async function ReferralLandingPage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const safe = USERNAME_RE.test(username) ? username.toLowerCase() : null;
  const referrer = safe ? await getReferrer(safe) : null;
  const signupHref = referrer ? `/?r=${encodeURIComponent(referrer.username)}&auth=signup` : "/?auth=signup";

  return (
    <div className="rfp-page">
      <div className="rfp-glow" aria-hidden="true" />

      {referrer ? (
        <div className="rfp-card">
          <div className="rfp-ring" style={{ ["--rfp-pct" as string]: 100 }}>
            <div className="rfp-avatar">
              {referrer.profilePic ? (
                <img src={referrer.profilePic} alt="" />
              ) : (
                initial(referrer.username)
              )}
            </div>
          </div>

          <div className="rfp-eyebrow">You&apos;re invited</div>
          <h1 className="rfp-title">
            <strong>@{referrer.username}</strong> invited you to Siterifty
          </h1>
          <p className="rfp-sub">
            Buy and sell websites, apps, and games built by indie developers. Sign up now and
            @{referrer.username} earns 30% if you upgrade within 7 days.
          </p>

          <div className="rfp-countdown">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3.5 2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            7 days to upgrade after you join
          </div>

          <Link href={signupHref} className="rfp-cta">
            Sign up now
          </Link>

          <div className="rfp-fineprint">
            Already have an account? <Link href="/?auth=login">Log in</Link>
          </div>
        </div>
      ) : (
        <div className="rfp-card">
          <svg
            width="88"
            height="88"
            viewBox="0 0 200 200"
            fill="none"
            aria-hidden="true"
            style={{ marginBottom: 8 }}
          >
            {/* Same "sad character" illustration as app/not-found.tsx, reused
                here so an invalid /r/ link reads as the site's actual 404
                state rather than a generic empty-avatar placeholder. */}
            <path
              d="M62 150c-2-28 6-52 30-58 26-6 46 14 48 40 1 10-2 18-9 18H70c-5 0-7-.2-8 0Z"
              fill="#111116"
              stroke="rgba(255,255,255,0.1)"
              strokeWidth="1.5"
            />
            <path d="M78 118c-8 6-12 16-10 30" stroke="rgba(255,255,255,0.18)" strokeWidth="6" strokeLinecap="round" fill="none" />
            <path d="M126 118c8 6 12 16 10 30" stroke="rgba(255,255,255,0.18)" strokeWidth="6" strokeLinecap="round" fill="none" />
            <circle cx="101" cy="96" r="26" fill="#16161c" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" />
            <path d="M89 98c2-3 6-3 8 0" stroke="rgba(255,255,255,0.55)" strokeWidth="2.4" strokeLinecap="round" fill="none" />
            <path d="M105 98c2-3 6-3 8 0" stroke="rgba(255,255,255,0.55)" strokeWidth="2.4" strokeLinecap="round" fill="none" />
            <path d="M93 110c4-3 10-3 14 0" stroke="rgba(255,255,255,0.4)" strokeWidth="2" strokeLinecap="round" fill="none" />
            <path d="M101 70c0-6 2-10 0-14" stroke="rgba(255,255,255,0.25)" strokeWidth="2.4" strokeLinecap="round" />
            <circle cx="101" cy="54" r="3.4" fill="#a3e635" opacity="0.85" />
          </svg>

          <div className="rfp-eyebrow">404 · Invite not found</div>
          <h1 className="rfp-title">This invite link isn&apos;t valid</h1>
          <p className="rfp-sub">
            The referral link you followed doesn&apos;t match an active Siterifty account. You can
            still join — you just won&apos;t be credited to a referrer.
          </p>

          <Link href="/?auth=signup" className="rfp-cta">
            Sign up now
          </Link>

          <div className="rfp-fineprint">
            <Link href="/">Back to Siterifty</Link>
          </div>
        </div>
      )}
    </div>
  );
}
