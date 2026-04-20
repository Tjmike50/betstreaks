// ============================================================
// BetStreaks — MLB rolling stats / matchup / team-offense rebuilds
//
// Reads from:
//   • mlb_hitter_game_logs
//   • mlb_pitcher_game_logs
//
// Writes to:
//   • mlb_player_prop_rolling_stats
//   • mlb_pitcher_matchup_summaries
//   • mlb_team_offense_daily
//
// All rebuilds are per-`as_of_date` and per-window. v1 keeps the
// math simple: arithmetic mean over the last N games for averages,
// share of games where value > 0 for hit rates, std-dev based
// volatility/consistency. Splits (home/away, vs_left/vs_right) are
// computed in a single pass.
//
// v1 anchor stat keys covered here:
//   batter:  HITS, TOTAL_BASES
//   pitcher: STRIKEOUTS
// (We also write HOME_RUNS / EARNED_RUNS_ALLOWED / WALKS_ALLOWED /
// HITS_ALLOWED rolling rows when fields exist — they're free given
// the game-log payload — but they're not yet consumed by scoring.)
// ============================================================

import {
  MLB_MARKET_MAP,
  type MlbStatKey,
} from "./mlbMarketMap.ts";

type Supa = { from: (table: string) => any };

export interface RebuildResult {
  step: string;
  rows: number;
  skipped?: boolean;
  reason?: string;
  error?: string;
}

// ── stats helpers ──────────────────────────────────────────

function mean(vals: number[]): number | null {
  if (vals.length === 0) return null;
  let s = 0;
  for (const v of vals) s += v;
  return s / vals.length;
}

function stddev(vals: number[]): number | null {
  if (vals.length < 2) return null;
  const m = mean(vals)!;
  let acc = 0;
  for (const v of vals) acc += (v - m) ** 2;
  return Math.sqrt(acc / vals.length);
}

/** consistency: 100 = perfectly stable, 0 = wildly volatile.
 *  Defined as 100 * (1 - clamp01(stddev / max(mean, 1))). */
function consistencyScore(vals: number[]): number | null {
  if (vals.length < 3) return null;
  const m = mean(vals)!;
  const sd = stddev(vals)!;
  const denom = Math.max(m, 1);
  const ratio = Math.min(1, sd / denom);
  return Math.round((1 - ratio) * 100);
}

/** volatility is the inverse-ish: higher stddev → higher score. 0..100 */
function volatilityScore(vals: number[]): number | null {
  if (vals.length < 3) return null;
  const sd = stddev(vals)!;
  const m = mean(vals)!;
  const denom = Math.max(m, 1);
  return Math.round(Math.min(1, sd / denom) * 100);
}

function lastN<T extends { game_date: string }>(rows: T[], n: number): T[] {
  // rows expected sorted DESC by game_date
  return rows.slice(0, n);
}

/** hit-rate against a fixed threshold; for v1 rolling rebuild we use
 *  a "ghost" threshold = round(mean) so it's a rough self-comparison.
 *  Real per-line hit rates are computed per snapshot inside score-mlb-anchors. */
function selfHitRate(vals: number[]): number | null {
  if (vals.length === 0) return null;
  const m = mean(vals)!;
  const t = Math.max(0.5, Math.round(m * 2) / 2 - 0.5); // e.g. mean 1.2 → 0.5
  let hits = 0;
  for (const v of vals) if (v > t) hits++;
  return Math.round((hits / vals.length) * 100) / 100;
}

// ── rolling stats rebuild ──────────────────────────────────

interface PlayerWindowAgg {
  player_id: number;
  market_type_key: MlbStatKey;
  asOfDate: string;
  l5: number[];
  l10: number[];
  l15: number[];
  home: number[];
  away: number[];
  vsLeft: number[];   // not populated for hitters in v1 (no opp pitcher hand here)
  vsRight: number[];
  sample: number;
}

/**
 * Rebuild rolling stats for the 3 anchor markets across the lookback window.
 * Reads raw logs from the DB (paginated to bypass the 1k row cap).
 */
