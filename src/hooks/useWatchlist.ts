import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Streak } from "@/types/streak";

const STORAGE_KEY = "betstreaks_watchlist";
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

// Create a unique key for a streak to use in the watchlist lookup
function getStreakKey(streak: Pick<Streak, "entity_type" | "player_id" | "stat" | "threshold">): string {
  return `${streak.entity_type}-${streak.player_id}-${streak.stat}-${streak.threshold}`;
}

// Load offline watchlist from localStorage
function loadOfflineWatchlist(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

// Save offline watchlist to localStorage
function saveOfflineWatchlist(keys: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
  } catch {
    // Ignore storage errors
  }
}

export function useWatchlist() {
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [offlineKeys, setOfflineKeys] = useState<string[]>(() => loadOfflineWatchlist());

  // Get current user
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUserId(session?.user?.id ?? null);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Sync offlineKeys to localStorage
  useEffect(() => {
    saveOfflineWatchlist(offlineKeys);
  }, [offlineKeys]);

  // Fetch watchlist items for NBA (only when authenticated)
  const { data: watchlistItems = [] } = useQuery({
    queryKey: ["watchlist", userId],
    queryFn: async () => {
      if (!userId) return [];
      
      const { data, error } = await supabase
        .from("watchlist_items")
        .select("*")
        .eq("user_id", userId)
        .eq("sport", "NBA");

      if (error) throw error;
      return data as WatchlistItem[];
    },
    enabled: !!userId,
  });

  // Create a Set for fast lookup (combines online and offline)
  const starredKeys = useMemo(() => {
    const keys = new Set<string>();
    
    // Add authenticated user's items
    for (const item of watchlistItems) {
      keys.add(`${item.entity_type}-${item.player_id}-${item.stat}-${item.threshold}`);
    }
    
    // Add offline items (when not authenticated)
    if (!userId) {
      for (const key of offlineKeys) {
        keys.add(key);
      }
    }
    
    return keys;
  }, [watchlistItems, offlineKeys, userId]);

  // Check if a streak is starred
  const isStarred = useCallback(
    (streak: Pick<Streak, "entity_type" | "player_id" | "stat" | "threshold">): boolean => {
      return starredKeys.has(getStreakKey(streak));
    },
    [starredKeys]
  );

  // Add to watchlist (authenticated)
  const addMutation = useMutation({
    mutationFn: async (streak: Streak) => {
      if (!userId) throw new Error("Not authenticated");

      const { error } = await supabase.from("watchlist_items").insert({
        user_id: userId,
        sport: "NBA",
        entity_type: streak.entity_type,
        player_id: streak.player_id,
        team_abbr: streak.team_abbr,
        stat: streak.stat,
        threshold: streak.threshold,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchlist", userId] });
    },
  });

  // Remove from watchlist (authenticated)
  const removeMutation = useMutation({
    mutationFn: async (streak: Streak) => {
      if (!userId) throw new Error("Not authenticated");

      const { error } = await supabase
        .from("watchlist_items")
        .delete()
        .eq("user_id", userId)
        .eq("sport", "NBA")
        .eq("entity_type", streak.entity_type)
        .eq("player_id", streak.player_id)
        .eq("stat", streak.stat)
        .eq("threshold", streak.threshold);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchlist", userId] });
    },
  });

  // Toggle watchlist status - returns { added: boolean, limitReached: boolean }
  const toggleWatchlist = useCallback(
    (streak: Streak): { added: boolean; limitReached: boolean } => {
      const key = getStreakKey(streak);
      const currentlyStarred = starredKeys.has(key);

      if (userId) {
        // Authenticated user - use Supabase
        if (currentlyStarred) {
          removeMutation.mutate(streak);
          return { added: false, limitReached: false };
        } else {
          addMutation.mutate(streak);
          return { added: true, limitReached: false };
        }
      } else {
        // Offline mode - use localStorage
        if (currentlyStarred) {
          setOfflineKeys((prev) => prev.filter((k) => k !== key));
          return { added: false, limitReached: false };
        } else {
          // Check limit
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

  // Remove from offline watchlist by key
  const removeOfflineKey = useCallback((key: string) => {
    setOfflineKeys((prev) => prev.filter((k) => k !== key));
  }, []);

  return {
    isAuthenticated: !!userId,
    isStarred,
    toggleWatchlist,
    isLoading: addMutation.isPending || removeMutation.isPending,
    offlineCount: offlineKeys.length,
    maxOfflineStars: MAX_OFFLINE_STARS,
    offlineKeys,
    removeOfflineKey,
  };
}
