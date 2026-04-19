import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSport } from "@/contexts/SportContext";
import { STALE_THRESHOLD_HOURS, CURRENT_SEASON, isDataStale, getHoursSinceUpdate } from "@/lib/dataFreshness";
import type { SportKey } from "@/lib/sports/registry";

interface RefreshStatus {
  id: number;
  sport: string | null;
  last_run: string | null;
}

interface RefreshStatusResult {
  lastRun: Date | null;
  hoursSinceUpdate: number | null;
  isStale: boolean;
  formattedTime: string;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
  season: string;
  sport: SportKey;
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

function formatDateTime(date: Date): string {
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function useRefreshStatus(sportOverride?: SportKey): RefreshStatusResult {
  const queryClient = useQueryClient();
  const { sport: activeSport } = useSport();
  const sport = sportOverride ?? activeSport;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["refresh-status", sport],
    queryFn: async (): Promise<RefreshStatus | null> => {
      // Match the most recent refresh row for this sport.
      const { data, error } = await supabase
        .from("refresh_status")
        .select("*")
        .eq("sport", sport)
        .order("last_run", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const lastRun = data?.last_run ? new Date(data.last_run) : null;
  const hoursSinceUpdate = getHoursSinceUpdate(lastRun);
  const isStale = isDataStale(lastRun, STALE_THRESHOLD_HOURS);

  let formattedTime = "Update status unavailable";
  if (lastRun) {
    if (isStale) {
      formattedTime = `${formatDateTime(lastRun)} (${formatRelativeTime(lastRun)})`;
    } else {
      formattedTime = `Updated ${formatRelativeTime(lastRun)}`;
    }
  }

  const handleRefetch = () => {
    refetch();
    queryClient.invalidateQueries({ queryKey: ["streaks"] });
    queryClient.invalidateQueries({ queryKey: ["streak-events"] });
    queryClient.invalidateQueries({ queryKey: ["watchlist-optimized"] });
  };

  return {
    lastRun,
    hoursSinceUpdate,
    isStale,
    formattedTime,
    isLoading,
    error: error as Error | null,
    refetch: handleRefetch,
    season: CURRENT_SEASON,
    sport,
  };
}