export async function rebuildRollingStats(
  supabase: Supa,
  asOfDate: string,
  windowDays: number,
): Promise<RebuildResult> {
  try {
    const startDate = isoDaysAgo(asOfDate, windowDays);

    // ── pull hitter logs ───
    const hitterLogs = await fetchAllPaginated(supabase, "mlb_hitter_game_logs", {
      gteCol: "game_date",
      gteVal: startDate,
      lteCol: "game_date",
      lteVal: asOfDate,
      orderCol: "game_date",
      ascending: false,
      select:
        "player_id,game_date,is_home,hits,total_bases,home_runs",
    });

    // ── pull pitcher logs ───
    const pitcherLogs = await fetchAllPaginated(supabase, "mlb_pitcher_game_logs", {
      gteCol: "game_date",
      gteVal: startDate,
      lteCol: "game_date",
      lteVal: asOfDate,
      orderCol: "game_date",
      ascending: false,
      select:
        "player_id,game_date,is_home,strikeouts,walks_allowed,hits_allowed,earned_runs_allowed",
    });

    // ── group ───
    const aggs = new Map<string, PlayerWindowAgg>();
    function pushAgg(
      pid: number,
      key: MlbStatKey,
      val: number | null,
      isHome: boolean | null,
      idx: number,
    ) {
      if (val === null || !Number.isFinite(val)) return;
      const k = `${pid}|${key}`;
      let a = aggs.get(k);
      if (!a) {
        a = {
          player_id: pid,
          market_type_key: key,
          asOfDate,
          l5: [],
          l10: [],
          l15: [],
          home: [],
          away: [],
          vsLeft: [],
          vsRight: [],
          sample: 0,
        };
        aggs.set(k, a);
      }
      a.sample++;
      if (idx < 5) a.l5.push(val);
      if (idx < 10) a.l10.push(val);
      if (idx < 15) a.l15.push(val);
      if (isHome === true) a.home.push(val);
      if (isHome === false) a.away.push(val);
    }

    // hitters: group by player, ordered DESC, then walk
    const hitterByPlayer = groupBy(hitterLogs, "player_id");
    for (const [pidStr, rows] of hitterByPlayer) {
      const pid = Number(pidStr);
      rows.forEach((r: any, i: number) => {
        pushAgg(pid, "HITS", num(r.hits), r.is_home, i);
        pushAgg(pid, "TOTAL_BASES", num(r.total_bases), r.is_home, i);
        pushAgg(pid, "HOME_RUNS", num(r.home_runs), r.is_home, i);
      });
    }
    const pitcherByPlayer = groupBy(pitcherLogs, "player_id");
    for (const [pidStr, rows] of pitcherByPlayer) {
      const pid = Number(pidStr);
      rows.forEach((r: any, i: number) => {
        pushAgg(pid, "STRIKEOUTS", num(r.strikeouts), r.is_home, i);
        pushAgg(pid, "WALKS_ALLOWED", num(r.walks_allowed), r.is_home, i);
        pushAgg(pid, "HITS_ALLOWED", num(r.hits_allowed), r.is_home, i);
        pushAgg(pid, "EARNED_RUNS_ALLOWED", num(r.earned_runs_allowed), r.is_home, i);
      });
    }

    // ── build upsert rows ───
    const upserts: any[] = [];
    for (const a of aggs.values()) {
      // need at least 3 games to bother
      if (a.sample < 3) continue;
      upserts.push({
        player_id: a.player_id,
        market_type_key: a.market_type_key,
        as_of_date: a.asOfDate,
        sample_size: a.sample,
        window_l5_avg: mean(a.l5),
        window_l10_avg: mean(a.l10),
        window_l15_avg: mean(a.l15),
        window_l5_hit_rate: selfHitRate(a.l5),
        window_l10_hit_rate: selfHitRate(a.l10),
        window_l15_hit_rate: selfHitRate(a.l15),
        home_avg: mean(a.home),
        away_avg: mean(a.away),
        vs_left_avg: null,
        vs_right_avg: null,
        consistency_score: consistencyScore(a.l15.length >= 3 ? a.l15 : a.l10),
        volatility_score: volatilityScore(a.l15.length >= 3 ? a.l15 : a.l10),
      });
    }

    if (upserts.length === 0) {
      return { step: "mlb_player_prop_rolling_stats", rows: 0, skipped: true, reason: "no aggregable players" };
    }

    const CHUNK = 400;
    let written = 0;
    for (let i = 0; i < upserts.length; i += CHUNK) {
      const slice = upserts.slice(i, i + CHUNK);
      const { error } = await supabase
        .from("mlb_player_prop_rolling_stats")
        .upsert(slice, { onConflict: "player_id,market_type_key,as_of_date" });
      if (error) throw error;
      written += slice.length;
    }
    console.log(`[mlb-rebuild] rolling_stats rows=${written} (players=${aggs.size})`);
    return { step: "mlb_player_prop_rolling_stats", rows: written };
  } catch (e: any) {
    return { step: "mlb_player_prop_rolling_stats", rows: 0, error: String(e?.message ?? e) };
  }
}

// ── pitcher matchup summaries ──────────────────────────────

