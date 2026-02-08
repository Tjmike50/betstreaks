import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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

function getOffsetDateString(date: Date, offsetDays: number): string {
  const newDate = new Date(date);
  newDate.setDate(date.getDate() + offsetDays);
  return getLocalDateString(newDate);
}

export function useGamesToday() {
  const today = new Date();
  const startDate = getOffsetDateString(today, -1); // yesterday
  const endDate = getOffsetDateString(today, 1); // tomorrow

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["games-today", startDate, endDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("games_today")
        .select("*")
        .eq("sport", "NBA")
        .gte("game_date", startDate)
        .lte("game_date", endDate)
        .order("game_time", { ascending: true, nullsFirst: false })
        .order("id", { ascending: true });

      if (error) throw error;
      
      // Filter out placeholder games with null team abbreviations (All-Star break, etc.)
      const validGames = (data as GameToday[]).filter(
        (game) => game.home_team_abbr && game.away_team_abbr
      );
      
      return validGames;
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
