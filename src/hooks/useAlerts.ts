import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWatchlist } from "./useWatchlist";

const LAST_SEEN_KEY = "alerts_last_seen_at";

export interface StreakEvent {
  id: string;
  sport: string;
  entity_type: string;
  player_id: number | null;
  player_name: string | null;
  team_abbr: string | null;
  stat: string;
  threshold: number;
  event_type: string;
  prev_streak_len: number | null;
  new_streak_len: number | null;
  last_game: string | null;
  created_at: string;
}

// Build a unique key for matching alerts to watchlist items
function getAlertKey(event: StreakEvent): string {
  return `${event.sport}|${event.entity_type}|${event.player_id}|${event.team_abbr}|${event.stat}|${event.threshold}`;
}

// Build key from watchlist item format
function buildWatchlistKey(
  sport: string,
  entityType: string,
  playerId: number | null,
  teamAbbr: string | null,
  stat: string,
  threshold: number
): string {
  return `${sport}|${entityType}|${playerId}|${teamAbbr}|${stat}|${threshold}`;
}

function getLastSeenTimestamp(): string | null {
  try {
    return localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    return null;
  }
}

function setLastSeenTimestamp(timestamp: string): void {
  try {
    localStorage.setItem(LAST_SEEN_KEY, timestamp);
  } catch {
    // Ignore storage errors
  }
}

export function useAlerts() {
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(() => getLastSeenTimestamp());
  const { offlineKeys, isAuthenticated } = useWatchlist();

  // Fetch alerts
  const { data: events = [], isLoading, refetch } = useQuery({
    queryKey: ["streak-events"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("streak_events")
        .select("*")
        .eq("sport", "NBA")
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) throw error;
      return data as StreakEvent[];
    },
  });

  // Fetch watchlist items for authenticated users
  const { data: watchlistItems = [] } = useQuery({
    queryKey: ["watchlist-items-for-alerts"],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return [];

      const { data, error } = await supabase
        .from("watchlist_items")
        .select("*")
        .eq("user_id", session.user.id)
        .eq("sport", "NBA");

      if (error) throw error;
      return data;
    },
    enabled: isAuthenticated,
  });

  // Build watchlist key set
  const watchlistKeySet = useMemo(() => {
    const keys = new Set<string>();

    if (isAuthenticated) {
      // Build keys from Supabase watchlist_items
      for (const item of watchlistItems) {
        keys.add(buildWatchlistKey(
          item.sport,
          item.entity_type,
          item.player_id,
          item.team_abbr,
          item.stat,
          item.threshold
        ));
      }
    } else {
      // Build keys from localStorage offlineKeys
      // offlineKeys format: "entity_type-player_id-stat-threshold"
      // We need to convert to our format with sport and team_abbr
      for (const key of offlineKeys) {
        const parts = key.split("-");
        if (parts.length >= 4) {
          const [entityType, playerId, stat, threshold] = parts;
          // For offline mode, we assume NBA and null team_abbr for players
          keys.add(buildWatchlistKey(
            "NBA",
            entityType,
            parseInt(playerId, 10) || null,
            null,
            stat,
            parseInt(threshold, 10)
          ));
        }
      }
    }

    return keys;
  }, [isAuthenticated, watchlistItems, offlineKeys]);

  // Check if an alert is in the watchlist
  const isInWatchlist = useCallback(
    (event: StreakEvent): boolean => {
      return watchlistKeySet.has(getAlertKey(event));
    },
    [watchlistKeySet]
  );

  // Check if an alert is new (unread)
  const isNewAlert = useCallback(
    (event: StreakEvent): boolean => {
      if (!lastSeenAt) return true;
      return new Date(event.created_at) > new Date(lastSeenAt);
    },
    [lastSeenAt]
  );

  // Count of new alerts
  const newAlertCount = useMemo(() => {
    return events.filter((e) => isNewAlert(e)).length;
  }, [events, isNewAlert]);

  // Mark all as read
  const markAllRead = useCallback(() => {
    const now = new Date().toISOString();
    setLastSeenTimestamp(now);
    setLastSeenAt(now);
  }, []);

  // Mark as seen when tab opens
  const markAsSeen = useCallback(() => {
    const now = new Date().toISOString();
    setLastSeenTimestamp(now);
    setLastSeenAt(now);
  }, []);

  return {
    events,
    isLoading,
    refetch,
    isInWatchlist,
    isNewAlert,
    newAlertCount,
    markAllRead,
    markAsSeen,
    watchlistKeySet,
  };
}

export { getAlertKey };
