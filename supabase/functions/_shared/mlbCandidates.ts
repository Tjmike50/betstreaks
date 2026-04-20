// =============================================================================
// MLB Candidate Feed — first AI candidate layer for BetStreaks (v1).
//
// Reads from `player_prop_scores` (sport='MLB', anchor stats only) and exposes
// two entry points used by the AI Builder + Daily Pick edge functions:
//
//   • getMlbBuilderCandidates(client, opts)  → broader pool for AI Builder.
//   • getMlbDailyPickCandidates(client, opts) → stricter pool for Daily Pick.
//
// Scope (v1):
//   - Sport: MLB only.
//   - Stats: HITS, TOTAL_BASES, STRIKEOUTS (the 3 anchor props currently
//     scored by `score-mlb-anchors`). Other 4 MLB props (HR, ER, BB, H allowed)
//     are intentionally excluded until they're scored.
//   - Source: `player_prop_scores` rows with sport='MLB' for the requested
//     game_date.
//
// Filtering / ranking is intentionally lean and practical for v1. The fields
// returned are sufficient for downstream LLM prompting (player, stat, line,
// score axes, confidence tier, summary_json) and for matching back to
// line_snapshots when odds enrichment is added later.
// =============================================================================

// deno-lint-ignore no-explicit-any
type SupabaseLike = any;

/** MLB v1 anchor stats supported by the scorer + this candidate feed. */
export const MLB_ANCHOR_STATS = ["HITS", "TOTAL_BASES", "STRIKEOUTS"] as const;
export type MlbAnchorStat = (typeof MLB_ANCHOR_STATS)[number];

/** Confidence tiers written by score-mlb-anchors. */
export type MlbConfidenceTier = "elite" | "strong" | "lean" | "pass";

/** Stat → human label for prompts / UI. */
export const MLB_STAT_LABELS: Record<string, string> = {
  HITS: "Hits",
  TOTAL_BASES: "Total Bases",
  STRIKEOUTS: "Strikeouts",
};

export function mlbStatLabel(stat: string): string {
  return MLB_STAT_LABELS[stat.toUpperCase()] ?? stat;
}

/**
 * Shape returned to callers. Mirrors the columns required by downstream AI
 * generation + slip persistence. `summary_json` is whatever the scorer wrote
 * (axis breakdown, reason tags, etc.) and is passed through untouched.
 */
export interface MlbCandidate {
  id: string;
  sport: "MLB";
  game_date: string;
  player_id: number;
  player_name: string;
  team_abbr: string | null;
  opponent_abbr: string | null;
  home_away: string | null;
  stat_type: MlbAnchorStat;
  threshold: number;

  // Multi-axis scores (0–100, nullable until scored).
  score_overall: number | null;
  score_recent_form: number | null;
  score_matchup: number | null;
  score_opportunity: number | null;
  score_consistency: number | null;
  score_value: number | null;
  score_risk: number | null;
  confidence_tier: MlbConfidenceTier | null;

  // Legacy mirrored fields the existing AI flow already understands.
  confidence_score: number | null;
  value_score: number | null;
  last10_avg: number | null;
  season_avg: number | null;

  // Free-form scorer summary (axis breakdown, tags, etc.).
  summary_json: unknown;
}

const SELECT_COLUMNS =
  "id, sport, game_date, player_id, player_name, team_abbr, opponent_abbr, home_away, stat_type, threshold, score_overall, score_recent_form, score_matchup, score_opportunity, score_consistency, score_value, score_risk, confidence_tier, confidence_score, value_score, last10_avg, season_avg, summary_json";

