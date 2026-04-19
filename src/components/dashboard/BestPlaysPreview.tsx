// =============================================================================
// BestPlaysPreview — top 3 best plays for the active sport on the Dashboard.
// Reuses useBestBets. Each row links into Research player page (or streak
// detail for team rows). Footer CTA → /best-bets.
// =============================================================================
import { useNavigate } from "react-router-dom";
import { Trophy, ArrowRight, Flame } from "lucide-react";
import { useBestBets, DEFAULT_BEST_BETS_FILTERS } from "@/hooks/useBestBets";
import { useSport } from "@/contexts/SportContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import type { Streak } from "@/types/streak";

const PREVIEW_FILTERS = { ...DEFAULT_BEST_BETS_FILTERS, limit: 3 };

function rowHref(streak: Streak): string {
  if (streak.entity_type === "player" && streak.player_id) {
    return `/research/player/${streak.player_id}`;
  }
  // Team rows → streak detail page
  return `/streak?id=${streak.id}`;
}

export function BestPlaysPreview() {
  const navigate = useNavigate();
  const { config } = useSport();
  const { data: streaks, isLoading, error } = useBestBets(PREVIEW_FILTERS);

  const isOffseason = config.seasonState === "offseason";

  return (
    <section className="px-4 pt-5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-amber-400" />
          <h2 className="text-base font-semibold text-foreground">Best Plays</h2>
        </div>
        <button
          type="button"
          onClick={() => navigate("/best-bets")}
          className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
        >
          View all
          <ArrowRight className="h-3 w-3" />
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ) : error ? (
        <div className="glass-card p-4 text-center">
          <p className="text-xs text-muted-foreground">
            Couldn't load best plays. Try again soon.
          </p>
        </div>
      ) : !streaks || streaks.length === 0 ? (
        <div className="glass-card p-5 text-center">
          <Trophy className="h-7 w-7 mx-auto text-muted-foreground/50 mb-2" />
          <p className="text-sm font-medium text-foreground">
            {isOffseason
              ? `${config.shortName} is in offseason`
              : "No best plays yet"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isOffseason
              ? "Best Plays will return when the season resumes."
              : "Streak data hasn't surfaced any high-confidence plays today."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {streaks.map((streak, idx) => (
            <li key={streak.id}>
              <button
                type="button"
                onClick={() => navigate(rowHref(streak))}
                className="w-full glass-card p-3 flex items-center gap-3 text-left hover:border-primary/40 transition-colors"
              >
                <div
                  className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                    idx === 0
                      ? "bg-amber-500 text-black"
                      : idx === 1
                      ? "bg-muted text-foreground"
                      : "bg-amber-700 text-white"
                  }`}
                >
                  {idx + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-medium text-foreground truncate">
                      {streak.player_name}
                    </p>
                    {streak.team_abbr && (
                      <span className="text-[10px] text-muted-foreground">
                        {streak.team_abbr}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {streak.stat} {streak.threshold}+ ·{" "}
                    {Math.round((streak.last10_hit_pct ?? 0))}% L10
                  </p>
                </div>
                <Badge
                  variant="secondary"
                  className="gap-1 text-xs flex-shrink-0"
                >
                  <Flame className="h-3 w-3 text-amber-400" />
                  {streak.streak_len}
                </Badge>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
