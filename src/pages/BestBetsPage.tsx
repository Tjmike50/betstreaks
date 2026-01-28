import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { StreakCard } from "@/components/StreakCard";
import { Footer } from "@/components/Footer";
import { SaveMorePicksModal } from "@/components/SaveMorePicksModal";
import { useWatchlist } from "@/hooks/useWatchlist";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp, Trophy } from "lucide-react";
import type { Streak } from "@/types/streak";
import { calculateBestBetsScore } from "@/types/streak";

const STORAGE_KEY = "betstreaks-bestbets-filters";

interface BestBetsFilters {
  minStreak: number;
  minL10Pct: number;
  maxDaysAgo: number;
  showPlayers: boolean;
  showTeams: boolean;
}

const DEFAULT_FILTERS: BestBetsFilters = {
  minStreak: 3,
  minL10Pct: 60,
  maxDaysAgo: 5,
  showPlayers: true,
  showTeams: true,
};

function loadFilters(): BestBetsFilters {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...DEFAULT_FILTERS, ...JSON.parse(stored) };
    }
  } catch (e) {
    console.error("Failed to load best bets filters", e);
  }
  return DEFAULT_FILTERS;
}

function saveFilters(filters: BestBetsFilters) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  } catch (e) {
    console.error("Failed to save best bets filters", e);
  }
}

function getDaysAgoDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split("T")[0];
}

