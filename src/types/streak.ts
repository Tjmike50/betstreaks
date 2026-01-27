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
  last5_hits: number;
  last5_games: number;
}

export type SortOption = "streak" | "season" | "l10" | "recent";

export interface StreakFilters {
  stat: string;
  minStreak: number;
  minSeasonWinPct: number;
  playerSearch: string;
  advanced: boolean;
  entityType: "player" | "team";
  sortBy: SortOption;
  bestBets: boolean;
}
