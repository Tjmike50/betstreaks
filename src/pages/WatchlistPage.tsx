import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { StreakCard } from "@/components/StreakCard";
import { Footer } from "@/components/Footer";
import { SaveMorePicksModal } from "@/components/SaveMorePicksModal";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Star, Trash2 } from "lucide-react";
import { useWatchlist } from "@/hooks/useWatchlist";
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
  created_at: string;
}

interface WatchlistWithStreak {
  watchlistItem: WatchlistItem;
  streak: Streak | null;
}

export default function WatchlistPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [showLimitModal, setShowLimitModal] = useState(false);
  
  const { 
    isAuthenticated, 
    isStarred, 
    toggleWatchlist, 
    offlineCount, 
    maxOfflineStars,
    offlineKeys,
    removeOfflineKey
  } = useWatchlist();

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUserId(session?.user?.id ?? null);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Fetch authenticated user's watchlist with streaks
  const { data: watchlistWithStreaks, isLoading, error } = useQuery({
    queryKey: ["watchlist-with-streaks", userId],
    queryFn: async (): Promise<WatchlistWithStreak[]> => {
      if (!userId) return [];

      const { data: watchlistItems, error: watchlistError } = await supabase
        .from("watchlist_items")
        .select("*")
        .eq("user_id", userId)
        .eq("sport", "NBA")
        .order("created_at", { ascending: false });

      if (watchlistError) throw watchlistError;
      if (!watchlistItems || watchlistItems.length === 0) return [];

      const results: WatchlistWithStreak[] = [];

      for (const item of watchlistItems) {
        let query = supabase
          .from("streaks")
          .select("*")
          .eq("sport", "NBA")
          .eq("entity_type", item.entity_type)
          .eq("stat", item.stat)
          .eq("threshold", item.threshold);

        if (item.player_id) {
          query = query.eq("player_id", item.player_id);
        }
        if (item.team_abbr) {
          query = query.eq("team_abbr", item.team_abbr);
        }

        const { data: streaks } = await query.limit(1);

        results.push({
          watchlistItem: item as WatchlistItem,
          streak: streaks && streaks.length > 0 ? (streaks[0] as Streak) : null,
        });
      }

      return results;
    },
    enabled: !!userId,
  });

  // Fetch offline watchlist streaks
  const { data: offlineStreaks = [] } = useQuery({
    queryKey: ["offline-watchlist-streaks", offlineKeys],
    queryFn: async (): Promise<{ key: string; streak: Streak | null }[]> => {
      if (userId || offlineKeys.length === 0) return [];

      const results: { key: string; streak: Streak | null }[] = [];

      for (const key of offlineKeys) {
        const [entity_type, player_id, stat, threshold] = key.split("-");
        
        let query = supabase
          .from("streaks")
          .select("*")
          .eq("sport", "NBA")
          .eq("entity_type", entity_type)
          .eq("stat", stat)
          .eq("threshold", Number(threshold))
          .eq("player_id", Number(player_id));

        const { data: streaks } = await query.limit(1);

        results.push({
          key,
          streak: streaks && streaks.length > 0 ? (streaks[0] as Streak) : null,
        });
      }

      return results;
    },
    enabled: !userId && offlineKeys.length > 0,
  });

  const removeMutation = useMutation({
    mutationFn: async (watchlistItemId: string) => {
      const { error } = await supabase
        .from("watchlist_items")
        .delete()
        .eq("id", watchlistItemId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchlist-with-streaks", userId] });
      queryClient.invalidateQueries({ queryKey: ["watchlist", userId] });
    },
  });

  const handleRemove = (watchlistItemId: string) => {
    removeMutation.mutate(watchlistItemId);
  };

  const handleToggleStar = (streak: Streak) => {
    const result = toggleWatchlist(streak);
    if (result.limitReached) {
      setShowLimitModal(true);
    }
  };

  const handleLogin = () => {
    setShowLimitModal(false);
    navigate("/auth");
  };

  // Get bet label for inactive items
  const getBetLabel = (item: { entity_type: string; stat: string; threshold: number }) => {
    if (item.entity_type === "team") {
      if (item.stat === "ML") return "ML Wins";
      if (item.stat === "PTS") return `Team PTS ≥ ${item.threshold}`;
      if (item.stat === "PTS_U") return `Team PTS ≤ ${item.threshold}`;
    }
    return `${item.stat} ≥ ${item.threshold}`;
  };

  const parseKeyToItem = (key: string) => {
    const [entity_type, player_id, stat, threshold] = key.split("-");
    return { entity_type, player_id: Number(player_id), stat, threshold: Number(threshold) };
  };

  // Combine data for display
  const displayItems = isAuthenticated 
    ? (watchlistWithStreaks || [])
    : offlineStreaks.map(os => ({
        watchlistItem: { 
          id: os.key, 
          ...parseKeyToItem(os.key),
          user_id: "",
          sport: "NBA",
          team_abbr: null,
          created_at: ""
        } as WatchlistItem,
        streak: os.streak
      }));

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="px-4 py-4 border-b border-border">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              ⭐ Watchlist
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Your saved streaks
            </p>
          </div>
          {!isAuthenticated && (
            <div className="text-sm font-medium text-muted-foreground bg-muted px-3 py-1.5 rounded-lg">
              Saved: {offlineCount}/{maxOfflineStars}
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 px-4 py-4 pb-20">
        {isLoading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-36 w-full rounded-lg bg-card" />
            ))}
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <p className="text-destructive">Failed to load watchlist</p>
            <p className="text-sm text-muted-foreground mt-2">
              Please try again later
            </p>
          </div>
        ) : displayItems.length > 0 ? (
          <div className="space-y-3">
            {displayItems.map(({ watchlistItem, streak }) =>
              streak ? (
                <StreakCard
                  key={watchlistItem.id}
                  streak={streak}
                  isStarred={true}
                  onToggleStar={handleToggleStar}
                />
              ) : (
                <Card
                  key={watchlistItem.id}
                  className="bg-card/50 border-border opacity-60"
                >
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <h3 className="text-lg font-bold text-muted-foreground">
                          {watchlistItem.entity_type === "team"
                            ? watchlistItem.team_abbr
                            : `Player #${watchlistItem.player_id}`}
                        </h3>
                        <div className="inline-flex items-center gap-2 bg-muted text-muted-foreground px-3 py-1.5 rounded-lg">
                          <span className="font-semibold">
                            {getBetLabel(watchlistItem)}
                          </span>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => {
                          if (isAuthenticated) {
                            handleRemove(watchlistItem.id);
                          } else {
                            removeOfflineKey(watchlistItem.id);
                          }
                        }}
                      >
                        <Trash2 className="h-5 w-5" />
                      </Button>
                    </div>
                    <p className="text-sm text-muted-foreground italic">
                      Streak no longer active
                    </p>
                  </CardContent>
                </Card>
              )
            )}
          </div>
        ) : (
          <div className="text-center py-12">
            <Star className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No items in watchlist</p>
            <p className="text-sm text-muted-foreground mt-2">
              Tap the star on any streak to save it
            </p>
          </div>
        )}
      </main>

      <Footer />

      <SaveMorePicksModal
        open={showLimitModal}
        onOpenChange={setShowLimitModal}
        onLogin={handleLogin}
      />
    </div>
  );
}
