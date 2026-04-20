// ============================================================
// BetStreaks — MLB Odds Market Mapping (v1)
//
// Single source of truth for translating between:
//   • MLB v1 prop catalog stat keys (registry.ts)
//   • The Odds API market keys
//   • Internal `stat_type` values stored in player_prop_scores /
//     player_prop_rolling_stats / line_snapshots
//
// Used by future ingestion + scoring code. No runtime side effects.
// ============================================================

/**
 * Internal MLB stat keys — must match `src/lib/sports/registry.ts` MLB_STATS.
 * These are the canonical `market_type_key` values for
 * mlb_player_prop_rolling_stats and the `stat_type` values in shared scoring tables.
 */
export type MlbStatKey =
  | "HITS"
  | "TOTAL_BASES"
  | "HOME_RUNS"
  | "STRIKEOUTS"
  | "EARNED_RUNS_ALLOWED"
  | "WALKS_ALLOWED"
  | "HITS_ALLOWED";

export type MlbPropRole = "batter" | "pitcher";

export interface MlbMarketMapping {
  /** Internal stat key */
  statKey: MlbStatKey;
  /** Long label for UI */
  label: string;
  /** Whether this prop applies to a batter or pitcher */
  role: MlbPropRole;
  /** The Odds API market key (regular-season player props) */
  oddsApiMarket: string;
  /** Field on `mlb_hitter_game_logs` or `mlb_pitcher_game_logs` that stores the actual value */
  gameLogField: string;
}

/**
 * MLB v1 prop catalog → Odds API market keys.
 *
 * Odds API MLB player-prop market keys (reference:
 *   https://the-odds-api.com/sports-odds-data/betting-markets.html )
 *   batter_hits, batter_total_bases, batter_home_runs,
 *   pitcher_strikeouts, pitcher_earned_runs, pitcher_walks, pitcher_hits_allowed
 */
export const MLB_MARKET_MAP: Record<MlbStatKey, MlbMarketMapping> = {
  HITS: {
    statKey: "HITS",
    label: "Hits",
    role: "batter",
    oddsApiMarket: "batter_hits",
    gameLogField: "hits",
  },
  TOTAL_BASES: {
    statKey: "TOTAL_BASES",
    label: "Total Bases",
    role: "batter",
    oddsApiMarket: "batter_total_bases",
    gameLogField: "total_bases",
  },
  HOME_RUNS: {
    statKey: "HOME_RUNS",
    label: "Home Runs",
    role: "batter",
    oddsApiMarket: "batter_home_runs",
    gameLogField: "home_runs",
  },
  STRIKEOUTS: {
    statKey: "STRIKEOUTS",
    label: "Strikeouts",
    role: "pitcher",
    oddsApiMarket: "pitcher_strikeouts",
    gameLogField: "strikeouts",
  },
  EARNED_RUNS_ALLOWED: {
    statKey: "EARNED_RUNS_ALLOWED",
    label: "Earned Runs Allowed",
    role: "pitcher",
    oddsApiMarket: "pitcher_earned_runs",
    gameLogField: "earned_runs_allowed",
  },
  WALKS_ALLOWED: {
    statKey: "WALKS_ALLOWED",
    label: "Walks Allowed",
    role: "pitcher",
    oddsApiMarket: "pitcher_walks",
    gameLogField: "walks_allowed",
  },
  HITS_ALLOWED: {
    statKey: "HITS_ALLOWED",
    label: "Hits Allowed",
    role: "pitcher",
    oddsApiMarket: "pitcher_hits_allowed",
    gameLogField: "hits_allowed",
  },
};

export const MLB_STAT_KEYS: MlbStatKey[] = Object.keys(MLB_MARKET_MAP) as MlbStatKey[];

export const MLB_ODDS_API_MARKETS: string[] = MLB_STAT_KEYS.map(
  (k) => MLB_MARKET_MAP[k].oddsApiMarket,
);

/** The Odds API sport key used for MLB endpoints. */
export const MLB_ODDS_API_SPORT = "baseball_mlb";

/** Reverse lookup: Odds API market → internal stat key. */
export function statKeyForOddsMarket(market: string): MlbStatKey | null {
  for (const k of MLB_STAT_KEYS) {
    if (MLB_MARKET_MAP[k].oddsApiMarket === market) return k;
  }
  return null;
}
