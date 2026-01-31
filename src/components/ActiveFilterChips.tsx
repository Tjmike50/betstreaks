import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { StreakFilters } from "@/types/streak";
import { getStatFriendlyLabel } from "@/lib/comboStats";

interface ActiveFilterChipsProps {
  filters: StreakFilters;
  onFiltersChange: (filters: StreakFilters) => void;
  onClearAll: () => void;
  entityType: "player" | "team";
}

interface FilterChip {
  label: string;
  onRemove: () => void;
}

export function ActiveFilterChips({ 
  filters, 
  onFiltersChange, 
  onClearAll,
  entityType,
}: ActiveFilterChipsProps) {
  const chips: FilterChip[] = [];

  // Stat filter (including combos)
  if (filters.stat !== "All") {
    const statLabel = getStatFriendlyLabel(filters.stat);
    chips.push({
      label: `Stat: ${statLabel}`,
      onRemove: () => onFiltersChange({ ...filters, stat: "All", thresholdMin: null, thresholdMax: null }),
    });
  }

  // Min streak
  if (filters.minStreak !== 2) {
    chips.push({
      label: `${filters.minStreak}+ streak`,
      onRemove: () => onFiltersChange({ ...filters, minStreak: 2 }),
    });
  }

  // Season win %
  if (filters.minSeasonWinPct !== 0) {
    chips.push({
      label: `≥${filters.minSeasonWinPct}% season`,
      onRemove: () => onFiltersChange({ ...filters, minSeasonWinPct: 0 }),
    });
  }

  // Threshold range
  if (filters.thresholdMin !== null) {
    chips.push({
      label: `Min: ${filters.thresholdMin}`,
      onRemove: () => onFiltersChange({ ...filters, thresholdMin: null }),
    });
  }
  if (filters.thresholdMax !== null) {
    chips.push({
      label: `Max: ${filters.thresholdMax}`,
      onRemove: () => onFiltersChange({ ...filters, thresholdMax: null }),
    });
  }

  // Team filter
  if (filters.teamFilter !== "All") {
    chips.push({
      label: `Team: ${filters.teamFilter}`,
      onRemove: () => onFiltersChange({ ...filters, teamFilter: "All" }),
    });
  }

  // Sort (not default)
  if (filters.sortBy !== "streak") {
    const sortLabels: Record<string, string> = {
      season: "Season %",
      l10: "L10 %",
      recent: "Recent",
      threshold: "Threshold",
      bestBetsScore: "Best Bets",
    };
    chips.push({
      label: `Sort: ${sortLabels[filters.sortBy] || filters.sortBy}`,
      onRemove: () => onFiltersChange({ ...filters, sortBy: "streak" }),
    });
  }

  // Recent only
  if (filters.recentOnly) {
    chips.push({
      label: "Last 3 days",
      onRemove: () => onFiltersChange({ ...filters, recentOnly: false }),
    });
  }

  // Best bets
  if (filters.bestBets) {
    chips.push({
      label: "Best Bets",
      onRemove: () => onFiltersChange({ ...filters, bestBets: false }),
    });
  }

  // Advanced (players only)
  if (entityType === "player" && filters.advanced) {
    chips.push({
      label: "Low thresholds",
      onRemove: () => onFiltersChange({ ...filters, advanced: false }),
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="px-4 py-2 flex flex-wrap gap-2 items-center border-t border-border bg-card/50">
      {chips.map((chip, index) => (
        <Badge 
          key={index} 
          variant="secondary" 
          className="flex items-center gap-1 pr-1 cursor-pointer hover:bg-secondary/80"
          onClick={chip.onRemove}
        >
          {chip.label}
          <X className="h-3 w-3" />
        </Badge>
      ))}
      <Button 
        variant="ghost" 
        size="sm" 
        onClick={onClearAll}
        className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
      >
        Clear all
      </Button>
    </div>
  );
}
