import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const STAT_MAP: Record<string, string> = {
  pts: "pts", reb: "reb", ast: "ast", fg3m: "fg3m", "3pm": "fg3m", stl: "stl", blk: "blk",
};

const DEFAULT_THRESHOLDS: Record<string, number[]> = {
  pts: [15.5, 19.5, 24.5, 29.5],
  reb: [4.5, 6.5, 8.5, 10.5],
  ast: [3.5, 5.5, 7.5, 9.5],
  fg3m: [1.5, 2.5, 3.5],
  stl: [0.5, 1.5],
  blk: [0.5, 1.5],
};

interface GameLog {
  player_id: number;
  player_name: string;
  team_abbr: string | null;
  game_date: string;
  matchup: string | null;
  pts: number | null;
  reb: number | null;
  ast: number | null;
  fg3m: number | null;
  stl: number | null;
  blk: number | null;
  wl: string | null;
}

interface TeammateContext {
  minutes_trend: "up" | "down" | "stable" | null;
  minutes_trend_note: string | null;
  role_label: "starter" | "bench" | "mixed" | null;
  key_teammates_out: string[];
  teammate_notes: string[];
  with_without_splits: { teammate: string; with_avg: number; without_avg: number; with_games: number; without_games: number }[];
}

interface PlayerAvailability {
  player_id: number;
  player_name: string;
  team_abbr: string | null;
  status: string;  // active, questionable, probable, doubtful, out
  reason: string | null;
  source: string;
  confidence: string;
}

interface AvailabilityContext {
  player_status: string | null;
  availability_notes: string[];
  lineup_confidence: string;  // high, medium, low
  key_teammate_statuses: { name: string; status: string }[];
}

interface MarketMovement {
  opening_line: number | null;
  current_line: number | null;
  line_moved: "up" | "down" | "unchanged" | null;
  opening_odds: string | null;
  current_odds: string | null;
  odds_improved: boolean | null;
  movement_note: string | null;
}

interface FactorAudit {
  factor: string;
  raw_value: number;
  weight: number;
  weighted_contribution: number;
}

interface ScoredProp {
  player_id: number;
  player_name: string;
  team_abbr: string | null;
  opponent_abbr: string | null;
  home_away: string;
  stat_type: string;
  threshold: number;
  last3_avg: number | null;
  last5_avg: number | null;
  last10_avg: number | null;
  last15_avg: number | null;
  season_avg: number | null;
  last5_hit_rate: number | null;
  last10_hit_rate: number | null;
  last15_hit_rate: number | null;
  season_hit_rate: number | null;
  total_games: number;
  vs_opponent_avg: number | null;
  vs_opponent_hit_rate: number | null;
  vs_opponent_games: number;
  home_avg: number | null;
  away_avg: number | null;
  home_hit_rate: number | null;
  away_hit_rate: number | null;
  home_games: number;
  away_games: number;
  confidence_score: number;
  value_score: number;
  volatility_score: number;
  consistency_score: number;
  reason_tags: string[];
  rest_days: number | null;
  back_to_back: boolean;
  games_last_7: number;
  games_last_14: number;
  rest_hit_rate: number | null;
  rest_sample: number;
  opp_def_rank_note: string | null;
  opp_stat_avg_allowed: number | null;
  opp_stat_games: number;
  line_hit_rate_l5: number | null;
  line_hit_rate_l10: number | null;
  line_hit_rate_season: number | null;
  // Teammate context
  minutes_trend: string | null;
  minutes_trend_note: string | null;
  role_label: string | null;
  key_teammates_out: string[];
  teammate_notes: string[];
  // Availability context
  player_status: string | null;
  availability_notes: string[];
  lineup_confidence: string | null;
  // Market movement
  market_movement: MarketMovement | null;
  // Scoring audit
  scoring_audit: FactorAudit[] | null;
}

function parseMatchup(matchup: string | null): { opponent: string | null; homeAway: string } {
  if (!matchup) return { opponent: null, homeAway: "unknown" };
  if (matchup.includes("vs.")) {
    const parts = matchup.split("vs.").map((s) => s.trim());
    return { opponent: parts[1] || null, homeAway: "home" };
  }
  if (matchup.includes("@")) {
    const parts = matchup.split("@").map((s) => s.trim());
    return { opponent: parts[1] || null, homeAway: "away" };
  }
  return { opponent: null, homeAway: "unknown" };
}

function calcAvg(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
}

function calcHitRate(values: number[], threshold: number): number | null {
  if (values.length === 0) return null;
  const hits = values.filter((v) => v >= threshold).length;
  return Math.round((hits / values.length) * 100) / 100;
}

function calcStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a), db = new Date(b);
  return Math.round(Math.abs(da.getTime() - db.getTime()) / 86400000);
}

function computeRestContext(logs: GameLog[], today: string) {
  if (logs.length === 0) return { rest_days: null, back_to_back: false, games_last_7: 0, games_last_14: 0 };
  const lastGameDate = logs[0].game_date;
  const rest_days = daysBetween(today, lastGameDate);
  const back_to_back = rest_days <= 1;
  let games_last_7 = 0, games_last_14 = 0;
  for (const g of logs) {
    const d = daysBetween(today, g.game_date);
    if (d <= 7) games_last_7++;
    if (d <= 14) games_last_14++;
    if (d > 14) break;
  }
  return { rest_days, back_to_back, games_last_7, games_last_14 };
}

function computeRestHitRate(logs: GameLog[], statKey: string, threshold: number, restDays: number | null): { rate: number | null; sample: number } {
  if (restDays == null || logs.length < 5) return { rate: null, sample: 0 };
  const col = STAT_MAP[statKey];
  if (!col) return { rate: null, sample: 0 };
  const bucket = restDays <= 1 ? "b2b" : restDays >= 3 ? "rested" : "normal";
  const vals: number[] = [];
  for (let i = 0; i < logs.length - 1; i++) {
    const val = (logs[i] as any)[col];
    if (val == null) continue;
    const nextGame = logs[i + 1];
    const gap = daysBetween(logs[i].game_date, nextGame.game_date);
    const gameBucket = gap <= 1 ? "b2b" : gap >= 3 ? "rested" : "normal";
    if (gameBucket === bucket) vals.push(val);
  }
  return { rate: calcHitRate(vals, threshold), sample: vals.length };
}

function computeDefensiveContext(
  allPlayerLogs: Record<number, GameLog[]>,
  opponentAbbr: string | null,
  statKey: string
): { avg_allowed: number | null; games: number; note: string | null } {
  if (!opponentAbbr) return { avg_allowed: null, games: 0, note: null };
  const col = STAT_MAP[statKey];
  if (!col) return { avg_allowed: null, games: 0, note: null };
  const vals: number[] = [];
  for (const logs of Object.values(allPlayerLogs)) {
    for (const g of logs) {
      const { opponent } = parseMatchup(g.matchup);
      if (opponent && opponent.trim().toUpperCase() === opponentAbbr.trim().toUpperCase()) {
        const v = (g as any)[col];
        if (v != null) vals.push(v);
      }
    }
  }
  if (vals.length < 5) return { avg_allowed: null, games: vals.length, note: vals.length > 0 ? "small_sample" : null };
  const avg = calcAvg(vals)!;
  return { avg_allowed: avg, games: vals.length, note: null };
}

// ===== TEAMMATE & LINEUP CONTEXT =====

/**
 * Build a map of game_date -> set of player_ids who played that game for a given team.
 */
