import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Stat column mapping
const STAT_MAP: Record<string, string> = {
  pts: "pts",
  reb: "reb",
  ast: "ast",
  fg3m: "fg3m",
  "3pm": "fg3m",
  stl: "stl",
  blk: "blk",
};

// Common prop lines for each stat type
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
}

function parseMatchup(matchup: string | null): { opponent: string | null; homeAway: string } {
  if (!matchup) return { opponent: null, homeAway: "unknown" };
  // Format: "LAL vs. GSW" (home) or "LAL @ GSW" (away)
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

function scoreProp(
  games: GameLog[],
  statKey: string,
  threshold: number,
  todayOpponent: string | null,
  todayHomeAway: string
): ScoredProp | null {
  if (games.length === 0) return null;

  const col = STAT_MAP[statKey];
  if (!col) return null;

  // Extract stat values in chronological order (most recent first, games already sorted)
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

  if (allValues.length < 3) return null; // Need minimum sample

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

  // -- Scoring Engine --
  const stdDev = calcStdDev(allValues);
  const mean = seasonAvg || 0;

  // Volatility (0-100, lower = more consistent)
  const cv = mean > 0 ? (stdDev / mean) * 100 : 50;
  const volatilityScore = Math.min(100, Math.round(cv * 2));

  // Consistency (inverse of volatility)
  const consistencyScore = Math.max(0, 100 - volatilityScore);

  // Confidence score: weighted combination of hit rates + sample size
  const sampleFactor = Math.min(1, allValues.length / 20); // maxes at 20 games
  const recentWeight = 0.4;
  const seasonWeight = 0.3;
  const trendWeight = 0.3;

  const recentHR = last5HitRate ?? 0;
  const seasonHR = seasonHitRate ?? 0;
  // Trend: is recent form improving?
  const trendHR = last3Avg && last10Avg ? (last3Avg > last10Avg ? 0.7 : 0.4) : 0.5;

  let rawConfidence = (recentHR * recentWeight + seasonHR * seasonWeight + trendHR * trendWeight) * 100;
  rawConfidence *= sampleFactor;

  // Boost for opponent-specific data
  if (vsOpponentValues.length >= 2 && vsOpponentHitRate !== null) {
    rawConfidence = rawConfidence * 0.8 + vsOpponentHitRate * 100 * 0.2;
  }

  // Boost/penalize for home/away split
  if (todayHomeAway === "home" && homeHitRate !== null && homeValues.length >= 3) {
    rawConfidence = rawConfidence * 0.85 + homeHitRate * 100 * 0.15;
  } else if (todayHomeAway === "away" && awayHitRate !== null && awayValues.length >= 3) {
    rawConfidence = rawConfidence * 0.85 + awayHitRate * 100 * 0.15;
  }

  const confidenceScore = Math.round(Math.min(100, Math.max(0, rawConfidence)));

  // Value score: how far above threshold is the average?
  const avgOverThreshold = mean > 0 ? ((mean - threshold) / threshold) * 100 : 0;
  const valueScore = Math.round(Math.min(100, Math.max(0, 50 + avgOverThreshold * 2)));

  // Reason tags
  const reasonTags: string[] = [];
  if (last5HitRate !== null && last5HitRate >= 0.8) reasonTags.push("hot_streak");
  if (last5HitRate !== null && last5HitRate <= 0.2) reasonTags.push("cold_streak");
  if (last3Avg && last10Avg && last3Avg > last10Avg * 1.1) reasonTags.push("trending_up");
  if (last3Avg && last10Avg && last3Avg < last10Avg * 0.9) reasonTags.push("trending_down");
  if (consistencyScore >= 70) reasonTags.push("consistent");
  if (volatilityScore >= 70) reasonTags.push("volatile");
  if (vsOpponentValues.length >= 2 && vsOpponentHitRate !== null && vsOpponentHitRate >= 0.7) {
    reasonTags.push("strong_vs_opponent");
  }
  if (vsOpponentValues.length >= 2 && vsOpponentHitRate !== null && vsOpponentHitRate <= 0.3) {
    reasonTags.push("weak_vs_opponent");
  }
  if (todayHomeAway === "home" && homeHitRate !== null && homeHitRate >= 0.7) reasonTags.push("home_advantage");
  if (todayHomeAway === "away" && awayHitRate !== null && awayHitRate >= 0.7) reasonTags.push("road_warrior");
  if (allValues.length >= 15) reasonTags.push("large_sample");
  if (allValues.length < 8) reasonTags.push("small_sample");

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
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const body = await req.json().catch(() => ({}));
    const { game_date, top_n = 40, stat_types, thresholds_override } = body;

    const today = game_date || new Date().toISOString().split("T")[0];

    // 1. Get today's games
    const { data: games } = await supabase
      .from("games_today")
      .select("*")
      .eq("game_date", today);

    if (!games || games.length === 0) {
      return new Response(
        JSON.stringify({ scored_props: [], message: "No games found for today" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build set of team abbreviations playing today with their opponents
    const teamMatchups: Record<string, { opponent: string; homeAway: string }> = {};
    for (const g of games) {
      if (g.home_team_abbr) {
        teamMatchups[g.home_team_abbr] = { opponent: g.away_team_abbr || "", homeAway: "home" };
      }
      if (g.away_team_abbr) {
        teamMatchups[g.away_team_abbr] = { opponent: g.home_team_abbr || "", homeAway: "away" };
      }
    }

    const teamsPlaying = Object.keys(teamMatchups);
    if (teamsPlaying.length === 0) {
      return new Response(
        JSON.stringify({ scored_props: [], message: "No team matchups found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Get all player game logs for players on teams playing today
    // We need recent games, fetching up to 1000 rows per team batch
    const allLogs: GameLog[] = [];
    // Fetch in batches to avoid the 1000-row limit
    for (const team of teamsPlaying) {
      const { data: logs } = await supabase
        .from("player_recent_games")
        .select("player_id, player_name, team_abbr, game_date, matchup, pts, reb, ast, fg3m, stl, blk, wl")
        .eq("team_abbr", team)
        .order("game_date", { ascending: false })
        .limit(500);

      if (logs) allLogs.push(...(logs as GameLog[]));
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

    // 4. Score each player for each stat/threshold combo
    const statsToScore = stat_types || ["pts", "reb", "ast", "fg3m", "stl", "blk"];
    const allScored: ScoredProp[] = [];

    for (const [pidStr, logs] of Object.entries(playerLogs)) {
      const pid = Number(pidStr);
      const team = logs[0]?.team_abbr;
      if (!team || !teamMatchups[team]) continue;

      const { opponent, homeAway } = teamMatchups[team];

      // Sort by game_date desc (should already be, but ensure)
      logs.sort((a, b) => b.game_date.localeCompare(a.game_date));

      for (const stat of statsToScore) {
        const thresholds = thresholds_override?.[stat] || DEFAULT_THRESHOLDS[stat] || [];
        for (const threshold of thresholds) {
          const scored = scoreProp(logs, stat, threshold, opponent, homeAway);
          if (scored) allScored.push(scored);
        }
      }
    }

    // 5. Sort by confidence score and return top N
    allScored.sort((a, b) => b.confidence_score - a.confidence_score);
    const topProps = allScored.slice(0, top_n);

    // 6. Cache to player_prop_scores table (upsert, fire-and-forget)
    if (topProps.length > 0) {
      const rows = topProps.map((p) => ({
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

      supabase
        .from("player_prop_scores")
        .upsert(rows, { onConflict: "game_date,player_id,stat_type,threshold" })
        .then(({ error }) => {
          if (error) console.error("Cache upsert error:", error);
        });
    }

    return new Response(
      JSON.stringify({
        scored_props: topProps,
        total_candidates: allScored.length,
        games_today: games.length,
        players_analyzed: Object.keys(playerLogs).length,
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
