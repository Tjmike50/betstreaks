// =============================================================================
// bookableLines — translates between streak/scoring stat codes and the
// normalized odds layer's market_type keys, and builds an index of bookable
// lines for fast lookup.
//
// Goal: BetStreaks should prioritize streaks/cheatsheets that line up with
// thresholds users can really bet at a sportsbook.
// =============================================================================

/**
 * Map normalized market_type keys (from markets / consensus_lines) → streak
 * stat codes they satisfy. One market_type can map to multiple streak codes
 * (e.g. player_points → PTS, pts).
 */
export const MARKET_TYPE_TO_STAT_CODES: Record<string, string[]> = {
  player_points: ["PTS", "pts", "PTS_U"],
  player_rebounds: ["REB", "reb"],
  player_assists: ["AST", "ast"],
  player_threes: ["3PM", "FG3M", "fg3m"],
  player_blocks: ["BLK", "blk"],
  player_steals: ["STL", "stl"],
  player_points_assists: ["PA"],
  player_points_rebounds: ["PR"],
  player_points_rebounds_assists: ["PRA"],
  player_rebounds_assists: ["RA"],
  // MLB market types (if/when they enter the normalized layer)
  batter_hits: ["HITS"],
  batter_total_bases: ["TOTAL_BASES"],
  batter_home_runs: ["HOME_RUNS"],
  pitcher_strikeouts: ["STRIKEOUTS"],
  pitcher_earned_runs: ["EARNED_RUNS_ALLOWED"],
  pitcher_walks: ["WALKS_ALLOWED"],
  pitcher_hits_allowed: ["HITS_ALLOWED"],
};

/**
 * Legacy mapping kept for backward compat — used only by code that already
 * references it. New code should use MARKET_TYPE_TO_STAT_CODES.
 */
export const STAT_CODE_TO_BOOK_LABELS: Record<string, string[]> = {
  // NBA / WNBA
  PTS: ["Points"],
  PTS_U: ["Points"],
  REB: ["Rebounds"],
  AST: ["Assists"],
  "3PM": ["3-Pointers"],
  FG3M: ["3-Pointers"],
  BLK: ["Blocks"],
  STL: ["Steals"],
  PA: ["Points + Assists"],
  PR: ["Points + Rebounds"],
  PRA: ["Points + Rebounds + Assists"],
  RA: ["Rebounds + Assists"],
  pts: ["Points"],
  reb: ["Rebounds"],
  ast: ["Assists"],
  fg3m: ["3-Pointers"],
  blk: ["Blocks"],
  stl: ["Steals"],
  // MLB
  HITS: ["batter_hits"],
  TOTAL_BASES: ["batter_total_bases"],
  HOME_RUNS: ["batter_home_runs"],
  STRIKEOUTS: ["pitcher_strikeouts"],
  EARNED_RUNS_ALLOWED: ["pitcher_earned_runs"],
  WALKS_ALLOWED: ["pitcher_walks"],
  HITS_ALLOWED: ["pitcher_hits_allowed"],
};

export function bookLabelsForStatCode(stat: string): string[] {
  return STAT_CODE_TO_BOOK_LABELS[stat] ?? STAT_CODE_TO_BOOK_LABELS[stat.toUpperCase()] ?? [];
}

/**
 * Build a key matching `(player|stat-code)` so we can look up the bookable
 * lines for a streak row regardless of casing.
 */
export function bookableKey(playerName: string, statCode: string): string {
  return `${playerName.trim().toLowerCase()}|${statCode.toUpperCase()}`;
}

export interface BookableLineEntry {
  /** Distinct .5 thresholds offered for this player+stat (sorted asc). */
  thresholds: number[];
  /**
   * "Main" line — the consensus average line across sportsbooks.
   * Falls back to the lowest available threshold.
   */
  mainThreshold: number;
}

export interface BookableLineRow {
  player_name: string;
  stat_type: string;
  threshold: number;
}

/**
 * Consensus-based row shape from the consensus_lines view + player join.
 */
export interface ConsensusLineRow {
  player_name: string;
  market_type: string;
  average_line: number;
  min_line: number;
  max_line: number;
}

/**
 * Build the bookable index from consensus_lines data. Each consensus row
 * provides an average/min/max range; we expand to .5-step thresholds so
 * matchStreakToBookLine still works correctly.
 */
