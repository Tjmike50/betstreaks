// =============================================================================
// bookableLines — translates between streak/scoring stat codes and the
// stat_type labels actually used by sportsbook line snapshots.
//
// Goal: BetStreaks should prioritize streaks/cheatsheets that line up with
// thresholds users can really bet at a sportsbook.
// =============================================================================

/**
 * Map streak/scoring stat codes (PTS, REB, ast, fg3m, HITS, STRIKEOUTS, ...)
 * → the line_snapshots `stat_type` labels we actually receive from books.
 * One streak code can map to multiple book labels (case variants etc).
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
  // legacy lower-case used in player_prop_scores for NBA
  pts: ["Points"],
  reb: ["Rebounds"],
  ast: ["Assists"],
  fg3m: ["3-Pointers"],
  blk: ["Blocks"],
  stl: ["Steals"],

  // MLB anchors / expansion
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
   * "Main" line — heuristic: lowest threshold with the highest book count,
   * which in our snapshot data corresponds to the standard non-alt line.
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
 * Index a flat list of line_snapshots rows into a Map keyed by
 * `(player|streak-stat-code)`. We invert STAT_CODE_TO_BOOK_LABELS so that a
 * row with `stat_type='Points'` maps back to streak code `PTS`, `pts`, etc.
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

  // collect thresholds per (player, code)
  const tally = new Map<string, Map<number, number>>();
  for (const row of rows) {
    const codes = labelToCodes.get(row.stat_type);
    if (!codes) continue;
    const t = Number(row.threshold);
    if (!Number.isFinite(t)) continue;
    // De-dupe across casings: store once per uppercased code
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
    // main = threshold with most rows (highest sportsbook coverage); tie → lowest
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
