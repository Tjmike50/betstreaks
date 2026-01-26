import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Streak, StreakFilters } from "@/types/streak";

export function useStreaks(filters: StreakFilters) {
  return useQuery({
    queryKey: ["streaks", filters],
    queryFn: async () => {
      let query = supabase
        .from("streaks")
        .select("*")
        .gte("streak_len", filters.minStreak)
        .gte("season_win_pct", filters.minSeasonWinPct)
        .order("streak_len", { ascending: false })
        .order("season_win_pct", { ascending: false })
        .order("last_game", { ascending: false });

      if (filters.stat !== "All") {
        query = query.eq("stat", filters.stat);
      }

      if (filters.playerSearch.trim()) {
        query = query.ilike("player_name", `%${filters.playerSearch.trim()}%`);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data as Streak[];
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
