// =============================================================================
// Sport Registry — single source of truth for supported sports
// =============================================================================
// Phase 1 enables NBA + WNBA. Future leagues (MLB/NHL) can be added here
// without touching consumer code.

export type SportKey = "NBA" | "WNBA" | "MLB";

export type SeasonState = "preseason" | "regular" | "postseason" | "offseason";

export interface StatCategory {
  /** Internal stat key used in the database (matches `stat` / `stat_type` columns) */
  key: string;
  /** Short display label */
  label: string;
  /** Long display label */
  longLabel: string;
}

export interface SportConfig {
  key: SportKey;
  /** Display name */
  name: string;
  /** Short label (header chip, etc.) */
  shortName: string;
  /** Tagline shown in headers (e.g. "NBA Playoffs") */
  tagline: string;
  /** Emoji used in compact UI (sidebar/header) */
  emoji: string;
  /** Whether this sport is currently selectable in the UI */
  enabled: boolean;
  /** Current season phase */
  seasonState: SeasonState;
  /** Stat categories applicable to this sport */
  stats: StatCategory[];
  /** Default sportsbook key for odds lookups */
  defaultSportsbook: string;
  /** Number of teams in the league */
  teamCount: number;
}

const NBA_STATS: StatCategory[] = [
  { key: "PTS", label: "PTS", longLabel: "Points" },
  { key: "REB", label: "REB", longLabel: "Rebounds" },
  { key: "AST", label: "AST", longLabel: "Assists" },
  { key: "3PM", label: "3PM", longLabel: "3-Pointers Made" },
  { key: "STL", label: "STL", longLabel: "Steals" },
  { key: "BLK", label: "BLK", longLabel: "Blocks" },
];

// WNBA stat catalog mirrors NBA — easy to diverge later if needed.
const WNBA_STATS: StatCategory[] = [
  { key: "PTS", label: "PTS", longLabel: "Points" },
  { key: "REB", label: "REB", longLabel: "Rebounds" },
  { key: "AST", label: "AST", longLabel: "Assists" },
  { key: "3PM", label: "3PM", longLabel: "3-Pointers Made" },
  { key: "STL", label: "STL", longLabel: "Steals" },
  { key: "BLK", label: "BLK", longLabel: "Blocks" },
];

// MLB v1 prop catalog — official supported props for scoring, research,
// cheatsheets, AI Builder, and AI Daily Pick. Keys are stable slugs.
const MLB_STATS: StatCategory[] = [
  { key: "HITS", label: "Hits", longLabel: "Hits" },
  { key: "TOTAL_BASES", label: "Total Bases", longLabel: "Total Bases" },
  { key: "HOME_RUNS", label: "HR", longLabel: "Home Runs" },
  { key: "STRIKEOUTS", label: "K", longLabel: "Strikeouts" },
  { key: "EARNED_RUNS_ALLOWED", label: "ER", longLabel: "Earned Runs Allowed" },
  { key: "WALKS_ALLOWED", label: "BB", longLabel: "Walks Allowed" },
  { key: "HITS_ALLOWED", label: "H Allowed", longLabel: "Hits Allowed" },
];

export const SPORTS: Record<SportKey, SportConfig> = {
  NBA: {
    key: "NBA",
    name: "NBA",
    shortName: "NBA",
    tagline: "NBA Playoffs",
    emoji: "🏀",
    enabled: true,
    seasonState: "postseason",
    stats: NBA_STATS,
    defaultSportsbook: "draftkings",
    teamCount: 30,
  },
  WNBA: {
    key: "WNBA",
    name: "WNBA",
    shortName: "WNBA",
    tagline: "WNBA Season",
    emoji: "🏀",
    enabled: true,
    seasonState: "offseason",
    stats: WNBA_STATS,
    defaultSportsbook: "draftkings",
    teamCount: 13,
  },
  MLB: {
    key: "MLB",
    name: "MLB",
    shortName: "MLB",
    tagline: "MLB Season",
    emoji: "⚾",
    enabled: true,
    seasonState: "regular",
    stats: MLB_STATS,
    defaultSportsbook: "draftkings",
    teamCount: 30,
  },
};

export const SPORT_KEYS: SportKey[] = ["NBA", "WNBA", "MLB"];

export const ENABLED_SPORTS: SportConfig[] = SPORT_KEYS.map((k) => SPORTS[k]).filter(
  (s) => s.enabled,
);

export const DEFAULT_SPORT: SportKey = "NBA";

export function getSportConfig(key: SportKey | string | null | undefined): SportConfig {
  if (key && key in SPORTS) return SPORTS[key as SportKey];
  return SPORTS[DEFAULT_SPORT];
}

export function isValidSport(key: string | null | undefined): key is SportKey {
  return !!key && key in SPORTS;
}
