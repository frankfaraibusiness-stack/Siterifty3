"use client";

import { useRouter, useSearchParams } from "next/navigation";
import OnboardingWizard from "@/components/onboarding/OnboardingWizard";
import { useThemeModal } from "@/components/theme/ThemeModalProvider";

// Full-page version of onboarding — previously opened as a modal from
// AuthModalProvider right after signup. Same component, same finish
// behavior (open the theme picker), just navigated to as its own
// /onboarding?username=... route instead of overlaying whatever page the
// user happened to sign up from.
export default function OnboardingPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { openThemePicker } = useThemeModal();

  const username = searchParams.get("username") || "";

  return (
    <OnboardingWizard
      open
      username={username}
      onFinish={() => {
        openThemePicker();
        router.replace("/marketplace");
      }}
    />
  );
}
