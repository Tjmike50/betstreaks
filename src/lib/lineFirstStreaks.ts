// =============================================================================
// lineFirstStreaks — sportsbook-line-first source of truth.
//
// This module starts from real `line_snapshots` rows and computes:
//   - the main bookable threshold (e.g. 19.5 Points)
//   - hit-rate vs that exact threshold (Over X.5 = ≥ X+1, integer)
//   - the active streak vs that exact threshold
//   - season / L10 / L5 splits computed against the actual book line
//
// The legacy "milestone integer streaks" pipeline (5+, 6+, 1+) is no longer
// the user-facing default. We only surface streak cards that correspond to a
// real bettable line.
// =============================================================================

/** Sportsbook stat_type label → unified internal stat code we use across the app. */
export const BOOK_STAT_TO_CODE: Record<string, string> = {
  // NBA / WNBA
  Points: "PTS",
  Rebounds: "REB",
  Assists: "AST",
  "3-Pointers": "3PM",
  Blocks: "BLK",
  Steals: "STL",
  // MLB hitter
  batter_hits: "HITS",
  batter_total_bases: "TOTAL_BASES",
  batter_home_runs: "HOME_RUNS",
  // MLB pitcher
  pitcher_strikeouts: "STRIKEOUTS",
  pitcher_earned_runs: "EARNED_RUNS_ALLOWED",
  pitcher_walks: "WALKS_ALLOWED",
  pitcher_hits_allowed: "HITS_ALLOWED",
};

/** Friendly label for the bet line shown on cards. */
export const STAT_CODE_TO_LABEL: Record<string, string> = {
  PTS: "Points",
  REB: "Rebounds",
  AST: "Assists",
  "3PM": "3-Pointers",
  BLK: "Blocks",
  STL: "Steals",
  HITS: "Hits",
  TOTAL_BASES: "Total Bases",
  HOME_RUNS: "Home Runs",
  STRIKEOUTS: "Strikeouts",
  EARNED_RUNS_ALLOWED: "Earned Runs",
  WALKS_ALLOWED: "Walks Allowed",
  HITS_ALLOWED: "Hits Allowed",
};

export interface BookableLine {
  player_id: number | null;
  player_name: string;
  stat_code: string;
  /** The displayed/main threshold (e.g. 19.5, 1.5). */
  main_threshold: number;
  /** Other available alt thresholds for the same player+stat. */
  alt_thresholds: number[];
  /** How many sportsbooks offer the main line — proxy for confidence/coverage. */
  books_count: number;
  /** Latest game_date the line was seen for. */
  game_date: string;
}

export interface LineSnapshotRow {
  player_id: number | null;
  player_name: string;
  stat_type: string;
  threshold: number;
  game_date: string;
  sportsbook: string;
}

/**
 * Reduce raw line_snapshots into one `BookableLine` per (player, stat_code).
 * Main = the threshold with the most book coverage; ties broken toward the
 * lowest threshold (the standard non-alt line).
 */
export function buildBookableLines(rows: LineSnapshotRow[]): BookableLine[] {
  // (player|stat_code) → threshold → Set<sportsbook>
  const tally = new Map<string, Map<number, Set<string>>>();
  // (player|stat_code) → metadata
  const meta = new Map<string, { player_id: number | null; player_name: string; stat_code: string; latestDate: string }>();

  for (const row of rows) {
    const code = BOOK_STAT_TO_CODE[row.stat_type];
    if (!code) continue;
    const t = Number(row.threshold);
    if (!Number.isFinite(t)) continue;

    const key = `${row.player_name.trim().toLowerCase()}|${code}`;
    let m = tally.get(key);
    if (!m) {
      m = new Map();
      tally.set(key, m);
    }
    let set = m.get(t);
    if (!set) {
      set = new Set();
      m.set(t, set);
    }
    set.add(row.sportsbook);

    const cur = meta.get(key);
    if (!cur || row.game_date > cur.latestDate) {
      meta.set(key, {
        player_id: row.player_id,
        player_name: row.player_name,
        stat_code: code,
        latestDate: row.game_date,
      });
    }
  }

  const out: BookableLine[] = [];
  for (const [key, thresholdMap] of tally) {
    const m = meta.get(key);
    if (!m) continue;
    const sorted = [...thresholdMap.entries()].sort((a, b) => a[0] - b[0]);
    // pick threshold with most books; tiebreak → lowest
    const [main_threshold, mainSet] = sorted.reduce(
      (best, cur) => (cur[1].size > best[1].size ? cur : best),
      sorted[0],
    );
    const alt_thresholds = sorted.map(([t]) => t).filter((t) => t !== main_threshold);
    out.push({
      player_id: m.player_id,
      player_name: m.player_name,
      stat_code: m.stat_code,
      main_threshold,
      alt_thresholds,
      books_count: mainSet.size,
      game_date: m.latestDate,
    });
  }
  return out;
}

