// =============================================================================
// MLB Candidate Feed — v1 (anchors + 4 expansion props).
//
// Reads from `player_prop_scores` (sport='MLB') and exposes two entry points:
//
//   • getMlbBuilderCandidates(client, opts)  → broader pool for AI Builder.
//   • getMlbDailyPickCandidates(client, opts) → stricter pool for Daily Pick.
//
// Scope (v1):
//   - Sport: MLB only.
//   - Stats: HITS, TOTAL_BASES, STRIKEOUTS (anchors) +
//            HOME_RUNS, EARNED_RUNS_ALLOWED, WALKS_ALLOWED, HITS_ALLOWED.
//   - Source: `player_prop_scores` rows with sport='MLB' for the requested
//     game_date, scored by score-mlb-anchors.
//
// Per-stat strictness (locked for v1 to avoid product pollution):
//   - HOME_RUNS: very selective (elite/strong only, high min_overall).
//   - WALKS_ALLOWED: selective (elite/strong, mid-high min_overall).
//   - EARNED_RUNS_ALLOWED / HITS_ALLOWED: lean tier acceptable if score clean.
//   - Anchors (HITS / TOTAL_BASES / STRIKEOUTS): lowest gates — they are the
//     reliable backbone of the product.
// =============================================================================

// deno-lint-ignore no-explicit-any
type SupabaseLike = any;

/** All MLB v1 stats supported by score-mlb-anchors. */
export const MLB_ANCHOR_STATS = [
  "HITS",
  "TOTAL_BASES",
  "STRIKEOUTS",
  "HOME_RUNS",
  "EARNED_RUNS_ALLOWED",
  "WALKS_ALLOWED",
  "HITS_ALLOWED",
] as const;
export type MlbAnchorStat = (typeof MLB_ANCHOR_STATS)[number];

/** Confidence tiers written by score-mlb-anchors. */
export type MlbConfidenceTier = "elite" | "strong" | "lean" | "pass";

/** Stat → human label for prompts / UI. */
export const MLB_STAT_LABELS: Record<string, string> = {
  HITS: "Hits",
  TOTAL_BASES: "Total Bases",
  STRIKEOUTS: "Strikeouts",
  HOME_RUNS: "Home Runs",
  EARNED_RUNS_ALLOWED: "Earned Runs Allowed",
  WALKS_ALLOWED: "Walks Allowed",
  HITS_ALLOWED: "Hits Allowed",
};

export function mlbStatLabel(stat: string): string {
  return MLB_STAT_LABELS[stat.toUpperCase()] ?? stat;
}

/**
 * Per-stat strictness profile. Keeps anchors loose so they remain the product
 * backbone; tightens the 4 new props so noisy rows don't pollute the feed.
 */
interface StatProfile {
  builderMinOverall: number;
  dailyPickMinOverall: number;
  /** Tiers acceptable on Daily Pick. Builder always allows lean+ */
  dailyPickTiers: MlbConfidenceTier[];
  /** Soft cap to prevent any one stat dominating the slip menu. */
  builderShareMax: number;
  dailyPickShareMax: number;
}

