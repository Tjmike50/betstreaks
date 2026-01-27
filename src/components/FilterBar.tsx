import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
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
}

const PLAYER_STAT_OPTIONS = ["All", "PTS", "AST", "REB", "3PM"];
const TEAM_STAT_OPTIONS = ["All", "ML", "PTS"];
const STREAK_OPTIONS = [2, 3, 5, 7, 10];

export function FilterBar({ filters, onFiltersChange, entityType }: FilterBarProps) {
  const isTeam = entityType === "team";
  const statOptions = isTeam ? TEAM_STAT_OPTIONS : PLAYER_STAT_OPTIONS;
  const searchPlaceholder = isTeam ? "Search team..." : "Search player...";
  return (
    <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b border-border px-4 py-4 space-y-4">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={searchPlaceholder}
          value={filters.playerSearch}
          onChange={(e) =>
            onFiltersChange({ ...filters, playerSearch: e.target.value })
          }
          className="pl-10 h-12 bg-card border-border text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {/* Stat Dropdown */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground whitespace-nowrap">Stat:</span>
        <Select
          value={filters.stat}
          onValueChange={(value) => onFiltersChange({ ...filters, stat: value })}
        >
          <SelectTrigger className="h-12 bg-card border-border flex-1">
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
              className={`flex-1 h-12 rounded-lg font-medium transition-colors ${
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
  );
}
