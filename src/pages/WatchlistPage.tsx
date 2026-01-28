import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { StreakCard } from "@/components/StreakCard";
import { Footer } from "@/components/Footer";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Star, Trash2 } from "lucide-react";
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
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUserId(session?.user?.id ?? null);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const { data: watchlistWithStreaks, isLoading, error } = useQuery({
    queryKey: ["watchlist-with-streaks", userId],
    queryFn: async (): Promise<WatchlistWithStreak[]> => {
      if (!userId) return [];

      // Fetch watchlist items
      const { data: watchlistItems, error: watchlistError } = await supabase
        .from("watchlist_items")
        .select("*")
        .eq("user_id", userId)
        .eq("sport", "NBA")
        .order("created_at", { ascending: false });

      if (watchlistError) throw watchlistError;
      if (!watchlistItems || watchlistItems.length === 0) return [];

      // Fetch matching streaks for each watchlist item
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
    // Find the watchlist item for this streak and remove it
    const match = watchlistWithStreaks?.find(
      (w) =>
        w.streak &&
        w.streak.entity_type === streak.entity_type &&
        w.streak.player_id === streak.player_id &&
        w.streak.stat === streak.stat &&
        w.streak.threshold === streak.threshold
    );
    if (match) {
      handleRemove(match.watchlistItem.id);
    }
  };

  // Get bet label for inactive items
  const getBetLabel = (item: WatchlistItem) => {
    if (item.entity_type === "team") {
      if (item.stat === "ML") return "ML Wins";
      if (item.stat === "PTS") return `Team PTS ≥ ${item.threshold}`;
      if (item.stat === "PTS_U") return `Team PTS ≤ ${item.threshold}`;
    }
    return `${item.stat} ≥ ${item.threshold}`;
  };

  if (!userId) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <header className="px-4 py-4 border-b border-border">
          <h1 className="text-2xl font-bold text-foreground">
            ⭐ Watchlist
          </h1>
        </header>
        <main className="flex-1 px-4 py-8 pb-20">
          <div className="text-center py-12">
            <Star className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">Sign in to use the watchlist</p>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="px-4 py-4 border-b border-border">
        <h1 className="text-2xl font-bold text-foreground">
          ⭐ Watchlist
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Your saved streaks
        </p>
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
        ) : watchlistWithStreaks && watchlistWithStreaks.length > 0 ? (
          <div className="space-y-3">
            {watchlistWithStreaks.map(({ watchlistItem, streak }) =>
              streak ? (
                <StreakCard
                  key={watchlistItem.id}
                  streak={streak}
                  isStarred={true}
                  onToggleStar={handleToggleStar}
                  isAuthenticated={true}
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
                        onClick={() => handleRemove(watchlistItem.id)}
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
    </div>
  );
}
