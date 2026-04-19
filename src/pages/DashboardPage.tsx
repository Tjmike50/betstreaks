// =============================================================================
// DashboardPage — new Home / command center for BetStreaks.
// Sport-aware. Reuses existing hooks and components.
// Block 1: Hero + Today's Slate + Hot Streaks + Quick Links.
// AI Daily Pick + Best Plays Preview land in Block 2.
// =============================================================================
import { useEffect, useState } from "react";
import { Footer } from "@/components/Footer";
import { OnboardingFlow } from "@/components/OnboardingFlow";
import { EarlyAccessBanner } from "@/components/EarlyAccessBanner";
import { DataFreshnessIndicator } from "@/components/DataFreshnessIndicator";
import { AdminRefreshButton } from "@/components/AdminRefreshButton";
import { DashboardHero } from "@/components/dashboard/DashboardHero";
import { TodaySlateStrip } from "@/components/dashboard/TodaySlateStrip";
import { HotStreaksStrip } from "@/components/dashboard/HotStreaksStrip";
import { QuickLinksGrid } from "@/components/dashboard/QuickLinksGrid";

const ONBOARDING_KEY = "onboarding_complete";

export default function DashboardPage() {
  const [showOnboarding, setShowOnboarding] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(ONBOARDING_KEY) !== "true";
  });

  // Defensive: keep onboarding state in sync if it changes elsewhere.
  useEffect(() => {
    const onStorage = () => {
      setShowOnboarding(localStorage.getItem(ONBOARDING_KEY) !== "true");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const handleOnboardingComplete = () => {
    localStorage.setItem(ONBOARDING_KEY, "true");
    setShowOnboarding(false);
  };

  if (showOnboarding) {
    return <OnboardingFlow onComplete={handleOnboardingComplete} />;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <DashboardHero />

      <div className="px-4 pt-1 flex items-center justify-between gap-2">
        <DataFreshnessIndicator />
        <AdminRefreshButton />
      </div>

      <EarlyAccessBanner />

      <main className="flex-1 pb-20">
        <TodaySlateStrip />
        <HotStreaksStrip />
        <QuickLinksGrid />
      </main>

      <Footer />
    </div>
  );
}
