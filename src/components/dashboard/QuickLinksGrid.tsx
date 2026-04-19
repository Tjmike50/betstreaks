// =============================================================================
// QuickLinksGrid — Cheatsheets + Research shortcuts for the Dashboard.
// Reuses CheatsheetCard for visual consistency.
// =============================================================================
import { BookOpen, Flame, Layers, Search, Users, CalendarDays } from "lucide-react";
import { CheatsheetCard } from "@/components/cheatsheets/CheatsheetCard";

export function QuickLinksGrid() {
  return (
    <section className="px-4 pt-5 space-y-5">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <BookOpen className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold text-foreground">Cheatsheets</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <CheatsheetCard
            title="Value"
            description="Best price vs. our model."
            icon={Layers}
            to="/cheatsheets/value"
            accent="primary"
          />
          <CheatsheetCard
            title="Hot Streaks"
            description="Players riding active runs."
            icon={Flame}
            to="/cheatsheets/streaks"
            accent="amber"
          />
          <CheatsheetCard
            title="Matchup Edges"
            description="Who has the matchup tonight."
            icon={Layers}
            to="/cheatsheets/matchups"
            accent="violet"
          />
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-2">
          <Search className="h-4 w-4 text-emerald-400" />
          <h2 className="text-base font-semibold text-foreground">Research</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <CheatsheetCard
            title="Players"
            description="Search players, splits, and streaks."
            icon={Users}
            to="/research/players"
            accent="emerald"
          />
          <CheatsheetCard
            title="Games"
            description="Today's matchups and scores."
            icon={CalendarDays}
            to="/research/games"
            accent="emerald"
          />
        </div>
      </div>
    </section>
  );
}
