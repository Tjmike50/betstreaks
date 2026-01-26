import { useState } from "react";
import { FilterBar } from "@/components/FilterBar";
import { StreakCard } from "@/components/StreakCard";
import { Footer } from "@/components/Footer";
import { useStreaks } from "@/hooks/useStreaks";
import { Skeleton } from "@/components/ui/skeleton";
import type { StreakFilters } from "@/types/streak";

const Index = () => {
  const [filters, setFilters] = useState<StreakFilters>({
    stat: "All",
    minStreak: 2,
    minSeasonWinPct: 0,
    playerSearch: "",
    advanced: false,
  });

  const { data: streaks, isLoading, error } = useStreaks(filters);

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
      </header>

      {/* Filters */}
      <FilterBar filters={filters} onFiltersChange={setFilters} />

      {/* Content */}
      <main className="flex-1 px-4 py-4">
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
              <StreakCard key={streak.id} streak={streak} />
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
    </div>
  );
};

export default Index;
