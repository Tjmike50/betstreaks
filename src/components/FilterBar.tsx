import { useEffect, useRef } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
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
import type { StreakFilters } from "@/types/streak";

interface FilterBarProps {
  filters: StreakFilters;
  onFiltersChange: (filters: StreakFilters) => void;
  entityType: "player" | "team";
  isExpanded: boolean;
  onToggleExpanded: () => void;
}

const PLAYER_STAT_OPTIONS = ["All", "PTS", "AST", "REB", "3PM"];
const TEAM_STAT_OPTIONS = ["All", "ML", "PTS"];
const STREAK_OPTIONS = [2, 3, 5, 7, 10];

// Calculate active filter count
function getActiveFilterCount(filters: StreakFilters, entityType: "player" | "team"): number {
  let count = 0;
  if (filters.stat !== "All") count++;
  if (filters.minStreak !== 2) count++;
  if (filters.minSeasonWinPct !== 0) count++;
  if (entityType === "player" && filters.advanced) count++;
  return count;
}

export function FilterBar({ 
  filters, 
  onFiltersChange, 
  entityType, 
  isExpanded, 
  onToggleExpanded 
}: FilterBarProps) {
  const isTeam = entityType === "team";
  const statOptions = isTeam ? TEAM_STAT_OPTIONS : PLAYER_STAT_OPTIONS;
  const searchPlaceholder = isTeam ? "Search team..." : "Search player...";
  const activeFilterCount = getActiveFilterCount(filters, entityType);
  const drawerRef = useRef<HTMLDivElement>(null);

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

      {/* Expandable Filters Drawer */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-4 animate-in slide-in-from-top-2 duration-200">
          {/* Stat Dropdown */}
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground whitespace-nowrap">Stat:</span>
            <Select
              value={filters.stat}
              onValueChange={(value) => onFiltersChange({ ...filters, stat: value })}
            >
              <SelectTrigger className="h-10 bg-card border-border flex-1">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                {statOptions.map((stat) => (
                  <SelectItem key={stat} value={stat} className="text-foreground">
                    {stat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Min Streak Buttons */}
          <div className="space-y-2">
            <span className="text-sm text-muted-foreground">Min streak:</span>
            <div className="flex gap-2">
              {STREAK_OPTIONS.map((num) => (
                <button
                  key={num}
                  onClick={() => onFiltersChange({ ...filters, minStreak: num })}
                  className={`flex-1 h-10 rounded-lg font-medium transition-colors ${
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

          {/* Advanced Toggle - only show for players */}
          {!isTeam && (
            <div className="flex items-center justify-between pt-2 border-t border-border">
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
      )}
    </div>
  );
}