function buildTeamGameRosters(
  allPlayerLogs: Record<number, GameLog[]>,
  teamAbbr: string
): Map<string, Set<number>> {
  const rosters = new Map<string, Set<number>>();
  for (const [pidStr, logs] of Object.entries(allPlayerLogs)) {
    const pid = Number(pidStr);
    for (const g of logs) {
      if (g.team_abbr !== teamAbbr) continue;
      if (!rosters.has(g.game_date)) rosters.set(g.game_date, new Set());
      rosters.get(g.game_date)!.add(pid);
    }
  }
  return rosters;
}

/**
 * Identify "key teammates" for a player: other players on the same team who appeared
 * in a significant portion of games. Returns top teammates by appearance count.
 */
function identifyKeyTeammates(
  playerId: number,
  playerLogs: GameLog[],
  teamRosters: Map<string, Set<number>>,
  allPlayerLogs: Record<number, GameLog[]>
): { pid: number; name: string; gamesPlayed: number; totalGames: number }[] {
  const playerGameDates = new Set(playerLogs.map(g => g.game_date));
  const teammateCounts: Record<number, { count: number; name: string }> = {};

  for (const date of playerGameDates) {
    const roster = teamRosters.get(date);
    if (!roster) continue;
    for (const pid of roster) {
      if (pid === playerId) continue;
      if (!teammateCounts[pid]) {
        const tmLogs = allPlayerLogs[pid];
        teammateCounts[pid] = { count: 0, name: tmLogs?.[0]?.player_name || `Player ${pid}` };
      }
      teammateCounts[pid].count++;
    }
  }

  // Key teammates: played in >= 50% of this player's games AND have significant scoring (top by games played)
  const total = playerGameDates.size;
  return Object.entries(teammateCounts)
    .filter(([_, v]) => v.count >= Math.max(3, total * 0.3))
    .map(([pid, v]) => ({ pid: Number(pid), name: v.name, gamesPlayed: v.count, totalGames: total }))
    .sort((a, b) => b.gamesPlayed - a.gamesPlayed)
    .slice(0, 8); // top 8 teammates max
}

/**
 * Compute teammate context: with/without splits for key teammates,
 * minutes trend approximation, and role label.
 */
function computeTeammateContext(
  playerId: number,
  playerLogs: GameLog[],
  statKey: string,
  threshold: number,
  teamAbbr: string,
  teamRosters: Map<string, Set<number>>,
  allPlayerLogs: Record<number, GameLog[]>
): TeammateContext {
  const result: TeammateContext = {
    minutes_trend: null,
    minutes_trend_note: null,
    role_label: null,
    key_teammates_out: [],
    teammate_notes: [],
    with_without_splits: [],
  };

  const col = STAT_MAP[statKey];
  if (!col || playerLogs.length < 5) return result;

  // --- Minutes trend approximation ---
  // We don't have minutes directly, so approximate via total stat output (pts+reb+ast) as proxy
  const recentProxy: number[] = [];
  for (const g of playerLogs.slice(0, 15)) {
    const total = (g.pts || 0) + (g.reb || 0) + (g.ast || 0);
    recentProxy.push(total);
  }

  if (recentProxy.length >= 5) {
    const last3Proxy = calcAvg(recentProxy.slice(0, 3)) || 0;
    const last10Proxy = calcAvg(recentProxy.slice(0, Math.min(10, recentProxy.length))) || 0;

    if (last10Proxy > 0) {
      const ratio = last3Proxy / last10Proxy;
      if (ratio > 1.15) {
        result.minutes_trend = "up";
        result.minutes_trend_note = "Usage/minutes trending up (L3 output +15% vs L10)";
      } else if (ratio < 0.85) {
        result.minutes_trend = "down";
        result.minutes_trend_note = "Usage/minutes trending down (L3 output -15% vs L10)";
      } else {
        result.minutes_trend = "stable";
      }
    }
  }

  // --- Role label (starter vs bench) ---
  // Approximate: if player appeared in most recent games consistently and has decent stat output, likely starter
  const recentGames = playerLogs.slice(0, 10);
  const avgOutput = calcAvg(recentProxy.slice(0, 10)) || 0;
  const gamesIn10 = recentGames.length;

  if (gamesIn10 >= 8 && avgOutput >= 15) {
    result.role_label = "starter";
  } else if (gamesIn10 >= 8 && avgOutput >= 8) {
    result.role_label = "starter";
  } else if (gamesIn10 >= 5 && avgOutput < 8) {
    result.role_label = "bench";
  } else {
    result.role_label = "mixed";
  }

  // --- Key teammate with/without splits ---
  const keyTeammates = identifyKeyTeammates(playerId, playerLogs, teamRosters, allPlayerLogs);

  // For the most recent game, check which key teammates are missing (potential "out" detection)
  const mostRecentDate = playerLogs[0]?.game_date;
  const mostRecentRoster = teamRosters.get(mostRecentDate);

  for (const tm of keyTeammates) {
    // Check if this teammate missed recent games
    const recentDates = playerLogs.slice(0, 5).map(g => g.game_date);
    let missedRecent = 0;
    for (const d of recentDates) {
      const roster = teamRosters.get(d);
      if (roster && !roster.has(tm.pid)) missedRecent++;
    }

    // Compute with/without splits for this stat
    const withVals: number[] = [];
    const withoutVals: number[] = [];

    for (const g of playerLogs) {
      const val = (g as any)[col];
      if (val == null) continue;
      const roster = teamRosters.get(g.game_date);
      if (!roster) continue;
      if (roster.has(tm.pid)) {
        withVals.push(val);
      } else {
        withoutVals.push(val);
      }
    }

    // Only report if we have meaningful sample for both
    if (withVals.length >= 3 && withoutVals.length >= 3) {
      const withAvg = calcAvg(withVals)!;
      const withoutAvg = calcAvg(withoutVals)!;
      const diff = withoutAvg - withAvg;
      const pctDiff = withAvg > 0 ? (diff / withAvg) * 100 : 0;

      result.with_without_splits.push({
        teammate: tm.name,
        with_avg: withAvg,
        without_avg: withoutAvg,
        with_games: withVals.length,
        without_games: withoutVals.length,
      });

      // Only generate notes for meaningful differences with adequate sample
      if (Math.abs(pctDiff) >= 15 && withoutVals.length >= 3) {
        if (pctDiff > 0) {
          result.teammate_notes.push(
            `+${Math.round(pctDiff)}% without ${tm.name} (${withoutAvg} avg in ${withoutVals.length}g vs ${withAvg} in ${withVals.length}g)`
          );
        } else {
          result.teammate_notes.push(
            `${Math.round(pctDiff)}% without ${tm.name} (${withoutAvg} avg in ${withoutVals.length}g vs ${withAvg} in ${withVals.length}g)`
          );
        }
      }
    }

    // Flag teammates who are potentially out (missed 3+ of last 5)
    if (missedRecent >= 3 && tm.gamesPlayed >= tm.totalGames * 0.5) {
      result.key_teammates_out.push(tm.name);
    }
  }

  // Limit notes to most impactful
  result.teammate_notes = result.teammate_notes.slice(0, 3);
  result.with_without_splits = result.with_without_splits.slice(0, 3);

  return result;
}

/**
 * Derive player availability from game log patterns when no explicit status exists.
 * Checks for missed games, irregular gaps, and recent inactivity.
 */