export async function rebuildPitcherMatchupSummaries(
  supabase: Supa,
  asOfDate: string,
  windowDays: number,
): Promise<RebuildResult> {
  try {
    const startDate = isoDaysAgo(asOfDate, windowDays);

    const logs = await fetchAllPaginated(supabase, "mlb_pitcher_game_logs", {
      gteCol: "game_date",
      gteVal: startDate,
      lteCol: "game_date",
      lteVal: asOfDate,
      orderCol: "game_date",
      ascending: false,
      select:
        "player_id,game_date,strikeouts,walks_allowed,hits_allowed,earned_runs_allowed,home_runs_allowed",
    });

    const byPitcher = groupBy(logs, "player_id");
    const upserts: any[] = [];

    for (const [pidStr, rows] of byPitcher) {
      const last = (rows as any[]).slice(0, windowDays);
      if (last.length < 2) continue;
      upserts.push({
        pitcher_id: Number(pidStr),
        as_of_date: asOfDate,
        window_size: last.length,
        strikeouts_avg: mean(last.map((r) => num(r.strikeouts) ?? 0)),
        walks_allowed_avg: mean(last.map((r) => num(r.walks_allowed) ?? 0)),
        hits_allowed_avg: mean(last.map((r) => num(r.hits_allowed) ?? 0)),
        earned_runs_allowed_avg: mean(last.map((r) => num(r.earned_runs_allowed) ?? 0)),
        home_runs_allowed_avg: mean(last.map((r) => num(r.home_runs_allowed) ?? 0)),
        // vs L/R splits stubbed for v1 — schema accepts JSONB, future job will fill
        vs_left_json: null,
        vs_right_json: null,
      });
    }

    if (upserts.length === 0) {
      return { step: "mlb_pitcher_matchup_summaries", rows: 0, skipped: true, reason: "no pitchers" };
    }

    const CHUNK = 300;
    let written = 0;
    for (let i = 0; i < upserts.length; i += CHUNK) {
      const slice = upserts.slice(i, i + CHUNK);
      const { error } = await supabase
        .from("mlb_pitcher_matchup_summaries")
        .upsert(slice, { onConflict: "pitcher_id,as_of_date,window_size" });
      if (error) throw error;
      written += slice.length;
    }
    console.log(`[mlb-rebuild] pitcher_matchup_summaries rows=${written}`);
    return { step: "mlb_pitcher_matchup_summaries", rows: written };
  } catch (e: any) {
    return { step: "mlb_pitcher_matchup_summaries", rows: 0, error: String(e?.message ?? e) };
  }
}

// ── team offense daily ─────────────────────────────────────
// Aggregates hitter logs by team_id within window, split_type='overall'.
// Other splits (vs_left/vs_right pitcher) are stubbed for v1.

