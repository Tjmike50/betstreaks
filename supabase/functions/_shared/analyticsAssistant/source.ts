import type { Player, Query, Snapshot } from "./contract.ts";

// Column names and nullability follow public.player_recent_games. Eligibility
// is separately supplied by the fixture or by a verified source manifest.
export type GameLog = {
  sport: string;
  player_id: number;
  game_id: string;
  game_date: string;
  pts: number | null;
  reb: number | null;
  ast: number | null;
  fg3m: number | null;
  updated_at: string;
};
export type Appearance = GameLog & { eligibility: "final" | "dnp" | "scheduled" | "unknown" };
export type GameLogSource = {
  snapshot: Snapshot | null;
  players: readonly Player[];
  readGames(query: Query, signal: AbortSignal): Promise<{ rows: readonly Appearance[]; complete: boolean }>;
};
