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
}

// Get date string in YYYY-MM-DD format for the US Eastern timezone, which is
// the canonical "slate day" for US sports. This avoids late-night ET games
// (e.g. a 10:40 PM ET tip) being filed under tomorrow's UTC date.
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

  // Also include the next UTC date — late-night ET games (e.g. 10:40 PM ET
  // tipoff) get stored with the next-day UTC date by the upstream feed.
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowUtcStr = tomorrow.toISOString().slice(0, 10);
  const todayUtcStr = new Date().toISOString().slice(0, 10);
  const candidateDates = Array.from(new Set([todayStr, todayUtcStr, tomorrowUtcStr]));

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["games-today", sport, todayStr, candidateDates.join(",")],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("games_today")
        .select("*")
        .eq("sport", sport)
        .in("game_date", candidateDates)
        .eq("is_active", true)
        .order("game_time", { ascending: true, nullsFirst: false })
        .order("id", { ascending: true });

      if (error) throw error;

      const rows = (data as GameToday[]).filter(
        (game) => game.home_team_abbr && game.away_team_abbr,
      );

      // Re-bucket each row to its true ET slate date.
      const filtered = rows.filter((g) => {
        if (g.game_date === todayStr) return true;
        if (g.game_date === tomorrowUtcStr && todayStr !== tomorrowUtcStr) {
          const t = (g.game_time || "").toUpperCase();
          if (/\b(0?[7-9]|1[0-2]):\d{2}\s*PM\b/.test(t)) return true;
        }
        return false;
      });

      return filtered;
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

  // Separate verified vs unverified for UI consumption
  const verifiedGames = (data ?? []).filter(
    (g) => g.verification_status === "verified" || g.verification_status === "missing_secondary",
  );
  const unverifiedGames = (data ?? []).filter(
    (g) => g.verification_status === "mismatch" || g.verification_status === "unverified",
  );

  const debugInfo = {
    sport,
    date: todayStr,
    rawCount: data?.length ?? 0,
    verifiedCount: verifiedGames.length,
    unverifiedCount: unverifiedGames.length,
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
