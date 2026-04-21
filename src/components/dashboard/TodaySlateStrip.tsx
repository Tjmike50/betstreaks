// =============================================================================
// TodaySlateStrip — horizontal scroll of today's games for the active sport.
// Reuses useGamesToday + GameCard. Sport-aware empty state.
// Shows verified games in main strip; unverified games in a separate section.
// =============================================================================
import { useNavigate } from "react-router-dom";
import { ArrowRight, CalendarDays, AlertTriangle } from "lucide-react";
import { useGamesToday } from "@/hooks/useGamesToday";
import { useSport } from "@/contexts/SportContext";
import { GameCard } from "@/components/GameCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export function TodaySlateStrip() {
  const navigate = useNavigate();
  const { config } = useSport();
  const { verifiedGames, unverifiedGames, isLoading, error } = useGamesToday();

  const isOffseason = config.seasonState === "offseason";
  const totalGames = verifiedGames.length + unverifiedGames.length;

  return (
    <section className="px-4 pt-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold text-foreground">Today's Slate</h2>
        </div>
        {totalGames > 0 && (
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
      ) : totalGames === 0 ? (
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
        <>
          {/* Main verified slate */}
          {verifiedGames.length > 0 && (
            <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide snap-x">
              {verifiedGames.map((game) => (
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

          {/* Unverified games section */}
          {unverifiedGames.length > 0 && (
            <div className="mt-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />
                <span className="text-xs text-muted-foreground">Unverified</span>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-yellow-500 border-yellow-500/30">
                  {unverifiedGames.length}
                </Badge>
              </div>
              <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide snap-x opacity-70">
                {unverifiedGames.map((game) => (
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
            </div>
          )}
        </>
      )}
    </section>
  );
}
