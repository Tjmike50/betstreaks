// =============================================================================
// DashboardHero — sport-aware greeting block at the top of /
// =============================================================================
import { useSport } from "@/contexts/SportContext";

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function getDateLabel(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function DashboardHero() {
  const { config } = useSport();

  return (
    <header className="px-4 pt-5 pb-2">
      <p className="text-[10px] font-semibold text-primary uppercase tracking-wider">
        {config.tagline} · {getDateLabel()}
      </p>
      <h1 className="text-2xl md:text-3xl font-bold text-foreground mt-1">
        {getGreeting()}
      </h1>
      <p className="text-sm text-muted-foreground mt-1">
        Your daily command center for streaks, slates, and edges.
      </p>
    </header>
  );
}
