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

function getTodayEtDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function normalizePct(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return value <= 1 ? value * 100 : value;
}

function tierPriority(tier: string | null | undefined): number {
  switch ((tier ?? "").toLowerCase()) {
    case "elite":
      return 4;
    case "strong":
      return 3;
    case "lean":
      return 2;
    case "pass":
      return 1;
    default:
      return 0;
  }
}

interface MlbBestBetRow {
  id: string;
  player_id: number;
  player_name: string;
  team_abbr: string | null;
  opponent_abbr: string | null;
  stat_type: string;
  threshold: number;
  score_overall: number | null;
  confidence_score: number | null;
  confidence_tier: string | null;
  reason_tags: unknown;
  game_date: string;
  last5_hit_rate: number | null;
  last10_hit_rate: number | null;
  season_hit_rate: number | null;
  total_games: number | null;
  scored_at: string;
}

function mapMlbRowToStreak(row: MlbBestBetRow): Streak {
  const last5Pct = normalizePct(row.last5_hit_rate);
  const last10Pct = normalizePct(row.last10_hit_rate);
  const seasonPct = normalizePct(row.season_hit_rate);
  const last5Games = row.last5_hit_rate != null ? 5 : 0;
  const last10Games = row.last10_hit_rate != null ? 10 : 0;
  const seasonGames = Number(row.total_games ?? 0);
  const last5Hits = last5Games > 0 ? Math.round((last5Pct / 100) * last5Games) : 0;
  const last10Hits = last10Games > 0 ? Math.round((last10Pct / 100) * last10Games) : 0;
  const seasonWins = seasonGames > 0 ? Math.round((seasonPct / 100) * seasonGames) : 0;

  return {
    id: row.id,
    player_id: row.player_id,
    player_name: row.player_name,
    team_abbr: row.team_abbr,
    opponent_abbr: row.opponent_abbr,
    stat: row.stat_type,
    threshold: row.threshold,
    streak_len: last5Games > 0 && last5Hits === last5Games ? last5Games : 0,
    streak_start: row.game_date,
    streak_win_pct: 0,
    season_wins: seasonWins,
    season_games: seasonGames,
    season_win_pct: seasonPct,
    last_game: row.game_date,
    sport: "MLB",
    entity_type: "player",
    updated_at: row.scored_at,
    last10_hits: last10Hits,
    last10_games: last10Games,
    last10_hit_pct: last10Pct,
    last5_hits: last5Hits,
    last5_games: last5Games,
    last5_hit_pct: last5Pct,
    confidence_score: row.confidence_score,
    score_overall: row.score_overall,
    confidence_tier: row.confidence_tier,
    reason_tags: row.reason_tags,
    book_threshold: row.threshold,
    book_main_threshold: row.threshold,
    book_informational: false,
  };
}

export function useBestBets(filters: BestBetsFilters = DEFAULT_BEST_BETS_FILTERS) {
  const { sport } = useSport();
  const limit = filters.limit ?? 50;

  return useQuery({
    queryKey: ["bestBets", sport, filters],
    queryFn: async () => {
      if (sport === "MLB") {
        const gameDate = getTodayEtDate();
        const { data, error } = await supabase
          .from("player_prop_scores")
          .select(
            "id, player_id, player_name, team_abbr, opponent_abbr, stat_type, threshold, score_overall, confidence_score, confidence_tier, reason_tags, game_date, last5_hit_rate, last10_hit_rate, season_hit_rate, total_games, scored_at",
          )
          .eq("sport", "MLB")
          .eq("game_date", gameDate)
          .not("player_id", "is", null)
          .or("score_overall.gte.50,confidence_score.gte.50,confidence_tier.in.(elite,strong,lean)")
          .order("score_overall", { ascending: false, nullsFirst: false })
          .order("confidence_score", { ascending: false, nullsFirst: false })
          .limit(Math.max(limit, 100));

        if (error) throw error;

        const rows = (data ?? []) as MlbBestBetRow[];
        const results = rows
          .filter((row) => isInScopeTeam("MLB", row.team_abbr))
          .sort((a, b) => {
            const tierDelta = tierPriority(b.confidence_tier) - tierPriority(a.confidence_tier);
            if (tierDelta !== 0) return tierDelta;
            const overallDelta = Number(b.score_overall ?? 0) - Number(a.score_overall ?? 0);
            if (overallDelta !== 0) return overallDelta;
            return Number(b.confidence_score ?? 0) - Number(a.confidence_score ?? 0);
          })
          .slice(0, limit)
          .map(mapMlbRowToStreak);

        if (typeof window !== "undefined") {
          console.log("[useBestBets][MLB] rows", results.length, "date", gameDate);
        }

        return results;
      }

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
