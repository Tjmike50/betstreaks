import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { BuilderFilters } from "@/types/builderFilters";
import { DEFAULT_BUILDER_FILTERS } from "@/types/builderFilters";

interface Props {
  filters: BuilderFilters;
  onChange: (f: BuilderFilters) => void;
  onClearAll: () => void;
}

export function BuilderActiveFilters({ filters, onChange, onClearAll }: Props) {
  const d = DEFAULT_BUILDER_FILTERS;
  const chips: { label: string; clear: () => void }[] = [];

  if (filters.targetOdds) chips.push({ label: `Odds: ${filters.targetOdds}`, clear: () => onChange({ ...filters, targetOdds: "" }) });
  if (filters.legCount) chips.push({ label: `${filters.legCount} legs`, clear: () => onChange({ ...filters, legCount: null }) });
  if (filters.riskLevel) chips.push({ label: filters.riskLevel, clear: () => onChange({ ...filters, riskLevel: null }) });
  if (filters.betType) chips.push({ label: filters.betType.replace("_", " "), clear: () => onChange({ ...filters, betType: null }) });
  if (filters.statTypes.length) chips.push({ label: `Stats: ${filters.statTypes.join(", ")}`, clear: () => onChange({ ...filters, statTypes: [] }) });
  if (filters.overUnder !== "both") chips.push({ label: `${filters.overUnder} only`, clear: () => onChange({ ...filters, overUnder: "both" }) });
  if (filters.sameGameOnly) chips.push({ label: "SGP", clear: () => onChange({ ...filters, sameGameOnly: false }) });
  if (filters.crossGameOnly) chips.push({ label: "Cross-game", clear: () => onChange({ ...filters, crossGameOnly: false }) });
  if (filters.includeGames.length) chips.push({ label: `${filters.includeGames.length} game${filters.includeGames.length > 1 ? "s" : ""}`, clear: () => onChange({ ...filters, includeGames: [] }) });
  if (filters.includeTeams.length) chips.push({ label: `+${filters.includeTeams.join(",")}`, clear: () => onChange({ ...filters, includeTeams: [] }) });
  if (filters.excludeTeams.length) chips.push({ label: `-${filters.excludeTeams.join(",")}`, clear: () => onChange({ ...filters, excludeTeams: [] }) });
  if (filters.includePlayers.length) chips.push({ label: `+Players(${filters.includePlayers.length})`, clear: () => onChange({ ...filters, includePlayers: [] }) });
  if (filters.excludePlayers.length) chips.push({ label: `-Players(${filters.excludePlayers.length})`, clear: () => onChange({ ...filters, excludePlayers: [] }) });
  if (filters.minConfidence) chips.push({ label: `Conf≥${filters.minConfidence}`, clear: () => onChange({ ...filters, minConfidence: null }) });
  if (filters.minHitRate) chips.push({ label: `Hit≥${filters.minHitRate}%`, clear: () => onChange({ ...filters, minHitRate: null }) });
  if (filters.maxVolatility) chips.push({ label: `Vol≤${filters.maxVolatility}`, clear: () => onChange({ ...filters, maxVolatility: null }) });
  if (filters.minSampleSize) chips.push({ label: `Sample≥${filters.minSampleSize}`, clear: () => onChange({ ...filters, minSampleSize: null }) });
  if (filters.startersOnly) chips.push({ label: "Starters", clear: () => onChange({ ...filters, startersOnly: false }) });
  if (filters.avoidUncertainLineups) chips.push({ label: "No uncertain", clear: () => onChange({ ...filters, avoidUncertainLineups: false }) });
  if (filters.noRepeatPlayers) chips.push({ label: "No repeats", clear: () => onChange({ ...filters, noRepeatPlayers: false }) });
  if (filters.maxOnePerPlayer) chips.push({ label: "1/player", clear: () => onChange({ ...filters, maxOnePerPlayer: false }) });
  if (filters.maxOnePerTeam) chips.push({ label: "1/team", clear: () => onChange({ ...filters, maxOnePerTeam: false }) });
  if (filters.diversifySlips) chips.push({ label: "Diversify", clear: () => onChange({ ...filters, diversifySlips: false }) });
  // Market quality
  if (filters.minBooksCount !== d.minBooksCount) chips.push({ label: `Books≥${filters.minBooksCount}`, clear: () => onChange({ ...filters, minBooksCount: d.minBooksCount }) });
  if (filters.minMarketConfidence !== d.minMarketConfidence) chips.push({ label: `MktConf≥${filters.minMarketConfidence}`, clear: () => onChange({ ...filters, minMarketConfidence: d.minMarketConfidence }) });
  if (!filters.verifiedOnly) chips.push({ label: "Unverified allowed", clear: () => onChange({ ...filters, verifiedOnly: true }) });
  if (!filters.mainLinesOnly) chips.push({ label: "Alt lines allowed", clear: () => onChange({ ...filters, mainLinesOnly: true }) });
  if (filters.excludeSingleBookProps) chips.push({ label: "No 1-book", clear: () => onChange({ ...filters, excludeSingleBookProps: false }) });

  if (chips.length === 0) return null;

  return (
    <div className="flex gap-1.5 flex-wrap items-center">
      {chips.map((c) => (
        <Badge
          key={c.label}
          variant="secondary"
          className="text-[10px] gap-1 cursor-pointer hover:bg-destructive/20 transition-colors"
          onClick={c.clear}
        >
          {c.label}
          <X className="h-2.5 w-2.5" />
        </Badge>
      ))}
      <button onClick={onClearAll} className="text-[10px] text-muted-foreground hover:text-destructive ml-1">
        Clear all
      </button>
    </div>
  );
}
