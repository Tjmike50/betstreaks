import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Streak, StreakFilters } from "@/types/streak";

// Minimum thresholds to hide spam (when advanced mode is OFF)
const MIN_THRESHOLDS: Record<string, number> = {
  PTS: 5,
  REB: 4,
  AST: 2,
  "3PM": 1,
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

    // Compare: highest streak_len, then highest threshold, then highest season_win_pct
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

// Filter out low thresholds based on stat type
function filterByMinThreshold(streaks: Streak[]): Streak[] {
  return streaks.filter((streak) => {
    const minThreshold = MIN_THRESHOLDS[streak.stat];
    if (minThreshold === undefined) return true; // Unknown stat, keep it
    return streak.threshold >= minThreshold;
  });
}

export function useStreaks(filters: StreakFilters) {
  return useQuery({
    queryKey: ["streaks", filters],
    queryFn: async () => {
      let query = supabase
        .from("streaks")
        .select("*")
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
        // For teams, search by team_abbr; for players, search by player_name
        const searchField = filters.entityType === "team" ? "team_abbr" : "player_name";
        query = query.ilike(searchField, `%${filters.playerSearch.trim()}%`);
      }

      const { data, error } = await query;

      if (error) throw error;

      let streaks = data as Streak[];

      // Apply threshold minimums unless advanced mode is on
      if (!filters.advanced) {
        streaks = filterByMinThreshold(streaks);
      }

      // De-duplicate: show only best card per player+stat
      streaks = deduplicateStreaks(streaks);

      // Apply Best Bets filter: streak >= 3 AND (season >= 55% OR L10 >= 60%)
      if (filters.bestBets) {
        streaks = streaks.filter(
          (s) =>
            s.streak_len >= 3 &&
            (s.season_win_pct >= 55 || (s.last10_hit_pct ?? 0) >= 60)
        );
      }

      // Sort based on selected option
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
