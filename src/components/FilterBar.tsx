import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
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
}

const STAT_OPTIONS = ["All", "PTS", "AST", "REB", "3PM"];
const STREAK_OPTIONS = [2, 3, 5, 7, 10];

export function FilterBar({ filters, onFiltersChange }: FilterBarProps) {
  return (
    <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b border-border px-4 py-4 space-y-4">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search player..."
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
            {STAT_OPTIONS.map((stat) => (
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
    </div>
  );
}
