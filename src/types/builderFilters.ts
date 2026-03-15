export type RiskLevel = "safe" | "balanced" | "aggressive";
export type BetType = "player_props" | "moneyline" | "spread" | "totals" | "mixed";
export type StatType = "points" | "rebounds" | "assists" | "threes" | "steals" | "blocks";
export type OverUnder = "over" | "under" | "both";

export interface BuilderFilters {
  // Core
  targetOdds: string;
  legCount: number | null;
  slipCount: number;
  riskLevel: RiskLevel | null;
  betType: BetType | null;
  sport: string;

  // Game / Team / Player
  includeGames: string[]; // game IDs from games_today
  includeTeams: string[];
  excludeTeams: string[];
  includePlayers: string[];
  excludePlayers: string[];

  // Prop filters
  statTypes: StatType[];
  overUnder: OverUnder;
  sameGameOnly: boolean;
  crossGameOnly: boolean;

  // Data quality
  minConfidence: number | null;
  minHitRate: number | null;
  maxVolatility: number | null;
  minSampleSize: number | null;
  startersOnly: boolean;
  avoidUncertainLineups: boolean;
  avoidStaleAvailability: boolean;
  requireFreshMarketData: boolean;

  // Market quality
  minBooksCount: number;
  minMarketConfidence: number;
  verifiedOnly: boolean;
  mainLinesOnly: boolean;
  excludeSingleBookProps: boolean;

  // Diversity
  noRepeatPlayers: boolean;
  maxOnePerPlayer: boolean;
  maxOnePerTeam: boolean;
  diversifySlips: boolean;
}

export const DEFAULT_BUILDER_FILTERS: BuilderFilters = {
  targetOdds: "",
  legCount: null,
  slipCount: 1,
  riskLevel: null,
  betType: null,
  sport: "NBA",

  includeGames: [],
  includeTeams: [],
  excludeTeams: [],
  includePlayers: [],
  excludePlayers: [],

  statTypes: [],
  overUnder: "both",
  sameGameOnly: false,
  crossGameOnly: false,

  minConfidence: null,
  minHitRate: null,
  maxVolatility: null,
  minSampleSize: null,
  startersOnly: false,
  avoidUncertainLineups: false,
  avoidStaleAvailability: false,
  requireFreshMarketData: false,

  // Market quality defaults — safe but not overly restrictive
  minBooksCount: 1,
  minMarketConfidence: 25,
  verifiedOnly: true,
  mainLinesOnly: true,
  excludeSingleBookProps: false,

  noRepeatPlayers: false,
  maxOnePerPlayer: false,
  maxOnePerTeam: false,
  diversifySlips: false,
};

export interface QuickChip {
  label: string;
  icon?: string;
  apply: (f: BuilderFilters) => BuilderFilters;
}

export function getActiveBuilderFilterCount(filters: BuilderFilters): number {
  const d = DEFAULT_BUILDER_FILTERS;
  let count = 0;
  if (filters.targetOdds) count++;
  if (filters.legCount !== d.legCount) count++;
  if (filters.riskLevel !== d.riskLevel) count++;
  if (filters.betType !== d.betType) count++;
  if (filters.includeGames.length > 0) count++;
  if (filters.includeTeams.length > 0) count++;
  if (filters.excludeTeams.length > 0) count++;
  if (filters.includePlayers.length > 0) count++;
  if (filters.excludePlayers.length > 0) count++;
  if (filters.statTypes.length > 0) count++;
  if (filters.overUnder !== d.overUnder) count++;
  if (filters.sameGameOnly) count++;
  if (filters.crossGameOnly) count++;
  if (filters.minConfidence !== d.minConfidence) count++;
  if (filters.minHitRate !== d.minHitRate) count++;
  if (filters.maxVolatility !== d.maxVolatility) count++;
  if (filters.minSampleSize !== d.minSampleSize) count++;
  if (filters.startersOnly) count++;
  if (filters.avoidUncertainLineups) count++;
  // Market quality (only count if changed from defaults)
  if (filters.minBooksCount !== d.minBooksCount) count++;
  if (filters.minMarketConfidence !== d.minMarketConfidence) count++;
  if (filters.verifiedOnly !== d.verifiedOnly) count++;
  if (filters.mainLinesOnly !== d.mainLinesOnly) count++;
  if (filters.excludeSingleBookProps !== d.excludeSingleBookProps) count++;
  // Diversity
  if (filters.noRepeatPlayers) count++;
  if (filters.maxOnePerPlayer) count++;
  if (filters.maxOnePerTeam) count++;
  if (filters.diversifySlips) count++;
  return count;
}

/** Serialize filters to a constraint summary for the LLM prompt */
export function filtersToPromptConstraints(filters: BuilderFilters): string {
  const parts: string[] = [];

  if (filters.targetOdds) parts.push(`Target combined odds: ${filters.targetOdds}`);
  if (filters.legCount) parts.push(`Exactly ${filters.legCount} legs per slip`);
  if (filters.riskLevel) parts.push(`Risk level: ${filters.riskLevel}`);
  if (filters.betType && filters.betType !== "mixed") parts.push(`Bet type: ${filters.betType.replace("_", " ")}`);
  if (filters.statTypes.length > 0) parts.push(`Stats: ${filters.statTypes.join(", ")} only`);
  if (filters.overUnder === "over") parts.push("Overs only");
  if (filters.overUnder === "under") parts.push("Unders only");
  if (filters.sameGameOnly) parts.push("Same-game parlay only");
  if (filters.crossGameOnly) parts.push("Cross-game only");
  if (filters.includeTeams.length) parts.push(`Include teams: ${filters.includeTeams.join(", ")}`);
  if (filters.excludeTeams.length) parts.push(`Exclude teams: ${filters.excludeTeams.join(", ")}`);
  if (filters.includePlayers.length) parts.push(`Include players: ${filters.includePlayers.join(", ")}`);
  if (filters.excludePlayers.length) parts.push(`Exclude players: ${filters.excludePlayers.join(", ")}`);
  if (filters.noRepeatPlayers) parts.push("No repeat players across slips");
  if (filters.maxOnePerPlayer) parts.push("Max one leg per player in each slip");
  if (filters.maxOnePerTeam) parts.push("Max one leg per team in each slip");
  if (filters.diversifySlips) parts.push("Maximize diversity across slips");

  return parts.length > 0 ? `\n\nUSER CONSTRAINTS:\n${parts.map(p => `- ${p}`).join("\n")}` : "";
}