export async function rebuildTeamOffenseDaily(
  supabase: Supa,
  asOfDate: string,
  windowDays: number,
): Promise<RebuildResult> {
  try {
    const startDate = isoDaysAgo(asOfDate, windowDays);
    const logs = await fetchAllPaginated(supabase, "mlb_hitter_game_logs", {
      gteCol: "game_date",
      gteVal: startDate,
      lteCol: "game_date",
      lteVal: asOfDate,
      orderCol: "game_date",
      ascending: false,
      select:
        "team_id,game_id,game_date,plate_appearances,at_bats,hits,total_bases,walks,strikeouts,home_runs,runs,doubles,triples",
    });

    // Group by team_id+game_id → game-level totals
    const teamGameTotals = new Map<string, {
      team_id: number;
      game_id: string;
      runs: number; hits: number; pa: number; ab: number;
      walks: number; ks: number; tb: number; hr: number; doubles: number; triples: number;
    }>();
    for (const r of logs as any[]) {
      const tid = num(r.team_id);
      if (tid === null) continue;
      const k = `${tid}|${r.game_id}`;
      let t = teamGameTotals.get(k);
      if (!t) {
        t = {
          team_id: tid, game_id: r.game_id,
          runs: 0, hits: 0, pa: 0, ab: 0, walks: 0, ks: 0, tb: 0, hr: 0, doubles: 0, triples: 0,
        };
        teamGameTotals.set(k, t);
      }
      t.runs += num(r.runs) ?? 0;
      t.hits += num(r.hits) ?? 0;
      t.pa += num(r.plate_appearances) ?? 0;
      t.ab += num(r.at_bats) ?? 0;
      t.walks += num(r.walks) ?? 0;
      t.ks += num(r.strikeouts) ?? 0;
      t.tb += num(r.total_bases) ?? 0;
      t.hr += num(r.home_runs) ?? 0;
      t.doubles += num(r.doubles) ?? 0;
      t.triples += num(r.triples) ?? 0;
    }

    // Roll up to per-team window aggregates
    const byTeam = new Map<number, typeof teamGameTotals extends Map<string, infer V> ? V[] : never>();
    for (const t of teamGameTotals.values()) {
      const arr = byTeam.get(t.team_id) ?? [];
      arr.push(t);
      byTeam.set(t.team_id, arr);
    }

    const upserts: any[] = [];
    for (const [teamId, games] of byTeam) {
      const gp = games.length;
      if (gp < 2) continue;
      const sumRuns = games.reduce((a, g) => a + g.runs, 0);
      const sumHits = games.reduce((a, g) => a + g.hits, 0);
      const sumPA = games.reduce((a, g) => a + g.pa, 0);
      const sumAB = games.reduce((a, g) => a + g.ab, 0);
      const sumBB = games.reduce((a, g) => a + g.walks, 0);
      const sumK = games.reduce((a, g) => a + g.ks, 0);
      const sumTB = games.reduce((a, g) => a + g.tb, 0);
      const sumH = sumHits;
      const sumDoubles = games.reduce((a, g) => a + g.doubles, 0);
      const sumTriples = games.reduce((a, g) => a + g.triples, 0);
      const sumHR = games.reduce((a, g) => a + g.hr, 0);

      // Simplified OPS: OBP + SLG  (ignores HBP, sac flies)
      const obp = sumPA > 0 ? (sumH + sumBB) / sumPA : null;
      const slg = sumAB > 0 ? sumTB / sumAB : null;
      const ops = obp !== null && slg !== null ? obp + slg : null;
      const singles = sumH - sumDoubles - sumTriples - sumHR;
      // ISO = SLG - AVG; AVG = H/AB
      const avg = sumAB > 0 ? sumH / sumAB : null;
      const iso = slg !== null && avg !== null ? Math.max(0, slg - avg) : null;

      upserts.push({
        team_id: teamId,
        as_of_date: asOfDate,
        window_size: gp,
        split_type: "overall",
        runs_per_game: sumRuns / gp,
        hits_per_game: sumHits / gp,
        walk_rate: sumPA > 0 ? sumBB / sumPA : null,
        strikeout_rate: sumPA > 0 ? sumK / sumPA : null,
        ops,
        isolated_power: iso,
      });
    }

    if (upserts.length === 0) {
      return { step: "mlb_team_offense_daily", rows: 0, skipped: true, reason: "no teams aggregated" };
    }

    const CHUNK = 200;
    let written = 0;
    for (let i = 0; i < upserts.length; i += CHUNK) {
      const slice = upserts.slice(i, i + CHUNK);
      const { error } = await supabase
        .from("mlb_team_offense_daily")
        .upsert(slice, { onConflict: "team_id,as_of_date,split_type,window_size" });
      if (error) throw error;
      written += slice.length;
    }
    console.log(`[mlb-rebuild] team_offense_daily rows=${written}`);
    return { step: "mlb_team_offense_daily", rows: written };
  } catch (e: any) {
    return { step: "mlb_team_offense_daily", rows: 0, error: String(e?.message ?? e) };
  }
}

// ── shared utilities ───────────────────────────────────────

function num(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isoDaysAgo(endDateStr: string, daysBack: number): string {
  const d = new Date(`${endDateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - daysBack);
  return d.toISOString().slice(0, 10);
}

function groupBy<T extends Record<string, any>>(rows: T[], key: string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = String(r[key]);
    const arr = m.get(k) ?? [];
    arr.push(r);
    m.set(k, arr);
  }
  return m;
}

interface PaginatedSelectOpts {
  gteCol: string;
  gteVal: string;
  lteCol: string;
  lteVal: string;
  orderCol: string;
  ascending: boolean;
  select: string;
}

/** Bypasses Supabase's 1k row default by paginating in 1k chunks. */
async function fetchAllPaginated(
  supabase: Supa,
  table: string,
  opts: PaginatedSelectOpts,
): Promise<any[]> {
  const PAGE = 1000;
  let from = 0;
  const all: any[] = [];
  // Hard ceiling so a runaway query can't loop forever.
  const MAX_ROWS = 50_000;
  while (all.length < MAX_ROWS) {
    const { data, error } = await supabase
      .from(table)
      .select(opts.select)
      .gte(opts.gteCol, opts.gteVal)
      .lte(opts.lteCol, opts.lteVal)
      .order(opts.orderCol, { ascending: opts.ascending })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

// Avoid an unused-import warning while keeping the type relationship visible.
export const _MLB_MARKET_KEYS_USED: MlbStatKey[] = ["HITS", "TOTAL_BASES", "STRIKEOUTS"];
void MLB_MARKET_MAP;