export function buildBookableIndexFromConsensus(
  rows: ConsensusLineRow[]
): Map<string, BookableLineEntry> {
  const out = new Map<string, BookableLineEntry>();

  for (const row of rows) {
    const codes = MARKET_TYPE_TO_STAT_CODES[row.market_type];
    if (!codes) continue;

    const minT = row.min_line;
    const maxT = row.max_line;
    const avgT = row.average_line;
    if (!Number.isFinite(minT) || !Number.isFinite(maxT)) continue;

    // Generate all plausible .5 thresholds in [min, max]
    const thresholds: number[] = [];
    // Round min down to nearest .5, max up to nearest .5
    let t = Math.floor(minT * 2) / 2;
    const ceiling = Math.ceil(maxT * 2) / 2;
    while (t <= ceiling + 1e-9) {
      thresholds.push(t);
      t += 1;
    }
    if (thresholds.length === 0) thresholds.push(avgT);

    // Find mainThreshold: the generated threshold closest to average
    const mainThreshold = thresholds.reduce((best, cur) =>
      Math.abs(cur - avgT) < Math.abs(best - avgT) ? cur : best,
      thresholds[0],
    );

    const seen = new Set<string>();
    for (const code of codes) {
      const key = bookableKey(row.player_name, code);
      if (seen.has(key)) continue;
      seen.add(key);

      const existing = out.get(key);
      if (existing) {
        // Merge thresholds from multiple events (same player in different games)
        const merged = new Set([...existing.thresholds, ...thresholds]);
        const sortedMerged = [...merged].sort((a, b) => a - b);
        out.set(key, {
          thresholds: sortedMerged,
          mainThreshold: existing.mainThreshold, // keep first
        });
      } else {
        out.set(key, { thresholds: [...thresholds], mainThreshold });
      }
    }
  }

  return out;
}

/**
 * Legacy builder — kept for any callers still passing raw line_snapshot rows.
 */
export function buildBookableIndex(
  rows: BookableLineRow[]
): Map<string, BookableLineEntry> {
  // book label → list of streak codes it satisfies
  const labelToCodes = new Map<string, string[]>();
  for (const [code, labels] of Object.entries(STAT_CODE_TO_BOOK_LABELS)) {
    for (const label of labels) {
      const arr = labelToCodes.get(label) ?? [];
      arr.push(code.toUpperCase());
      labelToCodes.set(label, arr);
    }
  }

  const tally = new Map<string, Map<number, number>>();
  for (const row of rows) {
    const codes = labelToCodes.get(row.stat_type);
    if (!codes) continue;
    const t = Number(row.threshold);
    if (!Number.isFinite(t)) continue;
    const seen = new Set<string>();
    for (const code of codes) {
      const key = bookableKey(row.player_name, code);
      if (seen.has(key)) continue;
      seen.add(key);
      let m = tally.get(key);
      if (!m) {
        m = new Map();
        tally.set(key, m);
      }
      m.set(t, (m.get(t) ?? 0) + 1);
    }
  }

  const out = new Map<string, BookableLineEntry>();
  for (const [key, m] of tally) {
    const sorted = [...m.entries()].sort((a, b) => a[0] - b[0]);
    const thresholds = sorted.map(([t]) => t);
    const mainThreshold = sorted.reduce(
      (best, cur) => (cur[1] > best[1] ? cur : best),
      sorted[0],
    )[0];
    out.set(key, { thresholds, mainThreshold });
  }
  return out;
}

/**
 * Streaks store integer thresholds (5, 6, 7…); books offer half-points
 * (4.5, 5.5, 6.5…). A streak at integer N is meaningfully bookable if there
 * is a book line at N - 0.5 (Over N-0.5 ≡ "N or more" ≡ streak threshold N).
 *
 * Returns the bookable line (e.g. 4.5) that matches a streak's integer
 * threshold (e.g. 5), or null if none exists.
 */
export function matchStreakToBookLine(
  streakThreshold: number,
  bookThresholds: number[]
): number | null {
  const target = streakThreshold - 0.5;
  for (const t of bookThresholds) {
    if (Math.abs(t - target) < 1e-6) return t;
  }
  return null;
}
