// =============================================================================
// useResearchPlayers — sport-aware aggregated player list for Research/Players.
// Source: `streaks` table (public read). De-duplicates per player by keeping the
// row with the longest active streak, then exposes a flat row for the table.
// =============================================================================
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSport } from "@/contexts/SportContext";
import { isInScopeTeam } from "@/lib/sports/leagueTeams";

export interface ResearchPlayerRow {
  player_id: number;
  player_name: string;
  team_abbr: string | null;
  top_stat: string;
  top_threshold: number;
  top_streak_len: number;
  season_win_pct: number;
  season_games: number;
  last10_hit_pct: number | null;
  last_game: string;
}

export function useResearchPlayers() {
  const { sport } = useSport();

  return useQuery({
    queryKey: ["research-players", sport],
    queryFn: async (): Promise<ResearchPlayerRow[]> => {
      const { data, error } = await supabase
        .from("streaks")
        .select(
          "player_id, player_name, team_abbr, stat, threshold, streak_len, season_win_pct, season_games, last10_hit_pct, last_game",
        )
        .eq("sport", sport)
        .eq("entity_type", "player")
        .order("streak_len", { ascending: false })
        .limit(2000);

      if (error) throw error;

      // Keep one row per player — the one with the strongest active streak
      // (longest, then highest season win pct as tiebreaker).
      const byPlayer = new Map<number, ResearchPlayerRow>();
      for (const r of data ?? []) {
        if (!isInScopeTeam(sport, r.team_abbr)) continue;

        const existing = byPlayer.get(r.player_id);
        const candidate: ResearchPlayerRow = {
          player_id: r.player_id,
          player_name: r.player_name,
          team_abbr: r.team_abbr,
          top_stat: r.stat,
          top_threshold: Number(r.threshold ?? 0),
          top_streak_len: Number(r.streak_len ?? 0),
          season_win_pct: Number(r.season_win_pct ?? 0),
          season_games: Number(r.season_games ?? 0),
          last10_hit_pct: r.last10_hit_pct == null ? null : Number(r.last10_hit_pct),
          last_game: r.last_game,
        };

        if (
          !existing ||
          candidate.top_streak_len > existing.top_streak_len ||
          (candidate.top_streak_len === existing.top_streak_len &&
            candidate.season_win_pct > existing.season_win_pct)
        ) {
          byPlayer.set(r.player_id, candidate);
        }
      }

      return Array.from(byPlayer.values());
    },
    staleTime: 1000 * 60 * 5,
  });
}
