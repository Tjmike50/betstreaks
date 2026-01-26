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
}

export interface StreakFilters {
  stat: string;
  minStreak: number;
  minSeasonWinPct: number;
  playerSearch: string;
}
