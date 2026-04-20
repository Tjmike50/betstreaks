import { Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { StreakCard } from "@/components/StreakCard";
import { Footer } from "@/components/Footer";
import { SaveMorePicksModal } from "@/components/SaveMorePicksModal";
import { DataFreshnessIndicator } from "@/components/DataFreshnessIndicator";
import { EarlyAccessBanner } from "@/components/EarlyAccessBanner";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Star, Trash2, Cloud, LogIn, BellRing, Loader2 } from "lucide-react";
import { useWatchlist } from "@/hooks/useWatchlist";
import { useAuth } from "@/contexts/AuthContext";
import { useSport } from "@/contexts/SportContext";
import { PremiumBadge } from "@/components/PremiumBadge";
import { PremiumLockModal } from "@/components/PremiumLockModal";
import type { Streak } from "@/types/streak";
import { useState } from "react";

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
  const { user, isAuthenticated, isLoading: isAuthLoading, email } = useAuth();
  const { sport } = useSport();
  const userId = user?.id ?? null;
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  
  const { 
    isStarred, 
    toggleWatchlist, 
    offlineCount, 
    maxOfflineStars,
    offlineKeys,
    removeOfflineKey
  } = useWatchlist();

  // Sportsbook-line-first: match watchlist items against live line-first
  // streaks (built from line_snapshots) instead of the legacy streaks table.
  const { data: watchlistData, isLoading, error } = useQuery({
    queryKey: ["watchlist-line-first", userId, sport],
    queryFn: async (): Promise<WatchlistData> => {
      if (!userId) return { activeItems: [], inactiveItems: [] };

      const { buildBookableLines, computeLineSplits, mlbHitterValue, mlbPitcherValue, nbaStatValue } = await import("@/lib/lineFirstStreaks");

      const since = new Date();
      since.setDate(since.getDate() - 1);
      const sinceDate = since.toISOString().slice(0, 10);

      const [watchlistResult, linesResult] = await Promise.all([
        supabase
          .from("watchlist_items")
          .select("*")
          .eq("user_id", userId)
          .eq("sport", sport)
          .order("created_at", { ascending: false }),
        supabase
          .from("line_snapshots")
          .select("player_id, player_name, stat_type, threshold, game_date, sportsbook")
          .gte("game_date", sinceDate)
          .limit(20000),
      ]);

      if (watchlistResult.error) throw watchlistResult.error;
      const watchlistItems = (watchlistResult.data ?? []) as WatchlistItem[];
      if (watchlistItems.length === 0) {
        return { activeItems: [], inactiveItems: [] };
      }

      const bookableLines = buildBookableLines((linesResult.data ?? []) as Parameters<typeof buildBookableLines>[0]);
      // Index lines by player_id|stat for fast lookup
      const lineByKey = new Map<string, typeof bookableLines[number]>();
      for (const l of bookableLines) {
        if (l.player_id != null) lineByKey.set(`${l.player_id}-${l.stat_code}`, l);
      }

      // Pull recent game logs once per sport
      const playerIds = [...new Set(watchlistItems.map((w) => w.player_id).filter((x): x is number => x != null))];
      const today = new Date().toISOString().slice(0, 10);
      const activeItems: { watchlistItem: WatchlistItem; streak: Streak }[] = [];
      const inactiveItems: WatchlistItem[] = [];

      if (playerIds.length === 0) {
        return { activeItems, inactiveItems: watchlistItems };
      }

      type NbaRow = { player_id: number; game_date: string; pts: number | null; reb: number | null; ast: number | null; fg3m: number | null; blk: number | null; stl: number | null };
      type HitterRow = { player_id: number; game_date: string; hits: number | null; total_bases: number | null; home_runs: number | null };
      type PitcherRow = { player_id: number; game_date: string; strikeouts: number | null; earned_runs_allowed: number | null; walks_allowed: number | null; hits_allowed: number | null };
      const nbaLogs = new Map<number, Omit<NbaRow, "player_id">[]>();
      const mlbHitter = new Map<number, Omit<HitterRow, "player_id">[]>();
      const mlbPitcher = new Map<number, Omit<PitcherRow, "player_id">[]>();

      if (sport === "MLB") {
        const [h, p] = await Promise.all([
          supabase.from("mlb_hitter_game_logs").select("player_id, game_date, hits, total_bases, home_runs").in("player_id", playerIds).order("game_date", { ascending: false }).limit(5000),
          supabase.from("mlb_pitcher_game_logs").select("player_id, game_date, strikeouts, earned_runs_allowed, walks_allowed, hits_allowed").in("player_id", playerIds).order("game_date", { ascending: false }).limit(5000),
        ]);
        for (const r of (h.data ?? []) as HitterRow[]) {
          const arr = mlbHitter.get(r.player_id) ?? []; arr.push(r); mlbHitter.set(r.player_id, arr);
        }
        for (const r of (p.data ?? []) as PitcherRow[]) {
          const arr = mlbPitcher.get(r.player_id) ?? []; arr.push(r); mlbPitcher.set(r.player_id, arr);
        }
      } else {
        const { data } = await supabase.from("player_recent_games").select("player_id, game_date, pts, reb, ast, fg3m, blk, stl").in("player_id", playerIds).order("game_date", { ascending: false }).limit(5000);
        for (const r of (data ?? []) as NbaRow[]) {
          const arr = nbaLogs.get(r.player_id) ?? []; arr.push(r); nbaLogs.set(r.player_id, arr);
        }
      }

      for (const item of watchlistItems) {
        if (item.player_id == null) { inactiveItems.push(item); continue; }
        const line = lineByKey.get(`${item.player_id}-${item.stat}`);
        if (!line) { inactiveItems.push(item); continue; }
        let values: (number | null)[] = [];
        let dates: string[] = [];
        if (sport === "MLB") {
          const hl = mlbHitter.get(item.player_id);
          const pl = mlbPitcher.get(item.player_id);
          if (hl && hl.length) { values = hl.map((g) => mlbHitterValue(g, line.stat_code)); dates = hl.map((g) => g.game_date); }
          else if (pl && pl.length) { values = pl.map((g) => mlbPitcherValue(g, line.stat_code)); dates = pl.map((g) => g.game_date); }
        } else {
          const games = nbaLogs.get(item.player_id) ?? [];
          values = games.map((g) => nbaStatValue(g, line.stat_code));
          dates = games.map((g) => g.game_date);
        }
        const splits = computeLineSplits(values, dates, line.main_threshold);
        if (splits.season_games === 0 || splits.streak_len === 0) { inactiveItems.push(item); continue; }
        activeItems.push({
          watchlistItem: item,
          streak: {
            id: `lf-${item.player_id}-${line.stat_code}-${line.main_threshold}`,
            player_id: item.player_id,
            player_name: line.player_name,
            team_abbr: item.team_abbr,
            stat: line.stat_code,
            threshold: line.main_threshold,
            streak_len: splits.streak_len,
            streak_start: splits.streak_start || today,
            streak_win_pct: 100,
            season_wins: splits.season_wins,
            season_games: splits.season_games,
            season_win_pct: splits.season_win_pct,
            last_game: splits.last_game || today,
            sport,
            entity_type: "player",
            updated_at: today,
            last10_hits: splits.last10_hits,
            last10_games: splits.last10_games,
            last10_hit_pct: splits.last10_hit_pct,
            last5_hits: splits.last5_hits,
            last5_games: splits.last5_games,
            last5_hit_pct: splits.last5_hit_pct,
            book_threshold: line.main_threshold,
            book_main_threshold: line.main_threshold,
            book_informational: false,
          },
        });
      }

      return { activeItems, inactiveItems };
    },
    enabled: !!userId,
  });

  // Optimized: Fetch offline watchlist streaks with batch query
  const { data: offlineData } = useQuery({
    queryKey: ["offline-watchlist-optimized", sport, offlineKeys],
    queryFn: async (): Promise<WatchlistData> => {
      if (userId || offlineKeys.length === 0) return { activeItems: [], inactiveItems: [] };

      // Fetch all streaks for this sport in one query
      const { data: allStreaks } = await supabase
        .from("streaks")
        .select("*")
        .eq("sport", sport);

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
          sport,
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

  // Show loading state while auth initializes
  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center pb-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

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
            {isAuthenticated && email && (
              <p className="text-xs text-muted-foreground">
                Logged in as {email}
              </p>
            )}
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
          
          {/* Data Freshness Indicator */}
          <div className="mt-3 pt-3 border-t border-border">
            <DataFreshnessIndicator />
          </div>
        </div>
      </header>

      {/* Early Access Banner */}
      <EarlyAccessBanner />

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