// -----------------------------------------------------------------------------
// Game-log adapters — extract the raw stat value for a (game, stat_code).
// -----------------------------------------------------------------------------

export interface NbaGameLog {
  game_date: string;
  pts: number | null;
  reb: number | null;
  ast: number | null;
  fg3m: number | null;
  blk: number | null;
  stl: number | null;
}

export function nbaStatValue(game: NbaGameLog, code: string): number | null {
  switch (code) {
    case "PTS":
      return game.pts;
    case "REB":
      return game.reb;
    case "AST":
      return game.ast;
    case "3PM":
      return game.fg3m;
    case "BLK":
      return game.blk;
    case "STL":
      return game.stl;
    default:
      return null;
  }
}

export interface MlbHitterLog {
  game_date: string;
  hits: number | null;
  total_bases: number | null;
  home_runs: number | null;
}

export function mlbHitterValue(game: MlbHitterLog, code: string): number | null {
  switch (code) {
    case "HITS":
      return game.hits;
    case "TOTAL_BASES":
      return game.total_bases;
    case "HOME_RUNS":
      return game.home_runs;
    default:
      return null;
  }
}

export interface MlbPitcherLog {
  game_date: string;
  strikeouts: number | null;
  earned_runs_allowed: number | null;
  walks_allowed: number | null;
  hits_allowed: number | null;
}

export function mlbPitcherValue(game: MlbPitcherLog, code: string): number | null {
  switch (code) {
    case "STRIKEOUTS":
      return game.strikeouts;
    case "EARNED_RUNS_ALLOWED":
      return game.earned_runs_allowed;
    case "WALKS_ALLOWED":
      return game.walks_allowed;
    case "HITS_ALLOWED":
      return game.hits_allowed;
    default:
      return null;
  }
}

// -----------------------------------------------------------------------------
// Stat split computation against an actual book line.
// -----------------------------------------------------------------------------

export interface LineSplits {
  /** Active consecutive Over hits up to and including the most recent game. */
  streak_len: number;
  /** Date of the most recent counted game. */
  last_game: string;
  /** Date of the first game in the active streak. */
  streak_start: string;
  season_games: number;
  season_wins: number;
  season_win_pct: number;
  last10_games: number;
  last10_hits: number;
  last10_hit_pct: number | null;
  last5_games: number;
  last5_hits: number;
  last5_hit_pct: number | null;
}

/**
 * Compute splits vs a bookable threshold (e.g. 19.5 → "≥ 20" hit).
 * `values` must be ordered most-recent-first and aligned with `dates`.
 */
export function computeLineSplits(
  values: (number | null)[],
  dates: string[],
  threshold: number,
): LineSplits {
  const safe = values.map((v) => (typeof v === "number" ? v : null));
  let streak_len = 0;
  let streak_start = dates[0] ?? "";
  for (let i = 0; i < safe.length; i++) {
    const v = safe[i];
    if (v != null && v > threshold) {
      streak_len++;
      streak_start = dates[i] ?? streak_start;
    } else {
      break;
    }
  }

  const counted = safe.map((v, i) => ({ v, d: dates[i] })).filter((x) => x.v != null) as { v: number; d: string }[];
  const last_game = counted[0]?.d ?? "";

  const season_games = counted.length;
  const season_wins = counted.filter((x) => x.v > threshold).length;
  const season_win_pct = season_games > 0 ? (season_wins / season_games) * 100 : 0;

  const l10 = counted.slice(0, 10);
  const last10_games = l10.length;
  const last10_hits = l10.filter((x) => x.v > threshold).length;
  const last10_hit_pct = last10_games > 0 ? (last10_hits / last10_games) * 100 : null;

  const l5 = counted.slice(0, 5);
  const last5_games = l5.length;
  const last5_hits = l5.filter((x) => x.v > threshold).length;
  const last5_hit_pct = last5_games > 0 ? (last5_hits / last5_games) * 100 : null;

  return {
    streak_len,
    last_game,
    streak_start,
    season_games,
    season_wins,
    season_win_pct,
    last10_games,
    last10_hits,
    last10_hit_pct,
    last5_games,
    last5_hits,
    last5_hit_pct,
  };
}

/** Friendly bet label e.g. "Over 19.5 Points". */
export function formatBetLabel(stat_code: string, threshold: number): string {
  const label = STAT_CODE_TO_LABEL[stat_code] ?? stat_code;
  return `Over ${threshold} ${label}`;
}
