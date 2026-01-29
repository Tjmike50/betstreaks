import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else {
    return `${diffDays}d ago`;
  }
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

export function useRefreshStatus(): RefreshStatusResult {
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["refresh-status", "NBA"],
    queryFn: async (): Promise<RefreshStatus | null> => {
      const { data, error } = await supabase
        .from("refresh_status")
        .select("*")
        .eq("id", 1)
        .eq("sport", "NBA")
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60 * 1000, // Consider fresh for 5 minutes
    gcTime: 30 * 60 * 1000, // Keep in cache for 30 minutes
  });

  const lastRun = data?.last_run ? new Date(data.last_run) : null;
  
  let hoursSinceUpdate: number | null = null;
  let formattedTime = "Update status unavailable";
  let isStale = false;

  if (lastRun) {
    const now = new Date();
    const diffMs = now.getTime() - lastRun.getTime();
    hoursSinceUpdate = diffMs / (1000 * 60 * 60);
    isStale = hoursSinceUpdate > 24;
    
    if (isStale) {
      formattedTime = `${formatDateTime(lastRun)} (${formatRelativeTime(lastRun)})`;
    } else {
      formattedTime = `Updated ${formatRelativeTime(lastRun)}`;
    }
  }

  const handleRefetch = () => {
    refetch();
    // Also invalidate streaks queries to refresh data
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
  };
}