export default function BestBetsPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<BestBetsFilters>(loadFilters);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [showLimitModal, setShowLimitModal] = useState(false);
  const { isStarred, toggleWatchlist } = useWatchlist();

  // Persist filters
  useEffect(() => {
    saveFilters(filters);
  }, [filters]);

  // Fetch all streaks and filter/sort client-side
  const { data: streaks, isLoading, error } = useQuery({
    queryKey: ["bestBets", filters],
    queryFn: async () => {
      const cutoffDate = getDaysAgoDate(filters.maxDaysAgo);

      // Fetch both players and teams in one query
      const { data, error } = await supabase
        .from("streaks")
        .select("*")
        .gte("streak_len", filters.minStreak)
        .gte("last_game", cutoffDate)
        .order("streak_len", { ascending: false });

      if (error) throw error;

      let results = data as Streak[];

      // Filter by L10 hit %
      results = results.filter((s) => (s.last10_hit_pct ?? 0) >= filters.minL10Pct);

      // Filter by entity type
      if (!filters.showPlayers) {
        results = results.filter((s) => s.entity_type !== "player");
      }
      if (!filters.showTeams) {
        results = results.filter((s) => s.entity_type !== "team");
      }

      // Sort by Best Bets score
      results.sort((a, b) => {
        const scoreA = calculateBestBetsScore(a);
        const scoreB = calculateBestBetsScore(b);
        return scoreB - scoreA;
      });

      // Limit to top 50
      return results.slice(0, 50);
    },
  });

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

  const handleResetFilters = () => {
    setFilters(DEFAULT_FILTERS);
  };

  const hasCustomFilters =
    filters.minStreak !== DEFAULT_FILTERS.minStreak ||
    filters.minL10Pct !== DEFAULT_FILTERS.minL10Pct ||
    filters.maxDaysAgo !== DEFAULT_FILTERS.maxDaysAgo ||
    filters.showPlayers !== DEFAULT_FILTERS.showPlayers ||
    filters.showTeams !== DEFAULT_FILTERS.showTeams;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="px-4 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Trophy className="h-6 w-6 text-amber-500" />
          <h1 className="text-2xl font-bold text-foreground">Best Bets</h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Top 50 high-confidence picks across all players & teams
        </p>
      </header>

      {/* Collapsible Filters */}
      <div className="bg-background border-b border-border">
        <button
          onClick={() => setFiltersExpanded(!filtersExpanded)}
          className="w-full px-4 py-3 flex items-center justify-between text-sm"
        >
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Filters</span>
            {hasCustomFilters && (
              <Badge variant="secondary" className="text-xs">
                Custom
              </Badge>
            )}
          </div>
          {filtersExpanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>

        {filtersExpanded && (
          <div className="px-4 pb-4 space-y-4 animate-in slide-in-from-top-2 duration-200">
            {/* Min Streak */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Min streak:</span>
                <span className="text-sm font-medium text-primary">{filters.minStreak}+</span>
              </div>
              <Slider
                value={[filters.minStreak]}
                onValueChange={([value]) => setFilters({ ...filters, minStreak: value })}
                min={2}
                max={10}
                step={1}
                className="py-2"
              />
            </div>

            {/* Min L10 % */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Min L10 hit%:</span>
                <span className="text-sm font-medium text-primary">{filters.minL10Pct}%</span>
              </div>
              <Slider
                value={[filters.minL10Pct]}
                onValueChange={([value]) => setFilters({ ...filters, minL10Pct: value })}
                min={0}
                max={100}
                step={5}
                className="py-2"
              />
            </div>

            {/* Max Days Ago */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Last game within:</span>
                <span className="text-sm font-medium text-primary">{filters.maxDaysAgo} days</span>
              </div>
              <Slider
                value={[filters.maxDaysAgo]}
                onValueChange={([value]) => setFilters({ ...filters, maxDaysAgo: value })}
                min={1}
                max={14}
                step={1}
                className="py-2"
              />
            </div>

            {/* Entity Type Toggles */}
            <div className="space-y-3 pt-2 border-t border-border">
              <div className="flex items-center justify-between">
                <Label htmlFor="show-players" className="text-sm text-muted-foreground cursor-pointer">
                  Show Players
                </Label>
                <Switch
                  id="show-players"
                  checked={filters.showPlayers}
                  onCheckedChange={(checked) => setFilters({ ...filters, showPlayers: checked })}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="show-teams" className="text-sm text-muted-foreground cursor-pointer">
                  Show Teams
                </Label>
                <Switch
                  id="show-teams"
                  checked={filters.showTeams}
                  onCheckedChange={(checked) => setFilters({ ...filters, showTeams: checked })}
                />
              </div>
            </div>

            {/* Reset Button */}
            {hasCustomFilters && (
              <Button variant="outline" onClick={handleResetFilters} className="w-full">
                Reset to defaults
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      <main className="flex-1 px-4 py-4 pb-20">
        {isLoading ? (
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-36 w-full rounded-lg bg-card" />
            ))}
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <p className="text-destructive">Failed to load best bets</p>
            <p className="text-sm text-muted-foreground mt-2">Please try again later</p>
          </div>
        ) : streaks && streaks.length > 0 ? (
          <>
            <p className="text-xs text-muted-foreground mb-3">
              Showing {streaks.length} best bets sorted by score
            </p>
            <div className="space-y-3">
              {streaks.map((streak, index) => (
                <div key={streak.id} className="relative">
                  {/* Rank badge */}
                  {index < 3 && (
                    <div
                      className={`absolute -left-1 -top-1 z-10 h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        index === 0
                          ? "bg-amber-500 text-black"
                          : index === 1
                          ? "bg-gray-300 text-black"
                          : "bg-amber-700 text-white"
                      }`}
                    >
                      {index + 1}
                    </div>
                  )}
                  <StreakCard
                    streak={streak}
                    isStarred={isStarred(streak)}
                    onToggleStar={handleToggleStar}
                  />
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="text-center py-12">
            <Trophy className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No best bets found</p>
            <p className="text-sm text-muted-foreground mt-2">
              Try adjusting your filters
            </p>
          </div>
        )}
      </main>

      {/* Footer */}
      <Footer />

      {/* Save More Picks Modal */}
      <SaveMorePicksModal
        open={showLimitModal}
        onOpenChange={setShowLimitModal}
        onLogin={handleLogin}
      />
    </div>
  );
}
