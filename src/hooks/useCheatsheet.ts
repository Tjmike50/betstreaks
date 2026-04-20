// =============================================================================
// useCheatsheet — shared hook powering all cheatsheet pages.
// Sport-aware from day one. Reads from player_prop_scores, the canonical
// multi-sport scored output table.
//
// MLB v1 (anchor props): HITS, TOTAL_BASES, STRIKEOUTS only. Other sports
// continue to use legacy stat_type values (PTS/REB/AST/3PM/...).
// =============================================================================
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSport } from "@/contexts/SportContext";
import { isInScopeTeam, isLeagueTeam } from "@/lib/sports/leagueTeams";
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

  // Legacy (kept for backward compat with NBA/WNBA UI)
  confidence_score: number | null;
  value_score: number | null;
  consistency_score: number | null;
  volatility_score: number | null;

  // Multi-axis scoring (MLB anchors + future)
  score_overall: number | null;
  score_recent_form: number | null;
  score_matchup: number | null;
  score_opportunity: number | null;
  score_consistency: number | null;
  score_value: number | null;
  score_risk: number | null;
  confidence_tier: string | null;
  summary_json: unknown;

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
  /** Minimum value score (category=value, legacy NBA/WNBA fallback). */
  minValueScore?: number;
  /** Minimum confidence score (category=matchups, legacy NBA/WNBA fallback). */
  minConfidence?: number;
}

const DEFAULT_LIMIT = 50;

// MLB v1 anchor props supported by score-mlb-anchors.
const MLB_ANCHOR_STATS = ["HITS", "TOTAL_BASES", "STRIKEOUTS"] as const;

const SELECT_COLUMNS =
  "id, player_id, player_name, team_abbr, opponent_abbr, home_away, stat_type, threshold, " +
  "confidence_score, value_score, consistency_score, volatility_score, " +
  "score_overall, score_recent_form, score_matchup, score_opportunity, score_consistency, score_value, score_risk, " +
  "confidence_tier, summary_json, " +
  "last5_avg, last10_avg, season_avg, last5_hit_rate, last10_hit_rate, season_hit_rate, " +
  "vs_opponent_hit_rate, vs_opponent_games, reason_tags, game_date, sport";

/**
 * MLB-aware scope filter. NBA narrows to postseason teams, WNBA accepts any
 * WNBA team, MLB accepts any non-empty team_abbr (team registry not yet
 * wired). Falls back to true when team_abbr is missing so newly ingested
 * MLB rows aren't dropped during the bring-up phase.
 */
function passesScope(sport: SportKey, teamAbbr: string | null): boolean {
  if (sport === "MLB") {
    // No MLB team registry yet; accept any team_abbr (or null for now).
    return true;
  }
  if (isInScopeTeam(sport, teamAbbr)) return true;
  // Tolerate sports without postseason narrowing (WNBA already handled).
  return isLeagueTeam(sport, teamAbbr);
}

export function useCheatsheet({
  category,
  sport: sportOverride,
  limit = DEFAULT_LIMIT,
  minValueScore = 60,
  minConfidence = 60,
}: UseCheatsheetOptions) {
  const { sport: activeSport } = useSport();
  const sport = sportOverride ?? activeSport;
  const isMlb = sport === "MLB";

  return useQuery({
    queryKey: ["cheatsheet", category, sport, limit, minValueScore, minConfidence],
    queryFn: async (): Promise<CheatsheetRow[]> => {
      let query = supabase
        .from("player_prop_scores")
        .select(SELECT_COLUMNS)
        .eq("sport", sport);

      // Restrict MLB to v1 anchor props until the remaining 4 are scored.
      if (isMlb) {
        query = query.in("stat_type", MLB_ANCHOR_STATS as unknown as string[]);
      }

      // -----------------------------------------------------------------
      // Category-specific ranking + filters.
      // MLB uses the new score_* axes (populated by score-mlb-anchors).
      // NBA/WNBA continue to use the legacy *_score / *_hit_rate columns.
      // -----------------------------------------------------------------
      if (category === "value") {
        if (isMlb) {
          query = query
            .gte("score_value", 50)
            .order("score_overall", { ascending: false, nullsFirst: false })
            .order("score_value", { ascending: false, nullsFirst: false });
        } else {
          query = query
            .gte("value_score", minValueScore)
            .order("value_score", { ascending: false, nullsFirst: false });
        }
      } else if (category === "matchups") {
        if (isMlb) {
          query = query
            .gte("score_matchup", 55)
            .order("score_matchup", { ascending: false, nullsFirst: false })
            .order("score_opportunity", { ascending: false, nullsFirst: false });
        } else {
          query = query
            .gte("confidence_score", minConfidence)
            .gte("vs_opponent_games", 2)
            .order("vs_opponent_hit_rate", { ascending: false, nullsFirst: false });
        }
      } else if (category === "streaks") {
        if (isMlb) {
          query = query
            .gte("score_recent_form", 60)
            .order("score_recent_form", { ascending: false, nullsFirst: false })
            .order("score_consistency", { ascending: false, nullsFirst: false });
        } else {
          query = query
            .gte("last10_hit_rate", 70)
            .order("last10_hit_rate", { ascending: false, nullsFirst: false });
        }
      } else {
        // best-bets: stricter — confidence_tier in (elite, strong) for MLB,
        // confidence_score-weighted for legacy sports.
        if (isMlb) {
          query = query
            .in("confidence_tier", ["elite", "strong"])
            .order("score_overall", { ascending: false, nullsFirst: false });
        } else {
          query = query.order("confidence_score", { ascending: false, nullsFirst: false });
        }
      }

      const { data, error } = await query.limit(limit * 2); // overfetch, then scope-filter
      if (error) throw error;

      const scoped = (data ?? []).filter((row) =>
        passesScope(sport, row.team_abbr ?? null),
      );

      return scoped.slice(0, limit) as CheatsheetRow[];
    },
    staleTime: 60_000,
  });
}
