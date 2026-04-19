// =============================================================================
// TodaySlateStrip — horizontal scroll of today's games for the active sport.
// Reuses useGamesToday + GameCard. Sport-aware empty state.
// =============================================================================
import { useNavigate } from "react-router-dom";
import { ArrowRight, CalendarDays } from "lucide-react";
import { useGamesToday } from "@/hooks/useGamesToday";
import { useSport } from "@/contexts/SportContext";
import { GameCard } from "@/components/GameCard";
import { Skeleton } from "@/components/ui/skeleton";

export function TodaySlateStrip() {
  const navigate = useNavigate();
  const { config } = useSport();
  const { games, isLoading, error } = useGamesToday();

  const isOffseason = config.seasonState === "offseason";

  return (
    <section className="px-4 pt-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold text-foreground">Today's Slate</h2>
        </div>
        {games.length > 0 && (
          <button
            type="button"
            onClick={() => navigate("/research/games")}
            className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
          >
            View all
            <ArrowRight className="h-3 w-3" />
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 min-w-[260px] rounded-lg" />
          ))}
        </div>
      ) : error ? (
        <div className="glass-card p-4 text-center">
          <p className="text-xs text-muted-foreground">Couldn't load games. Try again soon.</p>
        </div>
      ) : games.length === 0 ? (
        <div className="glass-card p-5 text-center">
          <CalendarDays className="h-7 w-7 mx-auto text-muted-foreground/50 mb-2" />
          <p className="text-sm font-medium text-foreground">
            {isOffseason ? `${config.shortName} is in offseason` : "No games scheduled"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isOffseason
              ? "Check back when the season resumes."
              : `${config.tagline} doesn't have games on the board today.`}
          </p>
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide snap-x">
          {games.map((game) => (
            <div key={game.id} className="min-w-[280px] snap-start">
              <GameCard
                id={game.id}
                homeTeamAbbr={game.home_team_abbr}
                awayTeamAbbr={game.away_team_abbr}
                homeScore={game.home_score}
                awayScore={game.away_score}
                status={game.status}
                gameTime={game.game_time}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
