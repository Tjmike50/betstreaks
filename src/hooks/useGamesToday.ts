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
  verification_status: string;
  schedule_confidence: number;
  is_active: boolean;
  is_postponed: boolean;
  mismatch_flags: unknown[];
  canonical_game_key: string | null;
  source_primary: string;
  source_secondary: string | null;
  last_verified_at: string | null;
}

// Get date string in YYYY-MM-DD format for the US Eastern timezone, which is
// the canonical "slate day" for US sports.
function getEasternDateString(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

export function useGamesToday(sportOverride?: SportKey) {
  const { sport: activeSport } = useSport();
  const sport = sportOverride ?? activeSport;
  const todayStr = getEasternDateString(new Date());

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["games-today", sport, todayStr],
    queryFn: async () => {
      // Use the trusted RPC which filters by is_active, is_postponed,
      // canonical_game_key, and orders by game_time.
      const { data, error } = await supabase.rpc("get_trusted_games_today", {
        p_sport: sport,
        p_target_date: todayStr,
        p_timezone: "America/New_York",
      });

      if (error) throw error;

      // Map RPC rows to GameToday shape, filling in fields the RPC doesn't return
      const rows: GameToday[] = ((data as any[]) ?? [])
        .filter((g: any) => g.home_team_abbr && g.away_team_abbr)
        .map((g: any) => ({
          ...g,
          mismatch_flags: [],
        }));

      return rows;
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

  // The RPC already returns only trusted/verified rows, so all are "verified"
  const verifiedGames = data ?? [];
  const unverifiedGames: GameToday[] = [];

  const debugInfo = {
    sport,
    date: todayStr,
    rawCount: data?.length ?? 0,
    verifiedCount: verifiedGames.length,
    unverifiedCount: 0,
  };

  return {
    games: data ?? [],
    verifiedGames,
    unverifiedGames,
    isLoading,
    isFetching,
    error,
    lastUpdated: data?.length ? lastUpdated : null,
    refetch: handleRefresh,
    debugInfo,
  };
}
