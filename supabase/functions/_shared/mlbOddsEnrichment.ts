// =============================================================================
// MLB Odds Enrichment (v1) — shared helper for AI Builder + Daily Pick.
//
// Reads `line_snapshots` rows that `collect-line-snapshots` writes when it
// runs in MLB mode. Those rows store `stat_type` as the Odds API market key
// (e.g. "batter_hits", "pitcher_strikeouts"), so we map our internal MLB
// anchor keys (HITS / TOTAL_BASES / STRIKEOUTS) → Odds API market via
// MLB_MARKET_MAP, then look up the latest line for that player + threshold.
//
// Scope (v1):
//   • MLB anchor props only (the 3 currently scored).
//   • Looks up DraftKings first (matches the basketball flow), then any book
//     as a fallback so we still get a usable line during early MLB ingestion.
//   • Returns over_odds / under_odds as raw American strings (e.g. "-110"),
//     same shape downstream code already expects from basketball enrichment.
//
// What is intentionally NOT done here:
//   • No fuzzy player-name matching. The scorer dedupes by (player_id,
//     stat_type, threshold), and snapshots are written with the same
//     `player_name` strings the scorer + candidate feed return.
//   • No consensus pricing across books — first-best wins.
//   • No expected-value math. That's a future layer.
// =============================================================================

import {
  MLB_MARKET_MAP,
  type MlbStatKey,
} from "./mlbMarketMap.ts";
import { MLB_ANCHOR_STATS } from "./mlbCandidates.ts";

// deno-lint-ignore no-explicit-any
type SupabaseLike = any;

export type MlbAnchorSide = "Over" | "Under";

export interface MlbOddsLookupRow {
  player_name: string;
  stat_type: string;       // internal MLB key, e.g. "HITS"
  threshold: number;
}

export interface MlbOddsLookupResult {
  over_odds: string | null;
  under_odds: string | null;
  sportsbook: string | null;
  snapshot_at: string | null;
  /** Which side is requested by the caller (mirrors the basketball flow). */
  side: MlbAnchorSide;
  /** Resolved American odds for the requested side, or null. */
  odds: string | null;
  /** True if a real snapshot was used (not stubbed). */
  matched: boolean;
}

/** Internal MLB v1 stat key → Odds API market label. Accepts all 7 props. */
function oddsMarketForAnchor(stat: string): string | null {
  const upper = stat.toUpperCase();
  if (!(MLB_ANCHOR_STATS as readonly string[]).includes(upper)) return null;
  const m = MLB_MARKET_MAP[upper as MlbStatKey];
  return m?.oddsApiMarket ?? null;
}

/**
 * Look up the latest MLB line snapshot for a single (player, stat, threshold)
 * triple. Tries DraftKings first, then any sportsbook. Returns nulls (matched
 * = false) if nothing usable is found — callers should treat that as
 * "no live odds yet" and continue, same as basketball does.
 */
export async function lookupMlbAnchorOdds(
  client: SupabaseLike,
  row: MlbOddsLookupRow,
  gameDate: string,
  side: MlbAnchorSide,
): Promise<MlbOddsLookupResult> {
  const empty: MlbOddsLookupResult = {
    over_odds: null,
    under_odds: null,
    sportsbook: null,
    snapshot_at: null,
    side,
    odds: null,
    matched: false,
  };

  const market = oddsMarketForAnchor(row.stat_type);
  if (!market || !row.player_name || !(row.threshold > 0)) return empty;

  // 1. DraftKings preferred (matches NBA/WNBA enrichment behavior).
  const dk = await client
    .from("line_snapshots")
    .select("over_odds, under_odds, sportsbook, snapshot_at")
    .eq("player_name", row.player_name)
    .eq("stat_type", market)
    .eq("threshold", row.threshold)
    .eq("game_date", gameDate)
    .eq("sportsbook", "draftkings")
    .order("snapshot_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let snap = dk?.data ?? null;

  // 2. Fall back to any sportsbook (during early MLB ingestion DK may be missing).
  if (!snap) {
    const any = await client
      .from("line_snapshots")
      .select("over_odds, under_odds, sportsbook, snapshot_at")
      .eq("player_name", row.player_name)
      .eq("stat_type", market)
      .eq("threshold", row.threshold)
      .eq("game_date", gameDate)
      .order("snapshot_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    snap = any?.data ?? null;
  }

  if (!snap) return empty;

  const over = (snap.over_odds as string | null) ?? null;
  const under = (snap.under_odds as string | null) ?? null;
  const odds = side === "Over" ? over : under;

  return {
    over_odds: over,
    under_odds: under,
    sportsbook: (snap.sportsbook as string | null) ?? null,
    snapshot_at: (snap.snapshot_at as string | null) ?? null,
    side,
    odds,
    matched: odds != null,
  };
}

/**
 * Batch helper — enrich a list of legs in parallel. Order of results matches
 * input order. Failures fall through as `matched=false` rows.
 */
export async function enrichMlbAnchorLegs<T extends MlbOddsLookupRow>(
  client: SupabaseLike,
  legs: Array<{ row: T; side: MlbAnchorSide }>,
  gameDate: string,
): Promise<MlbOddsLookupResult[]> {
  return await Promise.all(
    legs.map(async ({ row, side }) => {
      try {
        return await lookupMlbAnchorOdds(client, row, gameDate, side);
      } catch (e) {
        console.warn(
          `[mlbOddsEnrichment] lookup failed for ${row.player_name} ${row.stat_type} ${row.threshold}:`,
          e instanceof Error ? e.message : e,
        );
        return {
          over_odds: null,
          under_odds: null,
          sportsbook: null,
          snapshot_at: null,
          side,
          odds: null,
          matched: false,
        };
      }
    }),
  );
}

export { americanToDecimal, decimalToAmerican, parlayAmerican } from "./parlayOdds.ts";
