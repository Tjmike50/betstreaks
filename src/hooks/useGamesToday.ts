import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSport } from "@/contexts/SportContext";
import type { SportKey } from "@/lib/sports/registry";

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

// Get local date in YYYY-MM-DD format
function getLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function useGamesToday(sportOverride?: SportKey) {
  const { sport: activeSport } = useSport();
  const sport = sportOverride ?? activeSport;
  const todayStr = getLocalDateString(new Date());

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["games-today", sport, todayStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("games_today")
        .select("*")
        .eq("sport", sport)
        .eq("game_date", todayStr)
        .order("game_time", { ascending: true, nullsFirst: false })
        .order("id", { ascending: true });

      if (error) throw error;

      const validGames = (data as GameToday[]).filter(
        (game) => game.home_team_abbr && game.away_team_abbr
      );

      return validGames;
    },
    staleTime: 1000 * 60 * 2,
  });

  const lastUpdated = data?.reduce((latest, game) => {
    const gameUpdated = new Date(game.updated_at);
    return gameUpdated > latest ? gameUpdated : latest;
  }, new Date(0));

  const handleRefresh = () => {
    refetch();
  };

  const debugInfo = {
    sport,
    date: todayStr,
    rawCount: data?.length ?? 0,
  };

  return {
    games: data ?? [],
    isLoading,
    isFetching,
    error,
    lastUpdated: data?.length ? lastUpdated : null,
    refetch: handleRefresh,
    debugInfo,
  };
}

