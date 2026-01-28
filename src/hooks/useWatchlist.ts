import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isLoggedIn, getUserId, setAuthState } from "@/lib/auth";
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

// ============================================
// OFFLINE MODE: localStorage-based storage
// ============================================

function loadOfflineWatchlist(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveOfflineWatchlist(keys: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
  } catch {
    // Ignore storage errors
  }
}

// ============================================
// HOOK: useWatchlist
// ============================================

export function useWatchlist() {
  const queryClient = useQueryClient();
  
  // Offline state (localStorage)
  const [offlineKeys, setOfflineKeys] = useState<string[]>(() => loadOfflineWatchlist());
  
  // Track auth state changes from Supabase
  const [userId, setUserId] = useState<string | null>(null);

  // Listen to Supabase auth changes and update central auth state
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      const newUserId = session?.user?.id ?? null;
      setUserId(newUserId);
      setAuthState(newUserId); // Update central auth state
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      const newUserId = session?.user?.id ?? null;
      setUserId(newUserId);
      setAuthState(newUserId);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Sync offlineKeys to localStorage
  useEffect(() => {
    saveOfflineWatchlist(offlineKeys);
  }, [offlineKeys]);

  // ============================================
  // AUTHED MODE: Supabase-based storage (future)
  // ============================================

  const { data: watchlistItems = [] } = useQuery({
    queryKey: ["watchlist", userId],
    queryFn: async () => {
      if (!isLoggedIn()) return [];
      
      const currentUserId = getUserId();
      if (!currentUserId) return [];
      
      const { data, error } = await supabase
        .from("watchlist_items")
        .select("*")
        .eq("user_id", currentUserId)
        .eq("sport", "NBA");

      if (error) throw error;
      return data as WatchlistItem[];
    },
    enabled: isLoggedIn(),
  });

  // Add to watchlist (authed mode)
  const addMutation = useMutation({
    mutationFn: async (streak: Streak) => {
      const currentUserId = getUserId();
      if (!currentUserId) throw new Error("Not authenticated");

      const { error } = await supabase.from("watchlist_items").insert({
        user_id: currentUserId,
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

  // Remove from watchlist (authed mode)
  const removeMutation = useMutation({
    mutationFn: async (streak: Streak) => {
      const currentUserId = getUserId();
      if (!currentUserId) throw new Error("Not authenticated");

      const { error } = await supabase
        .from("watchlist_items")
        .delete()
        .eq("user_id", currentUserId)
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

  // ============================================
  // COMBINED: Mode-aware starred keys
  // ============================================

  const starredKeys = useMemo(() => {
    const keys = new Set<string>();
    
    if (isLoggedIn()) {
      // Authed mode: use Supabase items
      for (const item of watchlistItems) {
        keys.add(`${item.entity_type}-${item.player_id}-${item.stat}-${item.threshold}`);
      }
    } else {
      // Offline mode: use localStorage
      for (const key of offlineKeys) {
        keys.add(key);
      }
    }
    
    return keys;
  }, [watchlistItems, offlineKeys]);

  // Check if a streak is starred
  const isStarred = useCallback(
    (streak: Pick<Streak, "entity_type" | "player_id" | "stat" | "threshold">): boolean => {
      return starredKeys.has(getStreakKey(streak));
    },
    [starredKeys]
  );

  // ============================================
  // TOGGLE: Mode-aware add/remove
  // ============================================

  const toggleWatchlist = useCallback(
    (streak: Streak): { added: boolean; limitReached: boolean } => {
      const key = getStreakKey(streak);
      const currentlyStarred = starredKeys.has(key);

      if (isLoggedIn()) {
        // AUTHED MODE: unlimited, use Supabase
        if (currentlyStarred) {
          removeMutation.mutate(streak);
          return { added: false, limitReached: false };
        } else {
          addMutation.mutate(streak);
          return { added: true, limitReached: false };
        }
      } else {
        // OFFLINE MODE: capped at MAX_OFFLINE_STARS
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
    [starredKeys, offlineKeys, addMutation, removeMutation]
  );

  // Remove from offline watchlist by key
  const removeOfflineKey = useCallback((key: string) => {
    setOfflineKeys((prev) => prev.filter((k) => k !== key));
  }, []);

  return {
    // Auth state
    isAuthenticated: isLoggedIn(),
    
    // Watchlist operations
    isStarred,
    toggleWatchlist,
    removeOfflineKey,
    
    // Loading state
    isLoading: addMutation.isPending || removeMutation.isPending,
    
    // Offline mode info
    offlineCount: offlineKeys.length,
    maxOfflineStars: MAX_OFFLINE_STARS,
    offlineKeys,
  };
}