function deriveAvailabilityFromLogs(
  playerId: number,
  playerLogs: GameLog[],
  today: string,
  teamGameDates: string[]
): { status: string; reason: string | null; confidence: string } {
  if (playerLogs.length === 0) return { status: "unknown", reason: "no game data", confidence: "low" };

  const lastGameDate = playerLogs[0].game_date;
  const daysSinceLast = daysBetween(today, lastGameDate);

  // If player hasn't played in 10+ days, likely out
  if (daysSinceLast >= 10) {
    return { status: "out", reason: `no game in ${daysSinceLast} days`, confidence: "medium" };
  }

  // Check if player missed recent team games
  const recentTeamGames = teamGameDates.filter(d => {
    const gap = daysBetween(today, d);
    return gap <= 14 && gap > 0;
  }).sort((a, b) => b.localeCompare(a));

  const playerGameDates = new Set(playerLogs.map(g => g.game_date));
  let missedRecent = 0;
  for (const d of recentTeamGames.slice(0, 5)) {
    if (!playerGameDates.has(d)) missedRecent++;
  }

  if (missedRecent >= 3 && recentTeamGames.length >= 4) {
    return { status: "doubtful", reason: `missed ${missedRecent} of last ${Math.min(5, recentTeamGames.length)} team games`, confidence: "medium" };
  }

  if (daysSinceLast >= 5) {
    return { status: "questionable", reason: `${daysSinceLast} days since last game`, confidence: "low" };
  }

  return { status: "active", reason: null, confidence: "high" };
}

/**
 * Compute availability context for a player, incorporating teammate availability.
 */
function computeAvailabilityContext(
  playerId: number,
  playerLogs: GameLog[],
  teamAbbr: string,
  availabilityMap: Map<number, PlayerAvailability>,
  keyTeammateIds: number[],
  allPlayerLogs: Record<number, GameLog[]>,
  today: string,
  teamGameDates: string[],
  availabilityIsFresh = true
): AvailabilityContext {
  const result: AvailabilityContext = {
    player_status: null,
    availability_notes: [],
    lineup_confidence: "high",
    key_teammate_statuses: [],
  };

  // Check explicit availability first
  const explicit = availabilityMap.get(playerId);
  if (explicit) {
    result.player_status = explicit.status;
    if (explicit.status === "out") {
      result.lineup_confidence = "high";
      result.availability_notes.push(`Player OUT${explicit.reason ? ` (${explicit.reason})` : ""}`);
      return result;
    }
    if (explicit.status === "doubtful") {
      result.lineup_confidence = "low";
      result.availability_notes.push(`Player DOUBTFUL${explicit.reason ? ` (${explicit.reason})` : ""}`);
    } else if (explicit.status === "questionable") {
      result.lineup_confidence = "medium";
      result.availability_notes.push(`Player QUESTIONABLE${explicit.reason ? ` (${explicit.reason})` : ""}`);
    } else if (explicit.status === "probable") {
      result.lineup_confidence = "high";
      result.availability_notes.push("Player PROBABLE");
    } else {
      result.player_status = "active";
    }
  } else {
    // Derive from game logs
    const derived = deriveAvailabilityFromLogs(playerId, playerLogs, today, teamGameDates);
    result.player_status = derived.status;
    if (derived.status !== "active") {
      result.lineup_confidence = derived.confidence === "medium" ? "low" : "medium";
      result.availability_notes.push(`Derived ${derived.status}${derived.reason ? `: ${derived.reason}` : ""}`);
    }
  }

  // If availability data is stale/missing, reduce lineup confidence and add note
  if (!availabilityIsFresh && result.lineup_confidence === "high") {
    result.lineup_confidence = "medium";
    result.availability_notes.push("Availability data may be stale");
  }

  // Check key teammate availability
  for (const tmId of keyTeammateIds) {
    const tmExplicit = availabilityMap.get(tmId);
    const tmLogs = allPlayerLogs[tmId] || [];
    let tmStatus: string;
    let tmName: string;

    if (tmExplicit) {
      tmStatus = tmExplicit.status;
      tmName = tmExplicit.player_name;
    } else {
      const derived = deriveAvailabilityFromLogs(tmId, tmLogs, today, teamGameDates);
      tmStatus = derived.status;
      tmName = tmLogs[0]?.player_name || `Player ${tmId}`;
    }

    if (tmStatus !== "active" && tmStatus !== "probable") {
      result.key_teammate_statuses.push({ name: tmName, status: tmStatus });

      if (tmStatus === "questionable") {
        result.availability_notes.push(`Key teammate ${tmName} questionable`);
        if (result.lineup_confidence === "high") result.lineup_confidence = "medium";
      } else if (tmStatus === "doubtful" || tmStatus === "out") {
        result.availability_notes.push(`Key teammate ${tmName} ${tmStatus}`);
      }
    }
  }

  // Cap notes
  result.availability_notes = result.availability_notes.slice(0, 4);

  return result;
}

