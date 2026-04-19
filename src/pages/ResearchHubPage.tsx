// =============================================================================
// ResearchHubPage — entry point for player/game research surfaces.
// Sport-aware via SportContext. Reuses CheatsheetCard for visual consistency.
// =============================================================================
import { Users, CalendarDays, Flame } from "lucide-react";
import { CheatsheetCard } from "@/components/cheatsheets/CheatsheetCard";
import { useSport } from "@/contexts/SportContext";
import { Footer } from "@/components/Footer";

export default function ResearchHubPage() {
  const { config } = useSport();

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-1 max-w-3xl w-full mx-auto px-4 py-6 pb-24 md:pb-8">
        <header className="mb-6">
          <p className="text-[10px] font-semibold text-primary uppercase tracking-wider mb-1">
            {config.tagline} · Research
          </p>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">
            Research
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Dig into players, games, and streaks before locking in a slip.
          </p>
        </header>

        <div className="grid gap-3">
          <CheatsheetCard
            title="Players"
            description="Search players, view recent form, splits, and streaks."
            icon={Users}
            to="/research/players"
            comingSoon
            accent="primary"
          />
          <CheatsheetCard
            title="Games"
            description="Today's slate with matchups and live status."
            icon={CalendarDays}
            to="/research/games"
            accent="emerald"
          />
          <CheatsheetCard
            title="Streaks"
            description="Active player streaks across the league."
            icon={Flame}
            to="/streak"
            accent="amber"
          />
        </div>
      </div>
      <Footer />
    </div>
  );
}
