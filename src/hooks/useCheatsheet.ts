// =============================================================================
// useCheatsheet — shared hook powering all cheatsheet pages.
// Sport-aware from day one; filters player_prop_scores by category + sport.
// =============================================================================
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSport } from "@/contexts/SportContext";
import { isInScopeTeam } from "@/lib/sports/leagueTeams";
import type { SportKey } from "@/lib/sports/registry";

export type CheatsheetCategory = "value" | "streaks" | "matchups" | "best-bets";

export interface CheatsheetRow {
  id: string;
  player_id: number;
  player_name: string;
  team_abbr: string | null;
  opponent_abbr: string | null;
  home_away: string | null;
  stat_type: string;
  threshold: number;
  confidence_score: number | null;
  value_score: number | null;
  consistency_score: number | null;
  volatility_score: number | null;
  last5_avg: number | null;
  last10_avg: number | null;
  season_avg: number | null;
  last5_hit_rate: number | null;
  last10_hit_rate: number | null;
  season_hit_rate: number | null;
  vs_opponent_hit_rate: number | null;
  vs_opponent_games: number | null;
  reason_tags: unknown;
  game_date: string;
  sport: string;
}

export interface UseCheatsheetOptions {
  category: CheatsheetCategory;
  /** Override active sport (defaults to SportContext). */
  sport?: SportKey;
  /** Limit number of rows returned. */
  limit?: number;
  /** Minimum value score (category=value). */
  minValueScore?: number;
  /** Minimum confidence score (category=matchups). */
  minConfidence?: number;
}

const DEFAULT_LIMIT = 50;

export function useCheatsheet({
  category,
  sport: sportOverride,
  limit = DEFAULT_LIMIT,
  minValueScore = 60,
  minConfidence = 60,
}: UseCheatsheetOptions) {
  const { sport: activeSport } = useSport();
  const sport = sportOverride ?? activeSport;

  return useQuery({
    queryKey: ["cheatsheet", category, sport, limit, minValueScore, minConfidence],
    queryFn: async (): Promise<CheatsheetRow[]> => {
      let query = supabase
        .from("player_prop_scores")
        .select(
          "id, player_id, player_name, team_abbr, opponent_abbr, home_away, stat_type, threshold, confidence_score, value_score, consistency_score, volatility_score, last5_avg, last10_avg, season_avg, last5_hit_rate, last10_hit_rate, season_hit_rate, vs_opponent_hit_rate, vs_opponent_games, reason_tags, game_date, sport",
        )
        .eq("sport", sport);

      // Category-specific scoring filters + ordering
      if (category === "value") {
        query = query
          .gte("value_score", minValueScore)
          .order("value_score", { ascending: false, nullsFirst: false });
      } else if (category === "matchups") {
        query = query
          .gte("confidence_score", minConfidence)
          .gte("vs_opponent_games", 2)
          .order("vs_opponent_hit_rate", { ascending: false, nullsFirst: false });
      } else if (category === "streaks") {
        query = query
          .gte("last10_hit_rate", 70)
          .order("last10_hit_rate", { ascending: false, nullsFirst: false });
      } else {
        // best-bets fallback: confidence-weighted
        query = query.order("confidence_score", { ascending: false, nullsFirst: false });
      }

      const { data, error } = await query.limit(limit * 2); // overfetch, then scope-filter
      if (error) throw error;

      // Sport-scope team filtering (NBA postseason / WNBA active league)
      const scoped = (data ?? []).filter((row) =>
        isInScopeTeam(sport, row.team_abbr ?? null),
      );

      return scoped.slice(0, limit) as CheatsheetRow[];
    },
    staleTime: 60_000,
  });
}