function scoreProp(
  games: GameLog[],
  statKey: string,
  threshold: number,
  todayOpponent: string | null,
  todayHomeAway: string,
  restCtx: { rest_days: number | null; back_to_back: boolean; games_last_7: number; games_last_14: number },
  restHitCtx: { rate: number | null; sample: number },
  defCtx: { avg_allowed: number | null; games: number; note: string | null },
  allPlayerLogs: Record<number, GameLog[]>,
  teammateCtx: TeammateContext,
  availCtx: AvailabilityContext,
  marketMovement: MarketMovement | null
): ScoredProp | null {
  if (games.length === 0) return null;

  const col = STAT_MAP[statKey];
  if (!col) return null;

  const allValues: number[] = [];
  const homeValues: number[] = [];
  const awayValues: number[] = [];
  const vsOpponentValues: number[] = [];

  for (const g of games) {
    const val = (g as any)[col];
    if (val == null) continue;
    allValues.push(val);
    const { opponent, homeAway } = parseMatchup(g.matchup);
    if (homeAway === "home") homeValues.push(val);
    if (homeAway === "away") awayValues.push(val);
    if (todayOpponent && opponent && opponent.trim().toUpperCase() === todayOpponent.trim().toUpperCase()) {
      vsOpponentValues.push(val);
    }
  }

  if (allValues.length < 3) return null;

  const last3 = allValues.slice(0, 3);
  const last5 = allValues.slice(0, 5);
  const last10 = allValues.slice(0, 10);
  const last15 = allValues.slice(0, 15);

  const last3Avg = calcAvg(last3);
  const last5Avg = calcAvg(last5);
  const last10Avg = calcAvg(last10);
  const last15Avg = calcAvg(last15);
  const seasonAvg = calcAvg(allValues);

  const last5HitRate = calcHitRate(last5, threshold);
  const last10HitRate = calcHitRate(last10, threshold);
  const last15HitRate = calcHitRate(last15, threshold);
  const seasonHitRate = calcHitRate(allValues, threshold);

  const vsOpponentAvg = calcAvg(vsOpponentValues);
  const vsOpponentHitRate = calcHitRate(vsOpponentValues, threshold);

  const homeAvg = calcAvg(homeValues);
  const awayAvg = calcAvg(awayValues);
  const homeHitRate = calcHitRate(homeValues, threshold);
  const awayHitRate = calcHitRate(awayValues, threshold);

  const stdDev = calcStdDev(allValues);
  const mean = seasonAvg || 0;
  const cv = mean > 0 ? (stdDev / mean) * 100 : 50;
  const volatilityScore = Math.min(100, Math.round(cv * 2));
  const consistencyScore = Math.max(0, 100 - volatilityScore);

  // ===== REFINED SCORING ENGINE WITH CALIBRATION =====
  // Sample factor v2: stronger penalty for small samples
  // Floor at 0.35 for 3 games, reaches 0.75 at 15 games, 1.0 at 25+ games
  const sampleFactor = Math.min(1, 0.35 + (Math.min(allValues.length, 25) / 25) * 0.65);

  // Weight allocation (must sum to 1.0)
  const W_RECENT = 0.21;
  const W_SEASON = 0.12;
  const W_TREND = 0.12;
  const W_OPP = 0.09;
  const W_VENUE = 0.08;
  const W_REST = 0.06;
  const W_DEF = 0.09;
  const W_CONSISTENCY = 0.05;
  const W_TEAMMATE = 0.07;
  const W_MINUTES = 0.05;
  const W_MARKET = 0.06;  // Market movement weight

  const recentHR = last5HitRate ?? 0;
  const seasonHR = seasonHitRate ?? 0;
  const trendHR = last3Avg && last10Avg ? (last3Avg > last10Avg ? 0.7 : last3Avg > last10Avg * 0.95 ? 0.5 : 0.3) : 0.5;

  let oppFactor = 0.5;
  if (vsOpponentValues.length >= 3 && vsOpponentHitRate !== null) {
    oppFactor = vsOpponentHitRate;
  } else if (vsOpponentValues.length >= 1 && vsOpponentHitRate !== null) {
    oppFactor = vsOpponentHitRate * 0.3 + seasonHR * 0.7;
  }

  let venueFactor = 0.5;
  const venueHR = todayHomeAway === "home" ? homeHitRate : awayHitRate;
  const venueGames = todayHomeAway === "home" ? homeValues.length : awayValues.length;
  if (venueGames >= 5 && venueHR !== null) {
    venueFactor = venueHR;
  } else if (venueGames >= 2 && venueHR !== null) {
    venueFactor = venueHR * 0.4 + seasonHR * 0.6;
  }

  let restFactor = 0.5;
  if (restHitCtx.sample >= 3 && restHitCtx.rate !== null) {
    restFactor = restHitCtx.rate;
  } else if (restCtx.back_to_back) {
    restFactor = 0.4;
  } else if (restCtx.rest_days != null && restCtx.rest_days >= 3) {
    restFactor = 0.55;
  }

  let defFactor = 0.5;
  if (defCtx.avg_allowed !== null && defCtx.games >= 10 && mean > 0) {
    defFactor = Math.min(1, Math.max(0, 0.5 + (defCtx.avg_allowed - threshold) / (threshold * 2)));
  } else if (defCtx.avg_allowed !== null && defCtx.games >= 5) {
    const raw = 0.5 + (defCtx.avg_allowed - threshold) / (threshold * 2);
    defFactor = raw * 0.6 + 0.5 * 0.4;
  }

  const consistencyFactor = consistencyScore / 100;

  // Teammate factor: if key teammates are out, use with/without data
  let teammateFactor = 0.5;
  if (teammateCtx.key_teammates_out.length > 0 && teammateCtx.with_without_splits.length > 0) {
    // Check if being without key teammates is historically better or worse
    for (const split of teammateCtx.with_without_splits) {
      if (teammateCtx.key_teammates_out.includes(split.teammate) && split.without_games >= 3) {
        const withoutHR = split.without_avg >= threshold ? 0.65 : 0.35;
        teammateFactor = withoutHR;
        break; // use first matching key teammate
      }
    }
  } else if (teammateCtx.role_label === "starter") {
    teammateFactor = 0.55; // slight boost for established starters
  } else if (teammateCtx.role_label === "bench") {
    teammateFactor = 0.4; // slight penalty for bench volatility
  }

  // Minutes/usage trend factor
  let minutesFactor = 0.5;
  if (teammateCtx.minutes_trend === "up") {
    minutesFactor = 0.65;
  } else if (teammateCtx.minutes_trend === "down") {
    minutesFactor = 0.35;
  }

  // Market movement factor
  let marketFactor = 0.5;
  if (marketMovement) {
    if (marketMovement.odds_improved === true) {
      marketFactor = 0.65; // odds moved in our favor
    } else if (marketMovement.odds_improved === false) {
      marketFactor = 0.35; // odds moved against us
    }
    // If line moved up and we're picking over, that's favorable
    if (marketMovement.line_moved === "up" && threshold > 0) {
      marketFactor = Math.max(marketFactor, 0.55);
    }
  }

  // Build scoring audit breakdown
  const auditFactors: { name: string; value: number; weight: number }[] = [
    { name: "recent", value: recentHR, weight: W_RECENT },
    { name: "season", value: seasonHR, weight: W_SEASON },
    { name: "trend", value: trendHR, weight: W_TREND },
    { name: "opponent", value: oppFactor, weight: W_OPP },
    { name: "venue", value: venueFactor, weight: W_VENUE },
    { name: "rest", value: restFactor, weight: W_REST },
    { name: "defense", value: defFactor, weight: W_DEF },
    { name: "consistency", value: consistencyFactor, weight: W_CONSISTENCY },
    { name: "teammate", value: teammateFactor, weight: W_TEAMMATE },
    { name: "minutes", value: minutesFactor, weight: W_MINUTES },
    { name: "market", value: marketFactor, weight: W_MARKET },
  ];

  const scoringAudit: FactorAudit[] = auditFactors.map(f => ({
    factor: f.name,
    raw_value: Math.round(f.value * 1000) / 1000,
    weight: f.weight,
    weighted_contribution: Math.round(f.value * f.weight * 10000) / 100,
  }));

  let rawConfidence = auditFactors.reduce((sum, f) => sum + f.value * f.weight, 0) * 100;

  rawConfidence *= sampleFactor;

  // Availability penalty: reduce confidence for uncertain lineups
  if (availCtx.player_status === "questionable") rawConfidence *= 0.75;
  else if (availCtx.player_status === "doubtful") rawConfidence *= 0.5;
  else if (availCtx.player_status === "out") rawConfidence *= 0.1;

  // Reduce confidence when key teammate status is uncertain
  const uncertainTeammates = availCtx.key_teammate_statuses.filter(
    t => t.status === "questionable" || t.status === "doubtful"
  );
  if (uncertainTeammates.length > 0) {
    rawConfidence *= Math.max(0.7, 1 - uncertainTeammates.length * 0.1);
  }

  if (availCtx.lineup_confidence === "low") rawConfidence *= 0.85;
  else if (availCtx.lineup_confidence === "medium") rawConfidence *= 0.92;

  // ===== CONFIDENCE CALIBRATION CURVE =====
  // Maps raw engine scores to calibrated confidence that better reflects actual hit probabilities.
  // Targets: 80+ → 60-70% hit rate, 70-79 → 55-60%, 60-69 → 50-55%, 50-59 → 45-50%
  // Uses a sigmoid-like compression: compress the upper range, expand the lower range
  function calibrateConfidence(raw: number): number {
    // Normalize to 0-1
    const x = Math.min(100, Math.max(0, raw)) / 100;
    
    // Piecewise linear calibration based on observed data
    // Current actual hit rates by bucket vs targets:
    // 80+ actual: 52.9% → need to push fewer props into 80+ (compress top)
    // 60-69 actual: 48.2% → was overstated, compress
    // 30-39 actual: 36.1% → roughly correct
    
    // Apply sigmoid compression: pushes mid-high scores down, keeps extremes
    // S-curve centered at 0.45 with reduced steepness
    const centered = x - 0.45;
    const sigmoid = 1 / (1 + Math.exp(-4.5 * centered));
    
    // Blend sigmoid with linear, weighted toward sigmoid for compression
    const calibrated = sigmoid * 0.7 + x * 0.3;
    
    // Scale to target range: floor ~15, ceiling ~85
    // This prevents unrealistic 90+ or sub-10 scores
    const scaled = 15 + calibrated * 70;
    
    return scaled;
  }

  const confidenceScore = Math.round(Math.min(100, Math.max(0, calibrateConfidence(rawConfidence))));

  const avgOverThreshold = mean > 0 ? ((mean - threshold) / threshold) * 100 : 0;
  let valueRaw = 50 + avgOverThreshold * 2;
  // Boost value if usage is trending up
  if (teammateCtx.minutes_trend === "up") valueRaw += 5;
  if (teammateCtx.key_teammates_out.length > 0) {
    for (const split of teammateCtx.with_without_splits) {
      if (teammateCtx.key_teammates_out.includes(split.teammate) && split.without_games >= 3) {
        if (split.without_avg > threshold) valueRaw += 5;
        else valueRaw -= 3;
        break;
      }
    }
  }
  // Market movement value adjustment
  if (marketMovement) {
    if (marketMovement.odds_improved === true) valueRaw += 5;
    else if (marketMovement.odds_improved === false) valueRaw -= 4;
  }
  const valueScore = Math.round(Math.min(100, Math.max(0, valueRaw)));

  // ===== RICH REASON TAGS =====
  const reasonTags: string[] = [];

  if (last10HitRate !== null && last10.length >= 8) {
    const hits = Math.round(last10HitRate * last10.length);
    reasonTags.push(`Hit ${threshold}+ in ${hits}/${last10.length} last games`);
  }

  if (last5HitRate !== null && last5HitRate >= 0.8) reasonTags.push("hot_streak");
  if (last5HitRate !== null && last5HitRate <= 0.2) reasonTags.push("cold_streak");
  if (last3Avg && last10Avg && last3Avg > last10Avg * 1.1) reasonTags.push("trending_up");
  if (last3Avg && last10Avg && last3Avg < last10Avg * 0.9) reasonTags.push("trending_down");
  if (consistencyScore >= 70) reasonTags.push("consistent");
  if (volatilityScore >= 70) reasonTags.push("volatile_recent_form");

  if (vsOpponentValues.length >= 3 && vsOpponentHitRate !== null && vsOpponentHitRate >= 0.7) {
    reasonTags.push(`Strong vs ${todayOpponent} (${vsOpponentValues.length}g)`);
  }
  if (vsOpponentValues.length >= 3 && vsOpponentHitRate !== null && vsOpponentHitRate <= 0.3) {
    reasonTags.push(`Weak vs ${todayOpponent} (${vsOpponentValues.length}g)`);
  }
  if (vsOpponentValues.length > 0 && vsOpponentValues.length < 3) {
    reasonTags.push(`Weak sample vs ${todayOpponent} (${vsOpponentValues.length}g)`);
  }

  if (todayHomeAway === "home" && homeHitRate !== null && homeValues.length >= 5 && homeHitRate >= 0.7) {
    reasonTags.push(`Strong home split (${Math.round(homeHitRate * 100)}% in ${homeValues.length}g)`);
  }
  if (todayHomeAway === "away" && awayHitRate !== null && awayValues.length >= 5 && awayHitRate >= 0.7) {
    reasonTags.push(`Strong away split (${Math.round(awayHitRate * 100)}% in ${awayValues.length}g)`);
  }

  if (restCtx.back_to_back) reasonTags.push("back_to_back");
  if (restCtx.rest_days != null && restCtx.rest_days >= 3) {
    reasonTags.push(`${restCtx.rest_days} days rest`);
  }
  if (restHitCtx.sample >= 3 && restHitCtx.rate !== null) {
    const bucket = restCtx.rest_days != null && restCtx.rest_days <= 1 ? "B2B" : restCtx.rest_days != null && restCtx.rest_days >= 3 ? "rested" : "normal rest";
    reasonTags.push(`${Math.round(restHitCtx.rate * 100)}% hit on ${bucket} (${restHitCtx.sample}g)`);
  }

  if (defCtx.avg_allowed !== null && defCtx.games >= 5) {
    if (defCtx.avg_allowed > threshold) {
      reasonTags.push(`OPP allows ${defCtx.avg_allowed} avg (${defCtx.games}g)`);
    } else {
      reasonTags.push(`OPP holds to ${defCtx.avg_allowed} avg (${defCtx.games}g)`);
    }
  }

  // Teammate reason tags
  if (teammateCtx.minutes_trend === "up") reasonTags.push("minutes_trending_up");
  if (teammateCtx.minutes_trend === "down") reasonTags.push("minutes_trending_down");
  if (teammateCtx.role_label === "starter") reasonTags.push("starter");
  if (teammateCtx.role_label === "bench") reasonTags.push("bench_role");

  for (const note of teammateCtx.teammate_notes) {
    reasonTags.push(note);
  }

  if (teammateCtx.key_teammates_out.length > 0) {
    reasonTags.push(`Key out: ${teammateCtx.key_teammates_out.join(", ")}`);
  }

  if (allValues.length >= 15) reasonTags.push("large_sample");
  if (allValues.length < 8) reasonTags.push("small_sample");

  // Availability reason tags
  for (const note of availCtx.availability_notes) {
    reasonTags.push(note);
  }
  if (availCtx.lineup_confidence === "low") {
    reasonTags.push("uncertain_lineup");
  }

  // Market movement reason tags
  if (marketMovement?.movement_note) {
    reasonTags.push(marketMovement.movement_note);
  }

  return {
    player_id: games[0].player_id,
    player_name: games[0].player_name || "",
    team_abbr: games[0].team_abbr,
    opponent_abbr: todayOpponent,
    home_away: todayHomeAway,
    stat_type: statKey,
    threshold,
    last3_avg: last3Avg,
    last5_avg: last5Avg,
    last10_avg: last10Avg,
    last15_avg: last15Avg,
    season_avg: seasonAvg,
    last5_hit_rate: last5HitRate,
    last10_hit_rate: last10HitRate,
    last15_hit_rate: last15HitRate,
    season_hit_rate: seasonHitRate,
    total_games: allValues.length,
    vs_opponent_avg: vsOpponentAvg,
    vs_opponent_hit_rate: vsOpponentHitRate,
    vs_opponent_games: vsOpponentValues.length,
    home_avg: homeAvg,
    away_avg: awayAvg,
    home_hit_rate: homeHitRate,
    away_hit_rate: awayHitRate,
    home_games: homeValues.length,
    away_games: awayValues.length,
    confidence_score: confidenceScore,
    value_score: valueScore,
    volatility_score: volatilityScore,
    consistency_score: consistencyScore,
    reason_tags: reasonTags,
    rest_days: restCtx.rest_days,
    back_to_back: restCtx.back_to_back,
    games_last_7: restCtx.games_last_7,
    games_last_14: restCtx.games_last_14,
    rest_hit_rate: restHitCtx.rate,
    rest_sample: restHitCtx.sample,
    opp_def_rank_note: defCtx.note,
    opp_stat_avg_allowed: defCtx.avg_allowed,
    opp_stat_games: defCtx.games,
    line_hit_rate_l5: last5HitRate,
    line_hit_rate_l10: last10HitRate,
    line_hit_rate_season: seasonHitRate,
    minutes_trend: teammateCtx.minutes_trend,
    minutes_trend_note: teammateCtx.minutes_trend_note,
    role_label: teammateCtx.role_label,
    key_teammates_out: teammateCtx.key_teammates_out,
    teammate_notes: teammateCtx.teammate_notes,
    player_status: availCtx.player_status,
    availability_notes: availCtx.availability_notes,
    lineup_confidence: availCtx.lineup_confidence,
    market_movement: marketMovement,
    scoring_audit: scoringAudit,
  };
}

