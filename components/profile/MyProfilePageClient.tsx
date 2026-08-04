"use client";

import { useAuth } from "@/lib/AuthContext";
import SignInRequired from "@/components/auth/SignInRequired";
import MyProfileHub from "@/components/profile/MyProfileHub";
import type { ParentTab } from "@/components/profile/MyProfileHub";

// Ports the PROFILE MODAL (Js/profile.js + profile-early.js) — see
// MyProfileHub.tsx for the full port. Ports the original's
// window.__openProfileModal guard (only ever called from click handlers
// gated by __requireAuth) as an in-page check here instead, since a
// direct /myprofile visit (bookmark, deep link, browser back) has no
// prior click to gate.
//
// Split out from app/myprofile/page.tsx (and the new
// app/myprofile/[tab]/page.tsx) specifically so those can stay server
// components and export their own generateMetadata — each tab now has
// its own real URL and its own title/description for SEO (see this
// component's initialTab prop, and MyProfileHub's own selectTab, which
// keeps the URL in sync as the user clicks between tabs after landing).
export default function MyProfilePageClient({ initialTab }: { initialTab?: ParentTab }) {
  const { user, loading } = useAuth();

  if (loading || user === undefined) {
    return (
      <div style={{ marginTop: 92, minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.4)" }}>
        Loading…
      </div>
    );
  }

  if (!user) {
    return (
      <SignInRequired
        title="Sign in to view your profile"
        description="Your profile, listings, favorites, and account settings are only visible once you're signed in."
      />
    );
  }

  return <MyProfileHub initialTab={initialTab} />;
}