const STAT_PROFILES: Record<MlbAnchorStat, StatProfile> = {
  // Anchors: backbone of the product.
  HITS:                { builderMinOverall: 50, dailyPickMinOverall: 55, dailyPickTiers: ["elite", "strong", "lean"], builderShareMax: 0.50, dailyPickShareMax: 0.60 },
  TOTAL_BASES:         { builderMinOverall: 50, dailyPickMinOverall: 55, dailyPickTiers: ["elite", "strong", "lean"], builderShareMax: 0.50, dailyPickShareMax: 0.60 },
  STRIKEOUTS:          { builderMinOverall: 55, dailyPickMinOverall: 60, dailyPickTiers: ["elite", "strong"],         builderShareMax: 0.30, dailyPickShareMax: 0.34 },
  // Expansion: stricter to avoid weak/noisy promotion.
  HOME_RUNS:           { builderMinOverall: 60, dailyPickMinOverall: 70, dailyPickTiers: ["elite", "strong"],         builderShareMax: 0.20, dailyPickShareMax: 0.20 },
  WALKS_ALLOWED:       { builderMinOverall: 58, dailyPickMinOverall: 65, dailyPickTiers: ["elite", "strong"],         builderShareMax: 0.20, dailyPickShareMax: 0.25 },
  EARNED_RUNS_ALLOWED: { builderMinOverall: 55, dailyPickMinOverall: 60, dailyPickTiers: ["elite", "strong", "lean"], builderShareMax: 0.25, dailyPickShareMax: 0.34 },
  HITS_ALLOWED:        { builderMinOverall: 55, dailyPickMinOverall: 60, dailyPickTiers: ["elite", "strong", "lean"], builderShareMax: 0.25, dailyPickShareMax: 0.34 },
};

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
  /** Override which stats to include. Defaults to all 7. */
  stats?: readonly MlbAnchorStat[];
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Common DB load — handles `sport='MLB'`, stat scoping, date filter,
 * over-fetch, and a sane outer cap. Filtering/ranking is applied by the
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
 * Drop the obvious junk before either feed sees it. Excludes the `pass` tier,
 * stale synthetic-id rows (player_id < 0), and rows with no usable threshold.
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
 * Apply per-stat share caps so no single stat (especially HR/BB-allowed)
 * dominates the returned pool. `caps` maps stat → max share (0..1) of the
 * total returned set.
 */
