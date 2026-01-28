import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { StreakCard } from "@/components/StreakCard";
import { Footer } from "@/components/Footer";
import { SaveMorePicksModal } from "@/components/SaveMorePicksModal";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Star, Trash2, Cloud, LogIn, BellRing } from "lucide-react";
import { useWatchlist } from "@/hooks/useWatchlist";
import { PremiumBadge } from "@/components/PremiumBadge";
import { PremiumLockModal } from "@/components/PremiumLockModal";
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

// Create a match key for comparing watchlist items to streaks
function getMatchKey(item: { entity_type: string; player_id: number | null; stat: string; threshold: number }): string {
  return `${item.entity_type}-${item.player_id}-${item.stat}-${item.threshold}`;
}

interface WatchlistData {
  activeItems: { watchlistItem: WatchlistItem; streak: Streak }[];
  inactiveItems: WatchlistItem[];
}

export default function WatchlistPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  
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

  // Optimized: Fetch watchlist items and all NBA streaks in parallel, then match client-side
  const { data: watchlistData, isLoading, error } = useQuery({
    queryKey: ["watchlist-optimized", userId],
    queryFn: async (): Promise<WatchlistData> => {
      if (!userId) return { activeItems: [], inactiveItems: [] };

      // Fetch watchlist items and all NBA streaks in parallel
      const [watchlistResult, streaksResult] = await Promise.all([
        supabase
          .from("watchlist_items")
          .select("*")
          .eq("user_id", userId)
          .eq("sport", "NBA")
          .order("created_at", { ascending: false }),
        supabase
          .from("streaks")
          .select("*")
          .eq("sport", "NBA")
      ]);

      if (watchlistResult.error) throw watchlistResult.error;
      if (!watchlistResult.data || watchlistResult.data.length === 0) {
        return { activeItems: [], inactiveItems: [] };
      }

      const watchlistItems = watchlistResult.data as WatchlistItem[];
      const allStreaks = (streaksResult.data || []) as Streak[];

      // Build a lookup map of streaks by match key
      const streakMap = new Map<string, Streak>();
      for (const streak of allStreaks) {
        const key = getMatchKey(streak);
        streakMap.set(key, streak);
      }

      // Match watchlist items to streaks
      const activeItems: { watchlistItem: WatchlistItem; streak: Streak }[] = [];
      const inactiveItems: WatchlistItem[] = [];

      for (const item of watchlistItems) {
        const key = getMatchKey(item);
        const matchingStreak = streakMap.get(key);
        
        if (matchingStreak) {
          activeItems.push({ watchlistItem: item, streak: matchingStreak });
        } else {
          inactiveItems.push(item);
        }
      }

      return { activeItems, inactiveItems };
    },
    enabled: !!userId,
  });

  // Optimized: Fetch offline watchlist streaks with batch query
  const { data: offlineData } = useQuery({
    queryKey: ["offline-watchlist-optimized", offlineKeys],
    queryFn: async (): Promise<WatchlistData> => {
      if (userId || offlineKeys.length === 0) return { activeItems: [], inactiveItems: [] };

      // Fetch all NBA streaks in one query
      const { data: allStreaks } = await supabase
        .from("streaks")
        .select("*")
        .eq("sport", "NBA");

      const streakMap = new Map<string, Streak>();
      for (const streak of (allStreaks || []) as Streak[]) {
        const key = getMatchKey(streak);
        streakMap.set(key, streak);
      }

      const activeItems: { watchlistItem: WatchlistItem; streak: Streak }[] = [];
      const inactiveItems: WatchlistItem[] = [];

      for (const key of offlineKeys) {
        const [entity_type, player_id, stat, threshold] = key.split("-");
        const item: WatchlistItem = {
          id: key,
          user_id: "",
          sport: "NBA",
          entity_type,
          player_id: Number(player_id),
          team_abbr: null,
          stat,
          threshold: Number(threshold),
          created_at: "",
        };

        const matchingStreak = streakMap.get(key);
        if (matchingStreak) {
          activeItems.push({ watchlistItem: item, streak: matchingStreak });
        } else {
          inactiveItems.push(item);
        }
      }

      return { activeItems, inactiveItems };
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
      queryClient.invalidateQueries({ queryKey: ["watchlist-optimized", userId] });
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

  // Use optimized data structure
  const currentData = isAuthenticated ? watchlistData : offlineData;
  const activeItems = currentData?.activeItems || [];
  const inactiveItems = currentData?.inactiveItems || [];
  const hasItems = activeItems.length > 0 || inactiveItems.length > 0;

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
          {isAuthenticated ? (
            <Badge variant="secondary" className="gap-1.5 py-1 px-2.5">
              <Cloud className="h-3.5 w-3.5" />
              Synced
            </Badge>
          ) : (
            <div className="flex flex-col items-end gap-1">
              <div className="text-sm font-medium text-muted-foreground bg-muted px-3 py-1.5 rounded-lg">
                Saved {offlineCount}/{maxOfflineStars}
              </div>
              <Link
                to="/auth"
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                <LogIn className="h-3 w-3" />
                Log in for unlimited
              </Link>
            </div>
          )}
        </div>
        
        {/* Instant Alerts - Premium Feature */}
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
          <div className="flex items-center gap-2">
            <BellRing className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Instant alerts</span>
            <PremiumBadge />
          </div>
          <Switch
            checked={false}
            onCheckedChange={() => setShowPremiumModal(true)}
          />
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
        ) : hasItems ? (
          <div className="space-y-6">
            {/* Active Streaks */}
            {activeItems.length > 0 && (
              <div className="space-y-3">
                {activeItems.map(({ watchlistItem, streak }) => (
                  <StreakCard
                    key={watchlistItem.id}
                    streak={streak}
                    isStarred={true}
                    onToggleStar={handleToggleStar}
                  />
                ))}
              </div>
            )}

            {/* Inactive Saved Picks */}
            {inactiveItems.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Inactive saved picks
                </h2>
                {inactiveItems.map((item) => (
                  <Card
                    key={item.id}
                    className="bg-card/50 border-border"
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="space-y-1.5">
                          <h3 className="text-base font-semibold text-muted-foreground">
                            {item.entity_type === "team"
                              ? item.team_abbr || "Team"
                              : `Player #${item.player_id}`}
                          </h3>
                          <div className="inline-flex items-center gap-2 bg-muted text-muted-foreground px-2.5 py-1 rounded-md text-sm">
                            <span className="font-medium">
                              {getBetLabel(item)}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground italic">
                            Streak no longer active
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5"
                          onClick={() => {
                            if (isAuthenticated) {
                              handleRemove(item.id);
                            } else {
                              removeOfflineKey(item.id);
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                          Remove
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
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
      
      <PremiumLockModal
        open={showPremiumModal}
        onOpenChange={setShowPremiumModal}
      />
    </div>
  );
}
