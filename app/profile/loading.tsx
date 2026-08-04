import NavSpinnerIcon from "@/components/shared/NavSpinnerIcon";

// /profile's page.tsx does a server-side redirect() to /myprofile — that
// happens before any client JS runs, so there's no component here to put
// a spinner in directly. This loading.tsx is Next's shown-immediately
// fallback while that redirect resolves, closing the same "blank buffer"
// gap fixed on /aiagent (which redirects client-side and can render its
// own spinner) and /r/[username] (same server-redirect shape as this
// route — see its own loading.tsx).
export default function Loading() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh", color: "var(--mp-text-sec, rgba(255,255,255,0.4))" }}>
      <NavSpinnerIcon size={22} />
    </div>
  );
}
