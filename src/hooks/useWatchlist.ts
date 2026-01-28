import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Streak } from "@/types/streak";

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

export function useWatchlist() {
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);

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

  // Fetch watchlist items for NBA
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

  // Create a Set for fast lookup
  const starredKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const item of watchlistItems) {
      keys.add(`${item.entity_type}-${item.player_id}-${item.stat}-${item.threshold}`);
    }
    return keys;
  }, [watchlistItems]);

  // Check if a streak is starred
  const isStarred = useCallback(
    (streak: Pick<Streak, "entity_type" | "player_id" | "stat" | "threshold">): boolean => {
      return starredKeys.has(getStreakKey(streak));
    },
    [starredKeys]
  );

  // Add to watchlist
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

  // Remove from watchlist
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

  // Toggle watchlist status
  const toggleWatchlist = useCallback(
    (streak: Streak) => {
      if (!userId) return;

      if (isStarred(streak)) {
        removeMutation.mutate(streak);
      } else {
        addMutation.mutate(streak);
      }
    },
    [userId, isStarred, addMutation, removeMutation]
  );

  return {
    isAuthenticated: !!userId,
    isStarred,
    toggleWatchlist,
    isLoading: addMutation.isPending || removeMutation.isPending,
  };
}
