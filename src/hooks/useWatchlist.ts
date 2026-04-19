import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useSport } from "@/contexts/SportContext";
import type { Streak } from "@/types/streak";
import type { SportKey } from "@/lib/sports/registry";

const STORAGE_KEY_BASE = "betstreaks_watchlist";
const MAX_OFFLINE_STARS = 5;

interface WatchlistItem {
  id: string;
  user_id: string;
  sport: string;
  entity_type: string;
  player_id: number | null;
  team_abbr: string | null;
  stat: string;
  threshold: number;
}

// Per-sport offline storage key (legacy "betstreaks_watchlist" reused for NBA
// to preserve existing local stars; WNBA gets its own bucket).
function offlineStorageKey(sport: SportKey): string {
  return sport === "NBA" ? STORAGE_KEY_BASE : `${STORAGE_KEY_BASE}__${sport}`;
}

function getStreakKey(streak: Pick<Streak, "entity_type" | "player_id" | "stat" | "threshold">): string {
  return `${streak.entity_type}-${streak.player_id}-${streak.stat}-${streak.threshold}`;
}

function loadOfflineWatchlist(sport: SportKey): string[] {
  try {
    const stored = localStorage.getItem(offlineStorageKey(sport));
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveOfflineWatchlist(sport: SportKey, keys: string[]): void {
  try {
    localStorage.setItem(offlineStorageKey(sport), JSON.stringify(keys));
  } catch {
    // ignore
  }
}

export function useWatchlist(sportOverride?: SportKey) {
  const queryClient = useQueryClient();
  const { user, isAuthenticated } = useAuth();
  const { sport: activeSport } = useSport();
  const sport = sportOverride ?? activeSport;
  const userId = user?.id ?? null;

  const [offlineKeys, setOfflineKeys] = useState<string[]>(() => loadOfflineWatchlist(sport));

  // Reload offline keys whenever the active sport changes.
  useEffect(() => {
    setOfflineKeys(loadOfflineWatchlist(sport));
  }, [sport]);

  // Sync offlineKeys to localStorage
  useEffect(() => {
    saveOfflineWatchlist(sport, offlineKeys);
  }, [sport, offlineKeys]);

  const { data: watchlistItems = [] } = useQuery({
    queryKey: ["watchlist", userId, sport],
    queryFn: async () => {
      if (!userId) return [];

      const { data, error } = await supabase
        .from("watchlist_items")
        .select("*")
        .eq("user_id", userId)
        .eq("sport", sport);

      if (error) throw error;
      return data as WatchlistItem[];
    },
    enabled: !!userId,
  });

  const addMutation = useMutation({
    mutationFn: async (streak: Streak) => {
      if (!userId) throw new Error("Not authenticated");

      const { error } = await supabase.from("watchlist_items").insert({
        user_id: userId,
        sport,
        entity_type: streak.entity_type,
        player_id: streak.player_id,
        team_abbr: streak.team_abbr,
        stat: streak.stat,
        threshold: streak.threshold,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchlist", userId, sport] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (streak: Streak) => {
      if (!userId) throw new Error("Not authenticated");

      const { error } = await supabase
        .from("watchlist_items")
        .delete()
        .eq("user_id", userId)
        .eq("sport", sport)
        .eq("entity_type", streak.entity_type)
        .eq("player_id", streak.player_id)
        .eq("stat", streak.stat)
        .eq("threshold", streak.threshold);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchlist", userId, sport] });
    },
  });

  const starredKeys = useMemo(() => {
    const keys = new Set<string>();

    if (userId) {
      for (const item of watchlistItems) {
        keys.add(`${item.entity_type}-${item.player_id}-${item.stat}-${item.threshold}`);
      }
    } else {
      for (const key of offlineKeys) {
        keys.add(key);
      }
    }

    return keys;
  }, [userId, watchlistItems, offlineKeys]);

  const isStarred = useCallback(
    (streak: Pick<Streak, "entity_type" | "player_id" | "stat" | "threshold">): boolean => {
      return starredKeys.has(getStreakKey(streak));
    },
    [starredKeys]
  );

  const toggleWatchlist = useCallback(
    (streak: Streak): { added: boolean; limitReached: boolean } => {
      const key = getStreakKey(streak);
      const currentlyStarred = starredKeys.has(key);

      if (userId) {
        if (currentlyStarred) {
          removeMutation.mutate(streak);
          return { added: false, limitReached: false };
        } else {
          addMutation.mutate(streak);
          return { added: true, limitReached: false };
        }
      } else {
        if (currentlyStarred) {
          setOfflineKeys((prev) => prev.filter((k) => k !== key));
          return { added: false, limitReached: false };
        } else {
          if (offlineKeys.length >= MAX_OFFLINE_STARS) {
            return { added: false, limitReached: true };
          }
          setOfflineKeys((prev) => [...prev, key]);
          return { added: true, limitReached: false };
        }
      }
    },
    [userId, starredKeys, offlineKeys, addMutation, removeMutation]
  );

  const removeOfflineKey = useCallback((key: string) => {
    setOfflineKeys((prev) => prev.filter((k) => k !== key));
  }, []);

  return {
    isAuthenticated: !!userId,
    isStarred,
    toggleWatchlist,
    removeOfflineKey,
    isLoading: addMutation.isPending || removeMutation.isPending,
    offlineCount: offlineKeys.length,
    maxOfflineStars: MAX_OFFLINE_STARS,
    offlineKeys,
    sport,
  };
}
