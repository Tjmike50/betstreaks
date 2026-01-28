import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { FilterBar } from "@/components/FilterBar";
import { StreakCard } from "@/components/StreakCard";
import { Footer } from "@/components/Footer";
import { SaveMorePicksModal } from "@/components/SaveMorePicksModal";
import { OnboardingFlow } from "@/components/OnboardingFlow";
import { useStreaks } from "@/hooks/useStreaks";
import { useWatchlist } from "@/hooks/useWatchlist";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { StreakFilters, Streak } from "@/types/streak";

const ONBOARDING_KEY = "onboarding_complete";

const STORAGE_KEY = "betstreaks-filters";

const DEFAULT_FILTERS: StreakFilters = {
  stat: "All",
  minStreak: 2,
  minSeasonWinPct: 0,
  playerSearch: "",
  advanced: false,
  entityType: "player",
  sortBy: "streak",
  bestBets: false,
  thresholdMin: null,
  thresholdMax: null,
  teamFilter: "All",
  recentOnly: false,
};

// Load filters from localStorage
function loadFilters(): StreakFilters {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...DEFAULT_FILTERS, ...parsed };
    }
  } catch (e) {
    console.error("Failed to load filters from localStorage", e);
  }
  return DEFAULT_FILTERS;
}

// Save filters to localStorage
function saveFilters(filters: StreakFilters) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  } catch (e) {
    console.error("Failed to save filters to localStorage", e);
  }
}

const Index = () => {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<StreakFilters>(loadFilters);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return localStorage.getItem(ONBOARDING_KEY) !== "true";
  });

  const { data: streaks, isLoading, error } = useStreaks(filters);
  const { isStarred, toggleWatchlist } = useWatchlist();

  const handleOnboardingComplete = () => {
    localStorage.setItem(ONBOARDING_KEY, "true");
    setShowOnboarding(false);
  };

  // Persist filters to localStorage whenever they change
  useEffect(() => {
    saveFilters(filters);
  }, [filters]);

  // Get unique team abbreviations for team filter dropdown
  const teamOptions = streaks
    ? Array.from(new Set(streaks.map((s) => s.team_abbr).filter(Boolean) as string[])).sort()
    : [];

  const handleFiltersChange = (newFilters: StreakFilters) => {
    setFilters(newFilters);
  };

  const handleClearFilters = () => {
    setFilters({ ...DEFAULT_FILTERS, entityType: filters.entityType });
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

  // Show onboarding if not completed
  if (showOnboarding) {
    return <OnboardingFlow onComplete={handleOnboardingComplete} />;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="px-4 py-4 border-b border-border">
        <h1 className="text-2xl font-bold text-foreground">
          🔥 BetStreaks
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Active NBA player prop streaks
        </p>
        <p className="text-xs text-muted-foreground mt-2">
          Use streaks to identify consistency — always compare with sportsbook lines before betting.
        </p>
      </header>

      {/* Sticky Section: Entity Type Tabs + Filters */}
      <div className="sticky top-0 z-20 bg-background">
        {/* Entity Type Tabs */}
        <div className="px-4 pt-3 pb-2">
          <Tabs
            value={filters.entityType}
            onValueChange={(value) => {
              const newEntityType = value as "player" | "team";
              const validTeamStats = ["All", "ML", "PTS", "PTS_U"];
              const validPlayerStats = ["All", "PTS", "AST", "REB", "3PM"];
              
              // Reset stat to "All" if current stat isn't valid for the new tab
              const newStat = newEntityType === "team" 
                ? (validTeamStats.includes(filters.stat) ? filters.stat : "All")
                : (validPlayerStats.includes(filters.stat) ? filters.stat : "All");
              
              setFilters({ ...filters, entityType: newEntityType, stat: newStat });
            }}
            className="w-full"
          >
            <TabsList className="w-full">
              <TabsTrigger value="player" className="flex-1">
                Players
              </TabsTrigger>
              <TabsTrigger value="team" className="flex-1">
                Teams
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Filters */}
        <FilterBar 
          filters={filters} 
          onFiltersChange={handleFiltersChange}
          onClearFilters={handleClearFilters}
          entityType={filters.entityType}
          isExpanded={filtersExpanded}
          onToggleExpanded={() => setFiltersExpanded(!filtersExpanded)}
          teamOptions={teamOptions}
        />
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
            <p className="text-destructive">Failed to load streaks</p>
            <p className="text-sm text-muted-foreground mt-2">
              Please try again later
            </p>
          </div>
        ) : streaks && streaks.length > 0 ? (
          <div className="space-y-3">
            {streaks.map((streak) => (
              <StreakCard
                key={streak.id}
                streak={streak}
                isStarred={isStarred(streak)}
                onToggleStar={handleToggleStar}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <p className="text-muted-foreground">No streaks found</p>
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
};

export default Index;
