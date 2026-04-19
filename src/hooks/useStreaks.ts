import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Streak, StreakFilters } from "@/types/streak";
import { calculateBestBetsScore } from "@/types/streak";
import { useSport } from "@/contexts/SportContext";
import { isLeagueTeam, isInScopeTeam } from "@/lib/sports/leagueTeams";
import type { SportKey } from "@/lib/sports/registry";

// Minimum thresholds to hide spam (when advanced mode is OFF)
const MIN_THRESHOLDS: Record<string, number> = {
  PTS: 5,
  REB: 4,
  AST: 2,
  "3PM": 1,
  BLK: 1,
  STL: 1,
};

// De-duplicate: for each player+stat, keep only the best card
function deduplicateStreaks(streaks: Streak[]): Streak[] {
  const bestByPlayerStat = new Map<string, Streak>();

  for (const streak of streaks) {
    const key = `${streak.player_id}-${streak.stat}`;
    const existing = bestByPlayerStat.get(key);

    if (!existing) {
      bestByPlayerStat.set(key, streak);
      continue;
    }

    if (
      streak.streak_len > existing.streak_len ||
      (streak.streak_len === existing.streak_len &&
        streak.threshold > existing.threshold) ||
      (streak.streak_len === existing.streak_len &&
        streak.threshold === existing.threshold &&
        streak.season_win_pct > existing.season_win_pct)
    ) {
      bestByPlayerStat.set(key, streak);
    }
  }

  return Array.from(bestByPlayerStat.values());
}

function filterByMinThreshold(streaks: Streak[]): Streak[] {
  return streaks.filter((streak) => {
    const minThreshold = MIN_THRESHOLDS[streak.stat];
    if (minThreshold === undefined) return true;
    return streak.threshold >= minThreshold;
  });
}

export function useStreaks(filters: StreakFilters, sportOverride?: SportKey) {
  const { sport: activeSport } = useSport();
  const sport = sportOverride ?? activeSport;

  return useQuery({
    queryKey: ["streaks", sport, filters],
    queryFn: async () => {
      let query = supabase
        .from("streaks")
        .select("*")
        .eq("sport", sport)
        .eq("entity_type", filters.entityType)
        .gte("streak_len", filters.minStreak)
        .gte("season_win_pct", filters.minSeasonWinPct)
        .order("streak_len", { ascending: false })
        .order("season_win_pct", { ascending: false })
        .order("last_game", { ascending: false });

      if (filters.stat !== "All") {
        query = query.eq("stat", filters.stat);
      }

      if (filters.playerSearch.trim()) {
        const searchField = filters.entityType === "team" ? "team_abbr" : "player_name";
        query = query.ilike(searchField, `%${filters.playerSearch.trim()}%`);
      }

      const { data, error } = await query;

      if (error) throw error;

      let streaks = data as Streak[];

      // Sport-aware team filter:
      // - NBA: keep only valid NBA teams that are postseason-relevant
      // - WNBA: keep only valid WNBA teams
      streaks = streaks.filter((s) =>
        isLeagueTeam(sport, s.team_abbr) && isInScopeTeam(sport, s.team_abbr)
      );

      if (!filters.advanced) {
        streaks = filterByMinThreshold(streaks);
      }

      streaks = deduplicateStreaks(streaks);

      if (filters.bestBets) {
        streaks = streaks.filter(
          (s) =>
            s.streak_len >= 3 &&
            (s.season_win_pct >= 55 || (s.last10_hit_pct ?? 0) >= 60)
        );
      }

      if (filters.thresholdMin !== null) {
        streaks = streaks.filter((s) => s.threshold >= filters.thresholdMin!);
      }
      if (filters.thresholdMax !== null) {
        streaks = streaks.filter((s) => s.threshold <= filters.thresholdMax!);
      }

      if (filters.teamFilter && filters.teamFilter !== "All") {
        streaks = streaks.filter((s) => s.team_abbr === filters.teamFilter);
      }

      if (filters.recentOnly) {
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
        const threeDaysAgoStr = threeDaysAgo.toISOString().split("T")[0];
        streaks = streaks.filter((s) => s.last_game >= threeDaysAgoStr);
      }

      streaks.sort((a, b) => {
        switch (filters.sortBy) {
          case "season":
            if (b.season_win_pct !== a.season_win_pct)
              return b.season_win_pct - a.season_win_pct;
            return b.streak_len - a.streak_len;
          case "l10":
            const aL10Pct = a.last10_games > 0 ? (a.last10_hits / a.last10_games) * 100 : 0;
            const bL10Pct = b.last10_games > 0 ? (b.last10_hits / b.last10_games) * 100 : 0;
            if (bL10Pct !== aL10Pct) return bL10Pct - aL10Pct;
            return b.streak_len - a.streak_len;
          case "recent":
            return b.last_game.localeCompare(a.last_game);
          case "threshold":
            if (b.threshold !== a.threshold) return b.threshold - a.threshold;
            return b.streak_len - a.streak_len;
          case "bestBetsScore":
            const aScore = calculateBestBetsScore(a);
            const bScore = calculateBestBetsScore(b);
            if (bScore !== aScore) return bScore - aScore;
            return b.streak_len - a.streak_len;
          case "streak":
          default:
            if (b.streak_len !== a.streak_len) return b.streak_len - a.streak_len;
            if (b.season_win_pct !== a.season_win_pct)
              return b.season_win_pct - a.season_win_pct;
            return b.last_game.localeCompare(a.last_game);
        }
      });

      return streaks;
    },
  });
}

export function usePlayerStreaks(playerId: number) {
  return useQuery({
    queryKey: ["playerStreaks", playerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("streaks")
        .select("*")
        .eq("player_id", playerId)
        .order("streak_len", { ascending: false })
        .order("season_win_pct", { ascending: false });

      if (error) throw error;
      return data as Streak[];
    },
    enabled: !!playerId,
  });
}