// ===== MARKET MOVEMENT ANALYSIS =====

interface LineSnapshot {
  player_name: string;
  stat_type: string;
  threshold: number;
  over_odds: string | null;
  under_odds: string | null;
  sportsbook: string;
  snapshot_at: string;
}

function parseAmericanOdds(odds: string | null): number | null {
  if (!odds) return null;
  const n = parseInt(odds, 10);
  if (isNaN(n)) return null;
  return n;
}

function computeMarketMovement(
  playerName: string,
  statType: string,
  threshold: number,
  snapshotIndex: Map<string, LineSnapshot[]>
): MarketMovement | null {
  // Use pre-indexed snapshots for O(1) lookup
  const key = `${playerName}|${statType}|${threshold}`;
  const relevant = snapshotIndex.get(key);

  if (!relevant || relevant.length < 2) return null;

  // Check time spread
  const firstTime = new Date(relevant[0].snapshot_at).getTime();
  const lastTime = new Date(relevant[relevant.length - 1].snapshot_at).getTime();
  const spanMinutes = (lastTime - firstTime) / (1000 * 60);
  if (spanMinutes < 30) return null;

  const opening = relevant[0];
  const current = relevant[relevant.length - 1];

  const openOdds = parseAmericanOdds(opening.over_odds);
  const currOdds = parseAmericanOdds(current.over_odds);

  let odds_improved: boolean | null = null;
  if (openOdds != null && currOdds != null) {
    odds_improved = currOdds > openOdds;
  }

  const openThreshold = Number(opening.threshold);
  const currThreshold = Number(current.threshold);
  let line_moved: "up" | "down" | "unchanged" | null = null;
  if (openThreshold !== currThreshold) {
    line_moved = currThreshold > openThreshold ? "up" : "down";
  } else {
    line_moved = "unchanged";
  }

  let movement_note: string | null = null;
  if (odds_improved === true && openOdds != null && currOdds != null) {
    movement_note = `Value improved: ${opening.over_odds} → ${current.over_odds}`;
  } else if (odds_improved === false && openOdds != null && currOdds != null) {
    movement_note = `Value worsened: ${opening.over_odds} → ${current.over_odds}`;
  }
  if (line_moved === "up") {
    movement_note = (movement_note ? movement_note + "; " : "") + `Line moved up from ${openThreshold}`;
  } else if (line_moved === "down") {
    movement_note = (movement_note ? movement_note + "; " : "") + `Line moved down from ${openThreshold}`;
  }

  return {
    opening_line: openThreshold,
    current_line: currThreshold,
    line_moved,
    opening_odds: opening.over_odds,
    current_odds: current.over_odds,
    odds_improved,
    movement_note,
  };
}

