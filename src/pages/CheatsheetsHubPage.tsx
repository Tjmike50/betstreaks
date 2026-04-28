// =============================================================================
// CheatsheetsHubPage — entry point listing all cheatsheet categories.
// Sport-aware via SportContext. NBA-first; WNBA inherits the same shells.
// =============================================================================
import { TrendingUp, Flame, Swords, Trophy } from "lucide-react";
import { useSport } from "@/contexts/SportContext";
import { CheatsheetCard } from "@/components/cheatsheets/CheatsheetCard";
import { Footer } from "@/components/Footer";
import { DataFreshnessIndicator } from "@/components/DataFreshnessIndicator";

export default function CheatsheetsHubPage() {
  const { config } = useSport();
  const isOffseason = config.seasonState === "offseason";

  return (
    <div className="min-h-screen pb-24 md:pb-8">
      <div className="max-w-3xl mx-auto px-4 pt-6">
        <header className="mb-6">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
              {config.name} Cheatsheets
            </p>
            {isOffseason && (
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                Offseason
              </span>
            )}
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">
            Find your edge fast
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isOffseason
              ? `${config.name} is in offseason — cheatsheets will repopulate when the season resumes.`
              : "Curated views of today's top props — value, streaks, matchups, and best bets."}
          </p>
        </header>

        <div className="mb-4">
          <DataFreshnessIndicator />
        </div>

        <div className="grid gap-3">
          <CheatsheetCard
            title="Value Plays"
            description="Props where the line is softest vs recent form. Highest expected edge."
            icon={TrendingUp}
            to="/cheatsheets/value"
            accent="primary"
          />
          <CheatsheetCard
            title="Best Bets"
            description="Top confidence-weighted picks across the board."
            icon={Trophy}
            to="/cheatsheets/best-bets"
            accent="amber"
          />
          <CheatsheetCard
            title="Hot Streaks"
            description="Players cashing 7+ of their last 10 — momentum plays."
            icon={Flame}
            to="/cheatsheets/streaks"
            accent="emerald"
          />
          <CheatsheetCard
            title="Matchup Edges"
            description="Players with strong history vs tonight's opponent."
            icon={Swords}
            to="/cheatsheets/matchups"
            accent="violet"
          />
        </div>

        <p className="text-[11px] text-muted-foreground mt-6 leading-relaxed">
          Cheatsheets are research aids based on historical data. They are not predictions or guarantees. Always bet responsibly.
        </p>
      </div>
      <Footer />
    </div>
  );
}
