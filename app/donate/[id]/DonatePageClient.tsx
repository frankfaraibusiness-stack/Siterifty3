"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { useAuthModal } from "@/components/auth/AuthModalProvider";
import { useCurrency } from "@/lib/CurrencyContext";
import { fetchFullSeller, type FullSeller } from "@/lib/useSeller";
import { SellerNotFoundScreen } from "@/components/seller/SellerStateScreen";

// Full-page version of the old DonateOverlay (seller/DonateOverlay.tsx)
// — previously a centered popup opened from a seller's profile. Same
// donate logic/limits/fee math, moved to its own /donate/[id] route and
// restyled full-screen (seller header banner, bigger stat cards, longer
// recent-donations feed, a short "how it works" trust section) for a
// more premium/dedicated feel instead of a boxed overlay.
const DONATION_FEE_RATE_CLIENT = 0.3;

interface DonationRow {
  donorName?: string;
  donorPic?: string;
  amount?: number;
  note?: string;
  createdAt?: string | number;
}

interface DonationsSummary {
  totalDonated?: number;
  donationCount?: number;
  recent?: DonationRow[];
}

const donateCache = new Map<string, DonationsSummary>();

// Matches the real .dnp-page layout (hero avatar/title, 2-stat row,
// form+side-panel grid) using the shared .skel-block/.skel-text shimmer
// utilities from skeletons.css — same pattern as SellerProfileSkeleton
// and CheckoutRouteSkeleton. Exported so app/donate/[id]/loading.tsx can
// render it during server-side navigation, instead of falling back to
// the generic marketplace-grid-shaped app/loading.tsx, which doesn't
// match this page's layout at all.
export function DonatePageSkeleton() {
  return (
    <div className="dnp-page">
      <div className="dnp-hero">
        <div className="skel-block" style={{ width: 76, height: 76, borderRadius: "50%", margin: "0 auto 1rem" }} />
        <div className="skel-block" style={{ width: 34, height: 34, borderRadius: 10, margin: "-1.6rem auto 0.9rem" }} />
        <div className="skel-block skel-text lg" style={{ width: 220, height: 24, margin: "0 auto 0.6rem" }} />
        <div className="skel-block skel-text" style={{ width: 260, margin: "0 auto" }} />
      </div>

      <div className="dnp-stats-row">
        <div className="dnp-stat-card">
          <div className="skel-block skel-text lg" style={{ width: 70, height: 24, margin: "0 auto 8px" }} />
          <div className="skel-block skel-text" style={{ width: 80, height: 10, margin: "0 auto" }} />
        </div>
        <div className="dnp-stat-card">
          <div className="skel-block skel-text lg" style={{ width: 40, height: 24, margin: "0 auto 8px" }} />
          <div className="skel-block skel-text" style={{ width: 70, height: 10, margin: "0 auto" }} />
        </div>
      </div>

      <div className="dnp-main-grid">
        <div className="dnp-form-panel">
          <div className="skel-block skel-text" style={{ width: "50%", marginBottom: 10 }} />
          <div className="skel-block" style={{ width: "100%", height: 46, borderRadius: 12, marginBottom: 14 }} />
          <div className="skel-block skel-text" style={{ width: "40%", marginBottom: 10 }} />
          <div className="skel-block" style={{ width: "100%", height: 42, borderRadius: 12, marginBottom: 18 }} />
          <div className="skel-block" style={{ width: "100%", height: 46, borderRadius: 50 }} />
        </div>
        <div className="dnp-side-panel">
          <div className="skel-block skel-text" style={{ width: "70%", marginBottom: 14 }} />
          <div className="skel-block skel-text" style={{ width: "100%", marginBottom: 8 }} />
          <div className="skel-block skel-text" style={{ width: "100%", marginBottom: 8 }} />
          <div className="skel-block skel-text" style={{ width: "80%" }} />
        </div>
      </div>
    </div>
  );
}

