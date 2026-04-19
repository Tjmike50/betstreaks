// =============================================================================
// useBestBets — shared best-bets query (extracted from BestBetsPage).
// Sport-aware. Filters to in-scope teams only.
// =============================================================================
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSport } from "@/contexts/SportContext";
import { isInScopeTeam } from "@/lib/sports/leagueTeams";
import { calculateBestBetsScore, type Streak } from "@/types/streak";

export interface BestBetsFilters {
  minStreak: number;
  minL10Pct: number;
  maxDaysAgo: number;
  showPlayers: boolean;
  showTeams: boolean;
  /** Hard cap on returned rows. Default 50. */
  limit?: number;
}

export const DEFAULT_BEST_BETS_FILTERS: BestBetsFilters = {
  minStreak: 3,
  minL10Pct: 60,
  maxDaysAgo: 5,
  showPlayers: true,
  showTeams: true,
  limit: 50,
};

function getDaysAgoDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

export function useBestBets(filters: BestBetsFilters = DEFAULT_BEST_BETS_FILTERS) {
  const { sport } = useSport();
  const limit = filters.limit ?? 50;

  return useQuery({
    queryKey: ["bestBets", sport, filters],
    queryFn: async () => {
      const cutoffDate = getDaysAgoDate(filters.maxDaysAgo);

      const { data, error } = await supabase
        .from("streaks")
        .select("*")
        .eq("sport", sport)
        .gte("streak_len", filters.minStreak)
        .gte("last_game", cutoffDate)
        .order("streak_len", { ascending: false });

      if (error) throw error;

      let results = (data ?? []) as Streak[];

      // Sport-aware in-scope filter (NBA postseason teams or all WNBA teams)
      results = results.filter((s) => isInScopeTeam(sport, s.team_abbr));

      // Min L10 hit %
      results = results.filter((s) => (s.last10_hit_pct ?? 0) >= filters.minL10Pct);

      // Entity filters
      if (!filters.showPlayers) results = results.filter((s) => s.entity_type !== "player");
      if (!filters.showTeams) results = results.filter((s) => s.entity_type !== "team");

      // Sort by composite Best Bets score
      results.sort((a, b) => calculateBestBetsScore(b) - calculateBestBetsScore(a));

      return results.slice(0, limit);
    },
  });
}
