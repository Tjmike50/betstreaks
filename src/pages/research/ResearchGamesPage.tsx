// =============================================================================
// ResearchGamesPage — today's slate of games for the active sport.
// Thin wrapper over useGamesToday + GameCard. Sport-aware empty state.
// =============================================================================
import { ArrowLeft, CalendarDays } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useGamesToday } from "@/hooks/useGamesToday";
import { useSport } from "@/contexts/SportContext";
import { GameCard } from "@/components/GameCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Footer } from "@/components/Footer";

export default function ResearchGamesPage() {
  const navigate = useNavigate();
  const { config } = useSport();
  const { games, isLoading, error } = useGamesToday();

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-1 max-w-3xl w-full mx-auto px-4 py-6 pb-24 md:pb-8">
        <button
          onClick={() => navigate("/research")}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Research
        </button>

        <header className="mb-5">
          <div className="flex items-center gap-2 mb-1">
            <div className="h-8 w-8 rounded-lg bg-emerald-400/10 text-emerald-400 flex items-center justify-center">
              <CalendarDays className="h-4 w-4" />
            </div>
            <p className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider">
              {config.tagline} · Today
            </p>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">
            Today's Games
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Matchups, tip-off times, and live scores for tonight's slate.
          </p>
        </header>

        {isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-20 w-full rounded-lg" />
            ))}
          </div>
        ) : error ? (
          <div className="glass-card p-6 text-center">
            <p className="text-sm text-muted-foreground">
              Couldn't load games. Try again in a moment.
            </p>
          </div>
        ) : games.length === 0 ? (
          <div className="glass-card p-8 text-center">
            <CalendarDays className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
            <h3 className="text-base font-semibold text-foreground mb-1">
              {config.seasonState === "offseason"
                ? `${config.name} is in offseason`
                : `No ${config.name} games scheduled`}
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              {config.seasonState === "offseason"
                ? "Check back when the season resumes."
                : `${config.name} doesn't have games on the board today.`}
            </p>
            <Button variant="outline" size="sm" onClick={() => navigate("/cheatsheets")}>
              Browse Cheatsheets
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {games.map((game) => (
              <GameCard
                key={game.id}
                id={game.id}
                homeTeamAbbr={game.home_team_abbr}
                awayTeamAbbr={game.away_team_abbr}
                homeScore={game.home_score}
                awayScore={game.away_score}
                status={game.status}
                gameTime={game.game_time}
              />
            ))}
          </div>
        )}
      </div>
      <Footer />
    </div>
  );
}
