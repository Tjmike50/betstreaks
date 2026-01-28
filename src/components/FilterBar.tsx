import { useEffect, useRef } from "react";
import { Search, SlidersHorizontal, X, Clock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { StreakFilters, SortOption } from "@/types/streak";
import { THRESHOLD_RANGES } from "@/types/streak";
import { ActiveFilterChips } from "@/components/ActiveFilterChips";

interface FilterBarProps {
  filters: StreakFilters;
  onFiltersChange: (filters: StreakFilters) => void;
  onClearFilters: () => void;
  entityType: "player" | "team";
  isExpanded: boolean;
  onToggleExpanded: () => void;
  teamOptions: string[];
}

const PLAYER_STAT_OPTIONS = ["All", "PTS", "AST", "REB", "3PM"];

// Team stat options with display labels mapped to DB values
const TEAM_STAT_OPTIONS = [
  { label: "All", value: "All" },
  { label: "ML", value: "ML" },
  { label: "Team PTS Over", value: "PTS" },
  { label: "Team PTS Under", value: "PTS_U" },
];
const STREAK_OPTIONS = [2, 3, 4, 5, 6, 7, 10];

const SORT_OPTIONS: { label: string; value: SortOption }[] = [
  { label: "Longest streak", value: "streak" },
  { label: "Best season hit%", value: "season" },
  { label: "Best L10 hit%", value: "l10" },
  { label: "Highest threshold", value: "threshold" },
  { label: "Best Bets score", value: "bestBetsScore" },
  { label: "Most recent", value: "recent" },
];

// Calculate active filter count
function getActiveFilterCount(filters: StreakFilters, entityType: "player" | "team"): number {
  let count = 0;
  if (filters.stat !== "All") count++;
  if (filters.minStreak !== 2) count++;
  if (filters.minSeasonWinPct !== 0) count++;
  if (entityType === "player" && filters.advanced) count++;
  if (filters.sortBy !== "streak") count++;
  if (filters.bestBets) count++;
  if (filters.thresholdMin !== null) count++;
  if (filters.thresholdMax !== null) count++;
  if (filters.teamFilter !== "All") count++;
  if (filters.recentOnly) count++;
  return count;
}

export function FilterBar({ 
  filters, 
  onFiltersChange,
  onClearFilters,
  entityType, 
  isExpanded, 
  onToggleExpanded,
  teamOptions,
}: FilterBarProps) {
  const isTeam = entityType === "team";
  const searchPlaceholder = isTeam ? "Search team..." : "Search player...";
  const activeFilterCount = getActiveFilterCount(filters, entityType);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Get threshold range for current stat
  const currentThresholdRange = filters.stat !== "All" && filters.stat !== "ML" 
    ? THRESHOLD_RANGES[filters.stat] 
    : null;

  // Close on scroll
  useEffect(() => {
    if (!isExpanded) return;

    const handleScroll = () => {
      if (window.scrollY > 50) {
        onToggleExpanded();
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [isExpanded, onToggleExpanded]);

  // Close on click outside
  useEffect(() => {
    if (!isExpanded) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (drawerRef.current && !drawerRef.current.contains(event.target as Node)) {
        onToggleExpanded();
      }
    };

    // Delay to prevent immediate close on button click
    const timeout = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timeout);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isExpanded, onToggleExpanded]);

  return (
    <div ref={drawerRef} className="bg-background border-b border-border">
      {/* Sticky Top Bar: Search + Filters Button */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 px-4 py-3 flex gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={searchPlaceholder}
            value={filters.playerSearch}
            onChange={(e) =>
              onFiltersChange({ ...filters, playerSearch: e.target.value })
            }
            className="pl-10 h-10 bg-card border-border text-foreground placeholder:text-muted-foreground"
          />
        </div>

        {/* Filters Toggle Button */}
        <Button
          variant={isExpanded ? "default" : "outline"}
          size="default"
          onClick={onToggleExpanded}
          className="shrink-0 gap-2"
        >
          {isExpanded ? (
            <X className="h-4 w-4" />
          ) : (
            <SlidersHorizontal className="h-4 w-4" />
          )}
          <span>Filters</span>
          {activeFilterCount > 0 && !isExpanded && (
            <Badge variant="secondary" className="ml-1 h-5 w-5 p-0 flex items-center justify-center text-xs">
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      </div>

      {/* Active Filter Chips (always visible when filters are applied) */}
      {activeFilterCount > 0 && !isExpanded && (
        <ActiveFilterChips 
          filters={filters} 
          onFiltersChange={onFiltersChange}
          onClearAll={onClearFilters}
          entityType={entityType}
        />
      )}

      {/* Expandable Filters Drawer */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-4 animate-in slide-in-from-top-2 duration-200">
          {/* Stat Dropdown */}
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground whitespace-nowrap">Stat:</span>
            <Select
              value={filters.stat}
              onValueChange={(value) => onFiltersChange({ 
                ...filters, 
                stat: value,
                // Reset threshold range when stat changes
                thresholdMin: null,
                thresholdMax: null,
              })}
            >
              <SelectTrigger className="h-10 bg-card border-border flex-1">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                {isTeam ? (
                  TEAM_STAT_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} className="text-foreground">
                      {opt.label}
                    </SelectItem>
                  ))
                ) : (
                  PLAYER_STAT_OPTIONS.map((stat) => (
                    <SelectItem key={stat} value={stat} className="text-foreground">
                      {stat}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Threshold Range Inputs (only show when a specific stat is selected) */}
          {currentThresholdRange && (
            <div className="space-y-2">
              <span className="text-sm text-muted-foreground">Threshold range:</span>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  placeholder={`Min (${currentThresholdRange.min})`}
                  value={filters.thresholdMin ?? ""}
                  onChange={(e) => onFiltersChange({ 
                    ...filters, 
                    thresholdMin: e.target.value ? Number(e.target.value) : null 
                  })}
                  min={currentThresholdRange.min}
                  max={currentThresholdRange.max}
                  className="h-10 bg-card border-border flex-1"
                />
                <span className="text-muted-foreground">to</span>
                <Input
                  type="number"
                  placeholder={`Max (${currentThresholdRange.max})`}
                  value={filters.thresholdMax ?? ""}
                  onChange={(e) => onFiltersChange({ 
                    ...filters, 
                    thresholdMax: e.target.value ? Number(e.target.value) : null 
                  })}
                  min={currentThresholdRange.min}
                  max={currentThresholdRange.max}
                  className="h-10 bg-card border-border flex-1"
                />
              </div>
            </div>
          )}

          {/* Team Filter Dropdown */}
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground whitespace-nowrap">Team:</span>
            <Select
              value={filters.teamFilter}
              onValueChange={(value) => onFiltersChange({ ...filters, teamFilter: value })}
            >
              <SelectTrigger className="h-10 bg-card border-border flex-1">
                <SelectValue placeholder="All teams" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border max-h-60">
                <SelectItem value="All" className="text-foreground">All teams</SelectItem>
                {teamOptions.map((team) => (
                  <SelectItem key={team} value={team} className="text-foreground">
                    {team}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Min Streak Buttons */}
          <div className="space-y-2">
            <span className="text-sm text-muted-foreground">Min streak:</span>
            <div className="flex gap-2 flex-wrap">
              {STREAK_OPTIONS.map((num) => (
                <button
                  key={num}
                  onClick={() => onFiltersChange({ ...filters, minStreak: num })}
                  className={`px-3 h-10 rounded-lg font-medium transition-colors ${
                    filters.minStreak === num
                      ? "bg-primary text-primary-foreground"
                      : "bg-card text-foreground hover:bg-secondary"
                  }`}
                >
                  {num}+
                </button>
              ))}
            </div>
          </div>

          {/* Season Win % Slider */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Min season win%:</span>
              <span className="text-sm font-medium text-primary">
                {filters.minSeasonWinPct}%
              </span>
            </div>
            <Slider
              value={[filters.minSeasonWinPct]}
              onValueChange={([value]) =>
                onFiltersChange({ ...filters, minSeasonWinPct: value })
              }
              min={0}
              max={100}
              step={5}
              className="py-2"
            />
          </div>

          {/* Sort Dropdown */}
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground whitespace-nowrap">Sort by:</span>
            <Select
              value={filters.sortBy}
              onValueChange={(value) => onFiltersChange({ ...filters, sortBy: value as SortOption })}
            >
              <SelectTrigger className="h-10 bg-card border-border flex-1">
                <SelectValue placeholder="Longest streak" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                {SORT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="text-foreground">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Toggles Section */}
          <div className="space-y-3 pt-2 border-t border-border">
            {/* Recent Only Toggle */}
            <div className="flex items-center justify-between">
              <Label
                htmlFor="recent-toggle"
                className="text-sm text-muted-foreground cursor-pointer flex items-center gap-2"
              >
                <Clock className="h-4 w-4" />
                Only last 3 days
              </Label>
              <Switch
                id="recent-toggle"
                checked={filters.recentOnly}
                onCheckedChange={(checked) =>
                  onFiltersChange({ ...filters, recentOnly: checked })
                }
              />
            </div>

            {/* Best Bets Toggle */}
            <div className="flex items-center justify-between">
              <Label
                htmlFor="best-bets-toggle"
                className="text-sm text-muted-foreground cursor-pointer"
              >
                Best Bets (55%+ season, 3+ streak)
              </Label>
              <Switch
                id="best-bets-toggle"
                checked={filters.bestBets}
                onCheckedChange={(checked) =>
                  onFiltersChange({ ...filters, bestBets: checked })
                }
              />
            </div>

            {/* Advanced Toggle - only show for players */}
            {!isTeam && (
              <div className="flex items-center justify-between">
                <Label
                  htmlFor="advanced-toggle"
                  className="text-sm text-muted-foreground cursor-pointer"
                >
                  Show low thresholds
                </Label>
                <Switch
                  id="advanced-toggle"
                  checked={filters.advanced}
                  onCheckedChange={(checked) =>
                    onFiltersChange({ ...filters, advanced: checked })
                  }
                />
              </div>
            )}
          </div>

          {/* Clear All Button */}
          {activeFilterCount > 0 && (
            <Button 
              variant="outline" 
              onClick={onClearFilters}
              className="w-full"
            >
              Clear all filters
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
