export interface Streak {
  id: string;
  player_id: number;
  player_name: string;
  team_abbr: string | null;
  stat: string;
  threshold: number;
  streak_len: number;
  streak_start: string;
  streak_win_pct: number;
  season_wins: number;
  season_games: number;
  season_win_pct: number;
  last_game: string;
  sport: string;
  entity_type: string;
  updated_at: string;
  last10_hits: number;
  last10_games: number;
  last10_hit_pct: number | null;
  last5_hits: number;
  last5_games: number;
  last5_hit_pct: number | null;
}

export type SortOption = "streak" | "season" | "l10" | "recent" | "threshold" | "bestBetsScore";

export interface StreakFilters {
  stat: string;
  minStreak: number;
  minSeasonWinPct: number;
  playerSearch: string;
  advanced: boolean;
  entityType: "player" | "team";
  sortBy: SortOption;
  bestBets: boolean;
  // New filters
  thresholdMin: number | null;
  thresholdMax: number | null;
  teamFilter: string; // "All" or specific team abbr
  recentOnly: boolean; // Only show cards updated in last 3 days
}

// Threshold ranges by stat type
export const THRESHOLD_RANGES: Record<string, { min: number; max: number }> = {
  PTS: { min: 10, max: 50 },
  REB: { min: 1, max: 25 },
  AST: { min: 1, max: 20 },
  "3PM": { min: 1, max: 10 },
  PTS_U: { min: 10, max: 50 },
  ML: { min: 0, max: 0 }, // ML doesn't use threshold
};

// Calculate Best Bets score
export function calculateBestBetsScore(streak: Streak): number {
  const l10Pct = streak.last10_hit_pct ?? 0;
  return (streak.streak_len * 2) + (l10Pct * 0.10) + (streak.season_win_pct * 0.05);
}