// Pre-index line snapshots for fast lookup
function buildSnapshotIndex(snapshots: LineSnapshot[]): Map<string, LineSnapshot[]> {
  const index = new Map<string, LineSnapshot[]>();
  for (const s of snapshots) {
    const key = `${s.player_name}|${s.stat_type}|${Number(s.threshold)}`;
    if (!index.has(key)) index.set(key, []);
    index.get(key)!.push(s);
  }
  // Sort each group by time
  for (const [, arr] of index) {
    arr.sort((a, b) => a.snapshot_at.localeCompare(b.snapshot_at));
  }
  return index;
}

// Name normalization matching ai-bet-builder's normName
function normNameScoring(n: string): string {
  return n
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\./g, "")                  // strip periods: R.J. → RJ, P.J. → PJ
    .replace(/\b(jr|sr|ii|iii|iv)\b/gi, "")  // strip suffixes: Jr Sr III
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ===== PLAYER NAME ALIAS MAP (mirrors ai-bet-builder) =====
const PLAYER_ALIASES_RAW: [string, string][] = [
  ["Luka Doncic", "Luka Dončić"],
  ["Kristaps Porzingis", "Kristaps Porziņģis"],
  ["Moussa Diabate", "Moussa Diabaté"],
  ["Nikola Jokic", "Nikola Jokić"],
  ["Nikola Vucevic", "Nikola Vučević"],
  ["Jonas Valanciunas", "Jonas Valančiūnas"],
  ["Bogdan Bogdanovic", "Bogdan Bogdanović"],
  ["Bojan Bogdanovic", "Bojan Bogdanović"],
  ["Jusuf Nurkic", "Jusuf Nurkić"],
  ["Alperen Sengun", "Alperen Şengün"],
  ["Vasilije Micic", "Vasilije Micić"],
  ["Nicolas Claxton", "Nic Claxton"],
  ["Robert Williams III", "Robert Williams"],
  ["Robert Williams III", "Rob Williams"],
  ["PJ Washington", "P.J. Washington"],
  ["Marcus Morris Sr.", "Marcus Morris"],
  ["Gary Trent Jr.", "Gary Trent"],
  ["Tim Hardaway Jr.", "Tim Hardaway"],
  ["Larry Nance Jr.", "Larry Nance"],
  ["Kelly Oubre Jr.", "Kelly Oubre"],
  ["Jaren Jackson Jr.", "Jaren Jackson"],
  ["Derrick Jones Jr.", "Derrick Jones Jr"],
  ["Derrick Jones Jr.", "Derrick Jones"],
  ["Jabari Smith Jr.", "Jabari Smith Jr"],
  ["Jabari Smith Jr.", "Jabari Smith"],
  ["Wendell Carter Jr.", "Wendell Carter Jr"],
  ["Wendell Carter Jr.", "Wendell Carter"],
  ["Michael Porter Jr.", "Michael Porter Jr"],
  ["Michael Porter Jr.", "Michael Porter"],
  ["Kenyon Martin Jr.", "Kenyon Martin Jr"],
  ["Kenyon Martin Jr.", "Kenyon Martin"],
  ["Trey Murphy III", "Trey Murphy"],
  ["Herb Jones", "Herbert Jones"],
  // New aliases from unscored player audit
  ["Moe Wagner", "Moritz Wagner"],
  ["R.J. Barrett", "RJ Barrett"],
  ["A.J. Green", "AJ Green"],
  ["Carlton Carrington", "Bub Carrington"],
  ["Ron Holland", "Ron Holland II"],
  ["Jaime Jaquez Jr.", "Jaime Jaquez"],
];

const SCORING_ALIAS_LOOKUP = new Map<string, Set<string>>();
function _initScoringAliases() {
  for (const [a, b] of PLAYER_ALIASES_RAW) {
    const na = normNameScoring(a);
    const nb = normNameScoring(b);
    if (na === nb) continue;
    if (!SCORING_ALIAS_LOOKUP.has(na)) SCORING_ALIAS_LOOKUP.set(na, new Set());
    if (!SCORING_ALIAS_LOOKUP.has(nb)) SCORING_ALIAS_LOOKUP.set(nb, new Set());
    SCORING_ALIAS_LOOKUP.get(na)!.add(nb);
    SCORING_ALIAS_LOOKUP.get(nb)!.add(na);
  }
}
_initScoringAliases();

