import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";

export interface GameToday {
  id: string;
  home_team_abbr: string | null;
  away_team_abbr: string | null;
  sport: string;
  home_score: number | null;
  away_score: number | null;
  status: string | null;
  game_date: string;
  game_time: string | null;
  updated_at: string;
}

export function useGamesToday() {
  const queryClient = useQueryClient();
  const today = format(new Date(), "yyyy-MM-dd");

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["games-today", today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("games_today")
        .select("*")
        .eq("sport", "NBA")
        .eq("game_date", today)
        .order("game_time", { ascending: true, nullsFirst: false })
        .order("id", { ascending: true });

      if (error) throw error;
      return data as GameToday[];
    },
    staleTime: 1000 * 60 * 2, // 2 minutes
  });

  // Get the most recent updated_at from all games
  const lastUpdated = data?.reduce((latest, game) => {
    const gameUpdated = new Date(game.updated_at);
    return gameUpdated > latest ? gameUpdated : latest;
  }, new Date(0));

  const handleRefresh = () => {
    refetch();
  };

  return {
    games: data ?? [],
    isLoading,
    isFetching,
    error,
    lastUpdated: data?.length ? lastUpdated : null,
    refetch: handleRefresh,
  };
}
