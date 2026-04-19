import { useState, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWatchlist } from "./useWatchlist";
import { useSport } from "@/contexts/SportContext";
import { isInScopeTeam } from "@/lib/sports/leagueTeams";
import type { SportKey } from "@/lib/sports/registry";

const LAST_SEEN_KEY_BASE = "alerts_last_seen_at";

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

function getAlertKey(event: StreakEvent): string {
  return `${event.sport}|${event.entity_type}|${event.player_id}|${event.team_abbr}|${event.stat}|${event.threshold}`;
}

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

function lastSeenStorageKey(sport: SportKey): string {
  return sport === "NBA" ? LAST_SEEN_KEY_BASE : `${LAST_SEEN_KEY_BASE}__${sport}`;
}

function getLastSeenTimestamp(sport: SportKey): string | null {
  try {
    return localStorage.getItem(lastSeenStorageKey(sport));
  } catch {
    return null;
  }
}

function setLastSeenTimestamp(sport: SportKey, timestamp: string): void {
  try {
    localStorage.setItem(lastSeenStorageKey(sport), timestamp);
  } catch {
    // ignore
  }
}

export function useAlerts(sportOverride?: SportKey) {
  const { sport: activeSport } = useSport();
  const sport = sportOverride ?? activeSport;
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(() => getLastSeenTimestamp(sport));
  const { offlineKeys, isAuthenticated } = useWatchlist(sport);

  const { data: events = [], isLoading, refetch } = useQuery({
    queryKey: ["streak-events", sport],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("streak_events")
        .select("*")
        .eq("sport", sport)
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) throw error;
      return (data as StreakEvent[]).filter((e) => isInScopeTeam(sport, e.team_abbr));
    },
  });

  const { data: watchlistItems = [] } = useQuery({
    queryKey: ["watchlist-items-for-alerts", sport],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return [];

      const { data, error } = await supabase
        .from("watchlist_items")
        .select("*")
        .eq("user_id", session.user.id)
        .eq("sport", sport);

      if (error) throw error;
      return data;
    },
    enabled: isAuthenticated,
  });

  const watchlistKeySet = useMemo(() => {
    const keys = new Set<string>();

    if (isAuthenticated) {
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
      for (const key of offlineKeys) {
        const parts = key.split("-");
        if (parts.length >= 4) {
          const [entityType, playerId, stat, threshold] = parts;
          keys.add(buildWatchlistKey(
            sport,
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
  }, [isAuthenticated, watchlistItems, offlineKeys, sport]);

  const isInWatchlist = useCallback(
    (event: StreakEvent): boolean => {
      return watchlistKeySet.has(getAlertKey(event));
    },
    [watchlistKeySet]
  );

  const isNewAlert = useCallback(
    (event: StreakEvent): boolean => {
      if (!lastSeenAt) return true;
      return new Date(event.created_at) > new Date(lastSeenAt);
    },
    [lastSeenAt]
  );

  const newAlertCount = useMemo(() => {
    return events.filter((e) => isNewAlert(e)).length;
  }, [events, isNewAlert]);

  const markAllRead = useCallback(() => {
    const now = new Date().toISOString();
    setLastSeenTimestamp(sport, now);
    setLastSeenAt(now);
  }, [sport]);

  const markAsSeen = useCallback(() => {
    const now = new Date().toISOString();
    setLastSeenTimestamp(sport, now);
    setLastSeenAt(now);
  }, [sport]);

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
    sport,
  };
}

export { getAlertKey };