function getScoringNameVariants(normalizedName: string): string[] {
  const variants = [normalizedName];
  const aliases = SCORING_ALIAS_LOOKUP.get(normalizedName);
  if (aliases) variants.push(...aliases);
  return variants;
}

function normStatScoring(s: string): string {
  const lower = s.toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (lower === "points" || lower === "pts") return "pts";
  if (lower === "rebounds" || lower === "reb" || lower === "totalrebounds") return "reb";
  if (lower === "assists" || lower === "ast") return "ast";
  if (lower === "3-pointers" || lower === "3pointers" || lower === "3pm" || lower === "fg3m" || lower === "threes") return "fg3m";
  if (lower === "steals" || lower === "stl") return "stl";
  if (lower === "blocks" || lower === "blk") return "blk";
  return lower;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const body = await req.json().catch(() => ({}));
    const { game_date, top_n = 200, stat_types, thresholds_override, matchups, market_lines, score_all_market_players } = body;

    // market_lines: optional array of {player_name, stat_type, threshold} from live market
    // When provided, we use market thresholds per player instead of defaults
    // Build market thresholds from provided market_lines or auto-fetch from line_snapshots
    let effectiveMarketLines = market_lines;
    
    const today = game_date || new Date().toISOString().split("T")[0];

    // Auto-fetch all market lines from line_snapshots for full coverage
    if (score_all_market_players && !effectiveMarketLines) {
      const { data: lsRows } = await supabase
        .from("line_snapshots")
        .select("player_name, stat_type, threshold")
        .eq("game_date", today);
      if (lsRows && lsRows.length > 0) {
        // Deduplicate
        const seen = new Set<string>();
        effectiveMarketLines = [];
        for (const r of lsRows) {
          const key = `${r.player_name}|${r.stat_type}|${r.threshold}`;
          if (!seen.has(key)) {
            seen.add(key);
            effectiveMarketLines.push(r);
          }
        }
        console.log(`Auto-loaded ${effectiveMarketLines.length} unique market lines from line_snapshots for full coverage`);
      }
    }

    const marketThresholdsByPlayer = new Map<string, Map<string, Set<number>>>();
    if (effectiveMarketLines && Array.isArray(effectiveMarketLines)) {
      for (const ml of effectiveMarketLines) {
        const pName = normNameScoring(ml.player_name || "");
        const stat = normStatScoring(ml.stat_type || "");
        if (!pName || !stat) continue;
        // Add to primary name and all alias variants
        const variants = getScoringNameVariants(pName);
        for (const variant of variants) {
          if (!marketThresholdsByPlayer.has(variant)) marketThresholdsByPlayer.set(variant, new Map());
          const statMap = marketThresholdsByPlayer.get(variant)!;
          if (!statMap.has(stat)) statMap.set(stat, new Set());
          statMap.get(stat)!.add(Number(ml.threshold));
        }
      }
      console.log(`Loaded ${effectiveMarketLines.length} market lines for ${marketThresholdsByPlayer.size} players (with alias expansion)`);
    }


    // 1. Build team matchups
    const teamMatchups: Record<string, { opponent: string; homeAway: string }> = {};

    if (matchups && Array.isArray(matchups) && matchups.length > 0) {
      for (const m of matchups) {
        if (m.home_team) teamMatchups[m.home_team] = { opponent: m.away_team || "", homeAway: "home" };
        if (m.away_team) teamMatchups[m.away_team] = { opponent: m.home_team || "", homeAway: "away" };
      }
    } else {
      const { data: games } = await supabase.from("games_today").select("*").eq("game_date", today);
      if (games) {
        for (const g of games) {
          if (g.home_team_abbr) teamMatchups[g.home_team_abbr] = { opponent: g.away_team_abbr || "", homeAway: "home" };
          if (g.away_team_abbr) teamMatchups[g.away_team_abbr] = { opponent: g.home_team_abbr || "", homeAway: "away" };
        }
      }
    }

    let teamsPlaying = Object.keys(teamMatchups);
    let scoringAllPlayers = teamsPlaying.length === 0;

    // 2. Get player game logs
    const allLogs: GameLog[] = [];

    if (scoringAllPlayers) {
      // Paginate to get enough game logs — 1000-row default is too few for all players
      let offset = 0;
      const PAGE_SIZE = 1000;
      const MAX_ROWS = 5000;
      while (offset < MAX_ROWS) {
        const { data: logs } = await supabase
          .from("player_recent_games")
          .select("player_id, player_name, team_abbr, game_date, matchup, pts, reb, ast, fg3m, stl, blk, wl")
          .order("game_date", { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1);
        if (!logs || logs.length === 0) break;
        allLogs.push(...(logs as GameLog[]));
        if (logs.length < PAGE_SIZE) break; // last page
        offset += PAGE_SIZE;
      }
    } else {
      for (const team of teamsPlaying) {
        const { data: logs } = await supabase
          .from("player_recent_games")
          .select("player_id, player_name, team_abbr, game_date, matchup, pts, reb, ast, fg3m, stl, blk, wl")
          .eq("team_abbr", team)
          .order("game_date", { ascending: false })
          .limit(1000);
        if (logs) allLogs.push(...(logs as GameLog[]));
      }
    }

    if (allLogs.length === 0) {
      return new Response(
        JSON.stringify({ scored_props: [], message: "No player game logs found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Group logs by player
    const playerLogs: Record<number, GameLog[]> = {};
    for (const log of allLogs) {
      if (!playerLogs[log.player_id]) playerLogs[log.player_id] = [];
      playerLogs[log.player_id].push(log);
    }

    // 4. Build team rosters for teammate analysis (once per team)
    const teamRosters: Record<string, Map<string, Set<number>>> = {};
    const allTeams = teamsPlaying.length > 0 ? teamsPlaying : [...new Set(allLogs.map(l => l.team_abbr).filter(Boolean) as string[])];
    for (const team of allTeams) {
      teamRosters[team] = buildTeamGameRosters(playerLogs, team);
    }

    // 4b. Fetch player availability data + freshness check
    const availabilityMap = new Map<number, PlayerAvailability>();
    let availabilityIsFresh = false;
    {
      const { data: avail } = await supabase
        .from("player_availability")
        .select("player_id, player_name, team_abbr, status, reason, source, confidence, updated_at")
        .eq("game_date", today);
      if (avail && avail.length > 0) {
        for (const a of avail) {
          availabilityMap.set(a.player_id, a as PlayerAvailability);
        }
        // Check freshness: if most recent update is within 6 hours, consider fresh
        const mostRecent = avail.reduce((latest, a) => {
          const t = new Date(a.updated_at).getTime();
          return t > latest ? t : latest;
        }, 0);
        const hoursSinceUpdate = (Date.now() - mostRecent) / (1000 * 60 * 60);
        availabilityIsFresh = hoursSinceUpdate <= 6;
        console.log(`Availability: ${avail.length} records, ${hoursSinceUpdate.toFixed(1)}h old, fresh=${availabilityIsFresh}`);
      } else {
        console.log(`No availability data for ${today} — will derive from logs with reduced confidence`);
      }
    }

    // 4c. Build team game date sets for availability derivation
    const teamGameDates: Record<string, string[]> = {};
    for (const team of allTeams) {
      const dates = new Set<string>();
      for (const logs of Object.values(playerLogs)) {
        for (const g of logs) {
          if (g.team_abbr === team) dates.add(g.game_date);
        }
      }
      teamGameDates[team] = [...dates].sort((a, b) => b.localeCompare(a));
    }

    // 4d. Fetch line snapshots for market movement analysis
    let lineSnapshots: LineSnapshot[] = [];
    {
      const { data: snaps } = await supabase
        .from("line_snapshots")
        .select("player_name, stat_type, threshold, over_odds, under_odds, sportsbook, snapshot_at")
        .eq("game_date", today)
        .order("snapshot_at", { ascending: true });
      if (snaps) lineSnapshots = snaps as LineSnapshot[];
      console.log(`Loaded ${lineSnapshots.length} line snapshots for market movement analysis`);
    }
    const snapshotIndex = buildSnapshotIndex(lineSnapshots);

    const statsToScore = stat_types || ["pts", "reb", "ast", "fg3m", "stl", "blk"];
    const allScored: ScoredProp[] = [];

    // === OPTIMIZATION: Cache defensive context per (opponent, stat) pair ===
    const defCtxCache: Record<string, ReturnType<typeof computeDefensiveContext>> = {};
    function getCachedDefCtx(opponent: string | null, stat: string) {
      if (!opponent) return { avg_allowed: null, games: 0, note: null };
      const key = `${opponent}:${stat}`;
      if (!defCtxCache[key]) {
        defCtxCache[key] = computeDefensiveContext(playerLogs, opponent, stat);
      }
      return defCtxCache[key];
    }

    for (const [pidStr, logs] of Object.entries(playerLogs)) {
      const playerId = Number(pidStr);
      const team = logs[0]?.team_abbr;
      if (!team) continue;

      const matchup = teamMatchups[team];
      const opponent = matchup?.opponent || null;
      const homeAway = matchup?.homeAway || "unknown";

      logs.sort((a, b) => b.game_date.localeCompare(a.game_date));

      // Skip players who are confirmed OUT
      const explicitStatus = availabilityMap.get(playerId);
      if (explicitStatus?.status === "out") continue;

      const restCtx = computeRestContext(logs, today);

      for (const stat of statsToScore) {
        // Use market thresholds if available for this player+stat, otherwise use defaults
        const playerNorm = normNameScoring(logs[0]?.player_name || "");
        const playerMarket = marketThresholdsByPlayer.get(playerNorm);
        const marketThresholdsForStat = playerMarket?.get(stat);
        
        let thresholds: number[];
        if (marketThresholdsForStat && marketThresholdsForStat.size > 0) {
          // When score_all_market_players, only score market thresholds (skip defaults to save CPU)
          // Otherwise merge market + defaults for full coverage
          if (score_all_market_players) {
            thresholds = [...marketThresholdsForStat].sort((a, b) => a - b);
          } else {
            const combined = new Set([...marketThresholdsForStat, ...(DEFAULT_THRESHOLDS[stat] || [])]);
            thresholds = [...combined].sort((a, b) => a - b);
          }
        } else if (score_all_market_players) {
          // In full market mode, skip players/stats without market lines
          continue;
        } else {
          thresholds = thresholds_override?.[stat] || DEFAULT_THRESHOLDS[stat] || [];
        }
        const defCtx = getCachedDefCtx(opponent, stat);

        const tmRosters = teamRosters[team] || new Map();
        // Compute teammate context once per stat (reuse for all thresholds)
        const teammateCtx = computeTeammateContext(playerId, logs, stat, thresholds[0] || 0, team, tmRosters, playerLogs);

        // Identify key teammate IDs once per stat
        const keyTmIds = teammateCtx.with_without_splits.map(s => {
          for (const [pid, pLogs] of Object.entries(playerLogs)) {
            if (pLogs[0]?.player_name === s.teammate) return Number(pid);
          }
          return -1;
        }).filter(id => id > 0);

        const availCtx = computeAvailabilityContext(
          playerId, logs, team, availabilityMap, keyTmIds, playerLogs, today, teamGameDates[team] || [], availabilityIsFresh
        );

        for (const threshold of thresholds) {
          const restHitCtx = computeRestHitRate(logs, stat, threshold, restCtx.rest_days);

          // Compute market movement for this specific prop
          const STAT_LABELS_REV: Record<string, string> = { pts: "Points", reb: "Rebounds", ast: "Assists", fg3m: "3-Pointers", stl: "Steals", blk: "Blocks" };
          const playerName = logs[0]?.player_name || "";
          const mktMovement = computeMarketMovement(playerName, STAT_LABELS_REV[stat] || stat, threshold, snapshotIndex);

          // Reuse teammate context for all thresholds (the threshold only affects scoring, not teammate identification)
          const scored = scoreProp(logs, stat, threshold, opponent, homeAway, restCtx, restHitCtx, defCtx, playerLogs, teammateCtx, availCtx, mktMovement);
          if (scored) allScored.push(scored);
        }
      }
    }

    // 6. Sort by confidence and return top N
    allScored.sort((a, b) => b.confidence_score - a.confidence_score);
    const topProps = allScored.slice(0, top_n);

    // 7. Cache ALL scores (not just top_n) to ensure full enrichment coverage
    // This eliminates data gaps where market players rank outside top_n
    const propsToCache = allScored; // cache everything
    if (propsToCache.length > 0) {
      const rows = propsToCache.map((p) => ({
        game_date: today,
        player_id: p.player_id,
        player_name: p.player_name,
        team_abbr: p.team_abbr,
        opponent_abbr: p.opponent_abbr,
        home_away: p.home_away,
        stat_type: p.stat_type,
        threshold: p.threshold,
        last3_avg: p.last3_avg,
        last5_avg: p.last5_avg,
        last10_avg: p.last10_avg,
        last15_avg: p.last15_avg,
        season_avg: p.season_avg,
        last5_hit_rate: p.last5_hit_rate,
        last10_hit_rate: p.last10_hit_rate,
        last15_hit_rate: p.last15_hit_rate,
        season_hit_rate: p.season_hit_rate,
        total_games: p.total_games,
        vs_opponent_avg: p.vs_opponent_avg,
        vs_opponent_hit_rate: p.vs_opponent_hit_rate,
        vs_opponent_games: p.vs_opponent_games,
        home_avg: p.home_avg,
        away_avg: p.away_avg,
        home_hit_rate: p.home_hit_rate,
        away_hit_rate: p.away_hit_rate,
        home_games: p.home_games,
        away_games: p.away_games,
        confidence_score: p.confidence_score,
        value_score: p.value_score,
        volatility_score: p.volatility_score,
        consistency_score: p.consistency_score,
        reason_tags: p.reason_tags,
        scored_at: new Date().toISOString(),
      }));

      // Batch upsert in chunks of 25 to avoid CPU limits
      const CHUNK_SIZE = 25;
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE);
        const { error } = await supabase
          .from("player_prop_scores")
          .upsert(chunk, { onConflict: "game_date,player_id,stat_type,threshold" });
        if (error) console.error(`Cache upsert error (chunk ${i / CHUNK_SIZE}):`, error);
      }
      console.log(`Cached ${rows.length} scored props (all candidates) in ${Math.ceil(rows.length / CHUNK_SIZE)} batches`);
    }

    return new Response(
      JSON.stringify({
        scored_props: topProps,
        scored_count: topProps.length,
        total_candidates: allScored.length,
        teams_matched: teamsPlaying.length,
        players_analyzed: Object.keys(playerLogs).length,
        scoring_all_players: scoringAllPlayers,
        market_lines_used: marketThresholdsByPlayer.size > 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("prop-scoring-engine error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