interface BaseOpts {
  /** YYYY-MM-DD; defaults to today (UTC). */
  gameDate?: string;
  /** Hard cap on rows returned. */
  limit?: number;
  /** Override which anchor stats to include. Defaults to all 3. */
  stats?: readonly MlbAnchorStat[];
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Common DB load — handles `sport='MLB'`, anchor-stat scoping, date filter,
 * over-fetch, and a sane outer cap. Filtering/ranking is applied by the two
 * public entry points below.
 */
async function loadMlbScoredRows(
  client: SupabaseLike,
  opts: BaseOpts,
): Promise<MlbCandidate[]> {
  const gameDate = opts.gameDate ?? todayUtc();
  const stats = (opts.stats ?? MLB_ANCHOR_STATS) as readonly string[];
  const cap = Math.max(1, Math.min(opts.limit ?? 200, 1000));

  const { data, error } = await client
    .from("player_prop_scores")
    .select(SELECT_COLUMNS)
    .eq("sport", "MLB")
    .eq("game_date", gameDate)
    .in("stat_type", stats as string[])
    // Pull more than needed; the entry points re-rank + slice.
    .order("score_overall", { ascending: false, nullsFirst: false })
    .limit(cap);

  if (error) {
    console.warn(
      `[mlbCandidates] load failed (${gameDate}): ${error.message}`,
    );
    return [];
  }
  return (data ?? []) as MlbCandidate[];
}

/**
 * Drop the obvious junk before either feed sees it. Currently only excludes
 * the `pass` tier (clearly weak/noisy candidates) and rows missing a usable
 * threshold. Kept conservative for v1 so we don't accidentally starve the
 * builder during early MLB ingestion.
 */
function dropWeak(rows: MlbCandidate[]): MlbCandidate[] {
  return rows.filter(
    (r) =>
      r.confidence_tier !== "pass" &&
      r.threshold != null &&
      Number(r.threshold) > 0 &&
      !!r.player_name &&
      !!r.stat_type &&
      // anchor-v1: synth-id rows from the pre-name-resolution era are stale
      // junk — they never have rolling stats joined. Exclude from both feeds.
      r.player_id > 0,
  );
}

// ---------------------------------------------------------------------------
// AI Builder feed
// ---------------------------------------------------------------------------

export interface BuilderFeedOpts extends BaseOpts {
  /**
   * Minimum overall score to keep. Default 50 — the LLM still needs enough
   * candidates to choose from for a multi-leg slip.
   */
  minOverall?: number;
  /**
   * Max candidates per player to keep variety (across stat types). Default 2.
   */
  maxPerPlayer?: number;
  /** Final cap on returned rows. Default 60. */
  limit?: number;
}

/**
 * Broader candidate pool for the AI Builder. Practical filtering:
 *   • only MLB anchor props
 *   • exclude `confidence_tier='pass'`
 *   • require `score_overall >= minOverall` (default 50)
 *   • cap per player so the LLM doesn't see the same name 5 times
 *   • rank by score_overall, then confidence_tier, then score_value
 */
export async function getMlbBuilderCandidates(
  client: SupabaseLike,
  opts: BuilderFeedOpts = {},
): Promise<MlbCandidate[]> {
  const minOverall = opts.minOverall ?? 50;
  const maxPerPlayer = Math.max(1, opts.maxPerPlayer ?? 2);
  const finalLimit = Math.max(1, opts.limit ?? 60);

  const raw = await loadMlbScoredRows(client, {
    gameDate: opts.gameDate,
    stats: opts.stats,
    // Over-fetch so per-player capping has room to work.
    limit: Math.min(finalLimit * 6, 600),
  });

  const filtered = dropWeak(raw).filter(
    (r) => (r.score_overall ?? 0) >= minOverall,
  );

  filtered.sort((a, b) => {
    const ao = a.score_overall ?? 0;
    const bo = b.score_overall ?? 0;
    if (bo !== ao) return bo - ao;
    const at = tierWeight(a.confidence_tier);
    const bt = tierWeight(b.confidence_tier);
    if (bt !== at) return bt - at;
    return (b.score_value ?? 0) - (a.score_value ?? 0);
  });

  // Per-player cap.
  const perPlayer = new Map<number, number>();
  const out: MlbCandidate[] = [];
  for (const c of filtered) {
    const seen = perPlayer.get(c.player_id) ?? 0;
    if (seen >= maxPerPlayer) continue;
    perPlayer.set(c.player_id, seen + 1);
    out.push(c);
    if (out.length >= finalLimit) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Daily Pick feed
// ---------------------------------------------------------------------------

export interface DailyPickFeedOpts extends BaseOpts {
  /** Acceptable confidence tiers. Default ['elite','strong','lean']. */
  acceptedTiers?: MlbConfidenceTier[];
  /** Minimum overall score. Default 55 (anchor-v1: lean is acceptable). */
  minOverall?: number;
  /** Final cap on returned rows. Default 25. */
  limit?: number;
  /**
   * STRIKEOUTS coverage is still sparse in anchor-v1 (few pitcher rolling rows
   * + neutral matchup data). Drop them from Daily Pick by default so we don't
   * promote low-signal K legs. AI Builder still sees them for variety.
   */
  excludeWeakStrikeouts?: boolean;
}

/**
 * Stricter candidate pool for Daily Pick. Anchor-v1 calibration:
 *   • only MLB anchor props (HITS, TOTAL_BASES; STRIKEOUTS dropped by default)
 *   • `confidence_tier in (elite, strong, lean)` — lean is acceptable now
 *     that name resolution is real and tiers actually mean something
 *   • `score_overall >= 55` by default
 *   • ranked by score_overall (tier-weighted tiebreak)
 */
export async function getMlbDailyPickCandidates(
  client: SupabaseLike,
  opts: DailyPickFeedOpts = {},
): Promise<MlbCandidate[]> {
  const acceptedTiers = opts.acceptedTiers ?? ["elite", "strong", "lean"];
  const minOverall = opts.minOverall ?? 55;
  const finalLimit = Math.max(1, opts.limit ?? 25);
  const excludeWeakK = opts.excludeWeakStrikeouts ?? true;

  const raw = await loadMlbScoredRows(client, {
    gameDate: opts.gameDate,
    stats: opts.stats,
    limit: Math.min(finalLimit * 8, 500),
  });

  const filtered = dropWeak(raw).filter((r) => {
    if (r.player_id <= 0) return false; // anchor-v1: stale synth ids never reach Daily Pick
    if ((r.score_overall ?? 0) < minOverall) return false;
    if (!r.confidence_tier) return false;
    if (!acceptedTiers.includes(r.confidence_tier)) return false;
    if (excludeWeakK && r.stat_type === "STRIKEOUTS") return false;
    return true;
  });

  filtered.sort((a, b) => {
    const ao = a.score_overall ?? 0;
    const bo = b.score_overall ?? 0;
    if (bo !== ao) return bo - ao;
    return tierWeight(b.confidence_tier) - tierWeight(a.confidence_tier);
  });

  return filtered.slice(0, finalLimit);
}

function tierWeight(tier: MlbConfidenceTier | null): number {
  switch (tier) {
    case "elite":
      return 3;
    case "strong":
      return 2;
    case "lean":
      return 1;
    default:
      return 0;
  }
}

/**
 * Decide Over/Under from rolling averages — same heuristic as the existing
 * basketball Daily Pick uses, adapted for MLB. If recent form is well below
 * the line we suggest Under; otherwise Over (the default for MLB props,
 * since most positive scores point that way for hitters/pitchers alike).
 */
export function inferMlbSide(c: MlbCandidate): "Over" | "Under" {
  const recent = c.last10_avg ?? c.season_avg ?? 0;
  if (c.threshold > 0 && recent < c.threshold * 0.85) return "Under";
  return "Over";
}