function applyStatShareCap(
  rows: MlbCandidate[],
  caps: Record<MlbAnchorStat, number>,
  finalLimit: number,
): MlbCandidate[] {
  const perStatLimit = new Map<string, number>();
  for (const stat of MLB_ANCHOR_STATS) {
    perStatLimit.set(stat, Math.max(1, Math.floor(caps[stat] * finalLimit)));
  }
  const perStatCount = new Map<string, number>();
  const out: MlbCandidate[] = [];
  for (const c of rows) {
    const max = perStatLimit.get(c.stat_type) ?? finalLimit;
    const cur = perStatCount.get(c.stat_type) ?? 0;
    if (cur >= max) continue;
    perStatCount.set(c.stat_type, cur + 1);
    out.push(c);
    if (out.length >= finalLimit) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// AI Builder feed
// ---------------------------------------------------------------------------

export interface BuilderFeedOpts extends BaseOpts {
  /**
   * Floor for `score_overall`. Per-stat profiles override this upward —
   * anchors keep this floor, expansion props raise it.
   */
  minOverall?: number;
  /** Max candidates per player to keep variety (across stat types). */
  maxPerPlayer?: number;
  /** Final cap on returned rows. */
  limit?: number;
}

/**
 * Broader candidate pool for the AI Builder. Practical filtering:
 *   • only MLB v1 stats (7 props)
 *   • exclude `confidence_tier='pass'` and synthetic-id rows
 *   • require per-stat min score_overall (anchors looser, expansion stricter)
 *   • cap per player so the LLM doesn't see the same name 5 times
 *   • per-stat share caps so HR/BB-allowed don't drown out anchors
 */
export async function getMlbBuilderCandidates(
  client: SupabaseLike,
  opts: BuilderFeedOpts = {},
): Promise<MlbCandidate[]> {
  const baselineMin = opts.minOverall ?? 50;
  const maxPerPlayer = Math.max(1, opts.maxPerPlayer ?? 2);
  const finalLimit = Math.max(1, opts.limit ?? 60);

  const raw = await loadMlbScoredRows(client, {
    gameDate: opts.gameDate,
    stats: opts.stats,
    // Over-fetch so per-player + per-stat capping has room to work.
    limit: Math.min(finalLimit * 8, 800),
  });

  const filtered = dropWeak(raw).filter((r) => {
    const profile = STAT_PROFILES[r.stat_type as MlbAnchorStat];
    const minOverall = profile
      ? Math.max(profile.builderMinOverall, baselineMin)
      : baselineMin;
    return (r.score_overall ?? 0) >= minOverall;
  });

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
  const perPlayerCapped: MlbCandidate[] = [];
  for (const c of filtered) {
    const seen = perPlayer.get(c.player_id) ?? 0;
    if (seen >= maxPerPlayer) continue;
    perPlayer.set(c.player_id, seen + 1);
    perPlayerCapped.push(c);
  }

  // Per-stat share caps to protect anchor visibility.
  const caps: Record<MlbAnchorStat, number> = Object.fromEntries(
    (Object.entries(STAT_PROFILES) as [MlbAnchorStat, StatProfile][]).map(
      ([k, p]) => [k, p.builderShareMax],
    ),
  ) as Record<MlbAnchorStat, number>;
  return applyStatShareCap(perPlayerCapped, caps, finalLimit);
}

// ---------------------------------------------------------------------------
// Daily Pick feed
// ---------------------------------------------------------------------------

export interface DailyPickFeedOpts extends BaseOpts {
  /** Acceptable confidence tiers (overrides per-stat profile if provided). */
  acceptedTiers?: MlbConfidenceTier[];
  /** Baseline minimum overall score; per-stat profile takes the max. */
  minOverall?: number;
  /** Final cap on returned rows. Default 25. */
  limit?: number;
  /**
   * STRIKEOUTS coverage is still sparse in v1. Drop them from Daily Pick by
   * default so we don't promote low-signal K legs. AI Builder still sees them.
   */
  excludeWeakStrikeouts?: boolean;
}

/**
 * Stricter candidate pool for Daily Pick. v1 calibration:
 *   • only MLB v1 stats (7 props)
 *   • per-stat tier + min-overall profile (HR very strict, anchors looser)
 *   • per-stat share caps so HR/BB-allowed can't dominate the pick
 *   • ranked by score_overall (tier-weighted tiebreak)
 */
export async function getMlbDailyPickCandidates(
  client: SupabaseLike,
  opts: DailyPickFeedOpts = {},
): Promise<MlbCandidate[]> {
  const overrideTiers = opts.acceptedTiers ?? null;
  const baselineMin = opts.minOverall ?? 55;
  const finalLimit = Math.max(1, opts.limit ?? 25);
  const excludeWeakK = opts.excludeWeakStrikeouts ?? true;

  const raw = await loadMlbScoredRows(client, {
    gameDate: opts.gameDate,
    stats: opts.stats,
    limit: Math.min(finalLimit * 12, 600),
  });

  const filtered = dropWeak(raw).filter((r) => {
    if (excludeWeakK && r.stat_type === "STRIKEOUTS") return false;
    if (!r.confidence_tier) return false;

    const profile = STAT_PROFILES[r.stat_type as MlbAnchorStat];
    const minOverall = profile
      ? Math.max(profile.dailyPickMinOverall, baselineMin)
      : baselineMin;
    const acceptedTiers = overrideTiers ?? profile?.dailyPickTiers ?? [
      "elite",
      "strong",
    ];

    if ((r.score_overall ?? 0) < minOverall) return false;
    if (!acceptedTiers.includes(r.confidence_tier)) return false;
    return true;
  });

  filtered.sort((a, b) => {
    const ao = a.score_overall ?? 0;
    const bo = b.score_overall ?? 0;
    if (bo !== ao) return bo - ao;
    return tierWeight(b.confidence_tier) - tierWeight(a.confidence_tier);
  });

  const caps: Record<MlbAnchorStat, number> = Object.fromEntries(
    (Object.entries(STAT_PROFILES) as [MlbAnchorStat, StatProfile][]).map(
      ([k, p]) => [k, p.dailyPickShareMax],
    ),
  ) as Record<MlbAnchorStat, number>;
  return applyStatShareCap(filtered, caps, finalLimit);
}

/**
 * Decide Over/Under from rolling averages. For pitcher "allowed" props,
 * we still infer Over when recent allowed > line * 0.85 (i.e. trending into
 * trouble), Under otherwise. Anchors keep the original heuristic.
 */
export function inferMlbSide(c: MlbCandidate): "Over" | "Under" {
  const recent = c.last10_avg ?? c.season_avg ?? 0;
  if (c.threshold > 0 && recent < c.threshold * 0.85) return "Under";
  return "Over";
}