function DonationRowView({ don }: { don: DonationRow }) {
  const { formatBalance } = useCurrency();
  const name = don.donorName || "Anonymous";
  const initial = name.charAt(0).toUpperCase();
  const amt = formatBalance(Number(don.amount || 0));
  const when = don.createdAt
    ? new Date(don.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "";
  return (
    <div className="dnp-row">
      <div className="dnp-av">
        {don.donorPic ? (
          <img
            src={don.donorPic}
            alt={name}
            onError={(e) => {
              (e.currentTarget.parentElement as HTMLElement).textContent = initial;
            }}
          />
        ) : (
          initial
        )}
      </div>
      <div className="dnp-mid">
        <div className="dnp-name">{name}</div>
        {don.note ? <div className="dnp-note">&quot;{don.note}&quot;</div> : null}
        <div className="dnp-when">{when}</div>
      </div>
      <div className="dnp-amt">{amt}</div>
    </div>
  );
}

export default function DonatePageClient({ sellerUid }: { sellerUid: string }) {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { openAuthModal } = useAuthModal();
  const { currency, formatBalance } = useCurrency();

  const [seller, setSeller] = useState<FullSeller | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [summary, setSummary] = useState<DonationsSummary | null>(donateCache.get(sellerUid) || null);
  const [loadingSummary, setLoadingSummary] = useState(!donateCache.has(sellerUid));
  const [amt, setAmt] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user === null) {
      openAuthModal();
      router.replace("/marketplace");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const full = await fetchFullSeller(sellerUid);
      if (cancelled) return;
      if (!full) {
        setNotFound(true);
      } else {
        setSeller(full);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sellerUid]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch("/api/paypal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "get-donations", sellerUid }),
        });
        const out = await resp.json();
        if (!resp.ok || !out.ok) throw new Error(out.error || "Could not load donations");
        donateCache.set(sellerUid, out);
        if (!cancelled) {
          setSummary(out);
          setLoadingSummary(false);
        }
      } catch (err) {
        console.error("[DonatePage] load donations failed", err);
        if (!cancelled && !donateCache.has(sellerUid)) setLoadingSummary(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sellerUid]);

  const amtNum = parseFloat(amt);
  const showFee = amtNum > 0;
  const fee = showFee ? amtNum * DONATION_FEE_RATE_CLIENT : 0;
  const receive = showFee ? amtNum - fee : 0;

  async function handleSubmit() {
    setMsg(null);
    if (!user) {
      openAuthModal();
      return;
    }
    if (!amtNum || amtNum < 1 || amtNum > 2500) {
      setMsg({ text: "Enter an amount between $1 and $2,500 USD.", ok: false });
      return;
    }
    const bal = Number(profile?.walletBalance || 0);
    if (amtNum > bal) {
      setMsg({ text: `Insufficient balance — you have ${formatBalance(bal)}.`, ok: false });
      return;
    }
    setSubmitting(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/paypal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "donate",
          idToken,
          sellerUid,
          amount: amtNum,
          note: note.trim(),
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Donation failed");

      setMsg({ text: `✓ Donated ${formatBalance(amtNum)} to ${result.sellerName || seller?.username}. Thank you!`, ok: true });
      setAmt("");
      setNote("");

      donateCache.delete(sellerUid);
      setLoadingSummary(true);
      fetch("/api/paypal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get-donations", sellerUid }),
      })
        .then((r) => r.json())
        .then((out) => {
          if (out.ok !== false) {
            donateCache.set(sellerUid, out);
            setSummary(out);
          }
          setLoadingSummary(false);
        })
        .catch(() => setLoadingSummary(false));
    } catch (err: any) {
      setMsg({ text: err.message || "Something went wrong. Please try again.", ok: false });
    } finally {
      setSubmitting(false);
    }
  }

  if (notFound) {
    return <SellerNotFoundScreen context="donate" />;
  }

  if (!seller) {
    return <DonatePageSkeleton />;
  }

  const recent = summary?.recent || [];
  const sellerName = seller?.username || "…";
  const sellerInitial = sellerName.charAt(0).toUpperCase();

  return (
    <div className="dnp-page">
      <div className="dnp-hero">
        <div className="dnp-hero-av">
          {seller?.profilePic ? <img src={seller.profilePic} alt={sellerName} /> : sellerInitial}
        </div>
        <div className="dnp-hero-icon">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
          </svg>
        </div>
        <h1 className="dnp-hero-title">
          Support <span>{sellerName}</span>
        </h1>
        <p className="dnp-hero-sub">A portion of each donation goes directly to them — no strings attached.</p>
      </div>

      <div className="dnp-stats-row">
        <div className="dnp-stat-card">
          <div className="dnp-stat-val">{loadingSummary ? "—" : formatBalance(Number(summary?.totalDonated || 0))}</div>
          <div className="dnp-stat-lbl">Total received</div>
        </div>
        <div className="dnp-stat-card">
          <div className="dnp-stat-val">{loadingSummary ? "—" : String(summary?.donationCount || 0)}</div>
          <div className="dnp-stat-lbl">Donations</div>
        </div>
      </div>

      <div className="dnp-main-grid">
        <div className="dnp-form-panel">
          <div className="dnp-field-label">Amount to donate (USD)</div>
          <div className="dnp-amount-wrap">
            <span className="dnp-amount-currency">$</span>
            <input
              type="number"
              inputMode="decimal"
              placeholder="0.00"
              min={1}
              max={2500}
              step={0.01}
              value={amt}
              onChange={(e) => setAmt(e.target.value)}
            />
          </div>
          <div className="dnp-quick-amounts">
            {[5, 10, 25, 50].map((v) => (
              <button
                key={v}
                type="button"
                className={`dnp-quick-btn${amtNum === v ? " active" : ""}`}
                onClick={() => setAmt(String(v))}
              >
                ${v}
              </button>
            ))}
          </div>

          <div className="dnp-field-label">Message (optional)</div>
          <input
            type="text"
            className="dnp-text-input"
            placeholder="Say something nice…"
            maxLength={200}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />

          {showFee && (
            <div className="dnp-fee-breakdown">
              <div className="dnp-fee-line">
                <span>Platform fee (30%)</span>
                <span>{formatBalance(fee)}</span>
              </div>
              <div className="dnp-fee-line total">
                <span>Seller receives</span>
                <span>{formatBalance(receive)}</span>
              </div>
              {currency !== "USD" && (
                <div className="dnp-fee-line" style={{ opacity: 0.6, fontSize: "0.78em" }}>
                  <span>Charged from your wallet as</span>
                  <span>${amtNum.toFixed(2)} USD</span>
                </div>
              )}
            </div>
          )}

          {msg && <div className={`dnp-msg ${msg.ok ? "ok" : "err"}`}>{msg.text}</div>}

          {/* Donate CTA — disabled pending PayPal split payments (server
              also 410s the `donate` action). Kept visible rather than
              removed so the flow/limits/fee math stay intact for when
              it's re-enabled. */}
          <div className="dnp-coming-soon">Donations are moving to PayPal — check back soon.</div>
          <button className="dnp-submit-btn" disabled title="Coming soon — donations are moving to PayPal">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path
                d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"
                fill="currentColor"
                stroke="none"
              />
            </svg>
            <span>Coming soon</span>
          </button>
        </div>

        <div className="dnp-side-panel">
          <div className="dnp-how-title">How donating works</div>
          <ul className="dnp-how-list">
            <li>Donations are processed via PayPal split payment, not your Siterifty wallet balance.</li>
            <li>{sellerName} receives 70% directly — a 30% platform fee applies.</li>
            <li>Add an optional public message to let them know why you&apos;re supporting them.</li>
            <li>Donations are shown on this page and are not refundable.</li>
          </ul>
        </div>
      </div>

      <div className="dnp-recent-section">
        <div className="dnp-recent-hdr">Recent donations</div>
        {loadingSummary ? (
          <div className="dnp-recent-list">
            <div className="dnp-skel" />
            <div className="dnp-skel" />
            <div className="dnp-skel" />
          </div>
        ) : recent.length ? (
          <div className="dnp-recent-list">
            {recent.map((d, i) => (
              <DonationRowView key={i} don={d} />
            ))}
          </div>
        ) : (
          <div className="dnp-recent-empty">No donations yet — be the first!</div>
        )}
      </div>
    </div>
  );
}
