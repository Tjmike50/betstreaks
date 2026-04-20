// =============================================================================
// HotStreaksStrip — top active player streaks for the active sport.
// Reuses useStreaks + StreakCard. Sport-aware empty state.
// =============================================================================
import { useNavigate } from "react-router-dom";
import { ArrowRight, Flame } from "lucide-react";
import { useLineFirstStreaks } from "@/hooks/useLineFirstStreaks";
import { useSport } from "@/contexts/SportContext";
import { StreakCard } from "@/components/StreakCard";
import { Skeleton } from "@/components/ui/skeleton";
import type { StreakFilters } from "@/types/streak";

const HOT_STREAKS_FILTERS: StreakFilters = {
  stat: "All",
  minStreak: 3,
  minSeasonWinPct: 0,
  playerSearch: "",
  advanced: false,
  entityType: "player",
  sortBy: "streak",
  bestBets: false,
  thresholdMin: null,
  thresholdMax: null,
  teamFilter: "All",
  recentOnly: true,
};

const MAX_ROWS = 3;

export function HotStreaksStrip() {
  const navigate = useNavigate();
  const { config } = useSport();
  const { data: streaks, isLoading } = useLineFirstStreaks(HOT_STREAKS_FILTERS);

  const isOffseason = config.seasonState === "offseason";
  const top = (streaks ?? []).slice(0, MAX_ROWS);

  return (
    <section className="px-4 pt-5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-amber-400" />
          <h2 className="text-base font-semibold text-foreground">Hot Streaks</h2>
        </div>
        {top.length > 0 && (
          <button
            type="button"
            onClick={() => navigate("/streaks")}
            className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
          >
            View all
            <ArrowRight className="h-3 w-3" />
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 w-full rounded-lg" />
          ))}
        </div>
      ) : top.length === 0 ? (
        <div className="glass-card p-5 text-center">
          <Flame className="h-7 w-7 mx-auto text-muted-foreground/50 mb-2" />
          <p className="text-sm font-medium text-foreground">
            {isOffseason ? `${config.shortName} streaks paused` : "No active streaks yet"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isOffseason
              ? "We'll surface fresh streaks when the season tips off."
              : "Check back after tonight's games for fresh streaks."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {top.map((streak) => (
            <StreakCard key={streak.id} streak={streak} showStarButton={false} />
          ))}
        </div>
      )}
    </section>
  );
}
