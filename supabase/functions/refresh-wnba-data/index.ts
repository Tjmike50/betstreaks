// ============================================================
// BetStreaks — WNBA Daily Stats Refresh
//
// Source: SportsDataIO (teams, players, schedule, box scores).
// Writes into the SAME BetStreaks tables used by NBA, tagged sport='WNBA':
//   - games_today
//   - player_recent_games
//   - team_recent_games
//   - streaks    (recomputed each run, scoped to WNBA)
//   - streak_events
//
// Idempotent: every step upserts. Safe to re-run.
// Short-circuits cleanly when WNBA is offseason.
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SPORTSDATA_BASE = "https://api.sportsdata.io/v3/wnba/scores/json";
const SPORTSDATA_STATS_BASE = "https://api.sportsdata.io/v3/wnba/stats/json";

// Mirror src/lib/sports/registry.ts seasonState. Flip to "preseason" / "regular"
// when the WNBA season opens to enable real ingestion.
const WNBA_SEASON_STATE: "preseason" | "regular" | "postseason" | "offseason" = "offseason";
const WNBA_SEASON = "2025"; // override via SportsDataIO if season changes

// Stat columns that match BetStreaks' `player_recent_games` schema.
// Same six stats as NBA so the streak engine and downstream scoring "just work".
const STAT_COLUMNS = ["pts", "reb", "ast", "fg3m", "stl", "blk"] as const;
type StatKey = typeof STAT_COLUMNS[number];

const STAT_THRESHOLDS: Record<StatKey, number[]> = {
  pts: [10, 12, 15, 18, 20, 22, 25, 28, 30],
  reb: [4, 6, 8, 10, 12],
  ast: [3, 4, 5, 6, 8, 10],
  fg3m: [1, 2, 3, 4, 5],
  blk: [1, 2, 3],
  stl: [1, 2, 3],
};

const MIN_STREAK_LENGTH = 3;

// ─── Helpers ────────────────────────────────────────────────

async function sportsDataFetch(path: string): Promise<any> {
  const apiKey = Deno.env.get("SPORTSDATAIO_API_KEY");
  if (!apiKey) throw new Error("SPORTSDATAIO_API_KEY not configured");
  const url = `${path}?key=${apiKey}`;
  console.log(`[sportsdata] GET ${path}`);
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`SportsDataIO ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

function todayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function isAuthorized(req: Request): boolean {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "").trim();
  const apikeyHeader = req.headers.get("apikey") ?? "";
  const candidates = [token, apikeyHeader].filter(Boolean);
  if (candidates.length === 0) return true;

  const refreshSecret = Deno.env.get("REFRESH_SECRET");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  for (const c of candidates) {
    if (refreshSecret && c === refreshSecret) return true;
    if (serviceKey && c === serviceKey) return true;
    if (anonKey && c === anonKey) return true;
    if (c.startsWith("eyJ")) return true;
  }
  return false;
}

interface StepResult {
  step: string;
  rows: number;
  skipped?: boolean;
  reason?: string;
  error?: string;
}

// ─── Step 1: games_today (today only, ET) ───────────────────

async function refreshGamesToday(supabase: ReturnType<typeof createClient>): Promise<StepResult> {
  try {
    const today = todayET();
    const sdGames = await sportsDataFetch(`${SPORTSDATA_BASE}/Games/${WNBA_SEASON}`);
    if (!Array.isArray(sdGames) || sdGames.length === 0) {
      return { step: "games_today", rows: 0, skipped: true, reason: "no schedule data" };
    }

    const todays = sdGames
      .filter((g: any) => {
        const day = (g.Day || "").split("T")[0];
        return day === today;
      })
      .map((g: any) => {
        const commence = g.DateTime || g.Day;
        const gameTime = commence
          ? new Date(commence).toLocaleTimeString("en-US", {
              hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "America/New_York",
            })
          : null;
        return {
          // Stable id derived from SportsDataIO GameID (string for games_today.id).
          id: `wnba_${g.GameID}`,
          sport: "WNBA",
          game_date: today,
          home_team_abbr: g.HomeTeam || null,
          away_team_abbr: g.AwayTeam || null,
          game_time: gameTime,
          home_score: g.HomeTeamScore ?? null,
          away_score: g.AwayTeamScore ?? null,
          status: g.Status || "Scheduled",
          updated_at: new Date().toISOString(),
        };
      });

    if (todays.length === 0) {
      return { step: "games_today", rows: 0, skipped: true, reason: "no games today" };
    }

    const { error } = await supabase
      .from("games_today")
      .upsert(todays, { onConflict: "id" });
    if (error) throw error;

    return { step: "games_today", rows: todays.length };
  } catch (e: any) {
    return { step: "games_today", rows: 0, error: e.message };
  }
}

// ─── Step 2: player_recent_games + team_recent_games ────────
// Pull recent box scores (last ~14 days) so streaks can be computed.

async function refreshRecentGames(supabase: ReturnType<typeof createClient>): Promise<{
  player: StepResult;
  team: StepResult;
}> {
  try {
    // Get the league's recent finalized games to know which dates to fetch.
    const sdGames = await sportsDataFetch(`${SPORTSDATA_BASE}/Games/${WNBA_SEASON}`);
    if (!Array.isArray(sdGames)) {
      return {
        player: { step: "player_recent_games", rows: 0, error: "schedule fetch failed" },
        team: { step: "team_recent_games", rows: 0, error: "schedule fetch failed" },
      };
    }

    const today = new Date(todayET() + "T00:00:00Z");
    const lookbackDays = 21;
    const finalDates = new Set<string>();
    for (const g of sdGames) {
      const day = (g.Day || "").split("T")[0];
      if (!day) continue;
      const status = (g.Status || "").toLowerCase();
      if (!status.includes("final") && status !== "f/ot") continue;
      const d = new Date(day + "T00:00:00Z");
      const ageDays = (today.getTime() - d.getTime()) / 86400000;
      if (ageDays >= 0 && ageDays <= lookbackDays) finalDates.add(day);
    }

    if (finalDates.size === 0) {
      return {
        player: { step: "player_recent_games", rows: 0, skipped: true, reason: "no recent finals" },
        team: { step: "team_recent_games", rows: 0, skipped: true, reason: "no recent finals" },
      };
    }

    const playerRows: any[] = [];
    const teamRowsByKey = new Map<string, any>(); // dedupe by team_id+game_id
    const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

    for (const day of [...finalDates].sort().reverse()) {
      const d = new Date(day + "T00:00:00Z");
      const formatted = `${d.getUTCFullYear()}-${months[d.getUTCMonth()]}-${String(d.getUTCDate()).padStart(2, "0")}`;

      let boxes: any[] = [];
      try {
        boxes = await sportsDataFetch(`${SPORTSDATA_STATS_BASE}/BoxScores/${formatted}`);
      } catch (e) {
        console.log(`[wnba] BoxScores fetch failed for ${day}: ${e}`);
        continue;
      }
      if (!Array.isArray(boxes)) continue;

      for (const box of boxes) {
        const game = box.Game || {};
        const gameId = `wnba_${game.GameID}`;
        const homeAbbr = game.HomeTeam || null;
        const awayAbbr = game.AwayTeam || null;
        const homeScore = game.HomeTeamScore ?? null;
        const awayScore = game.AwayTeamScore ?? null;

        const playerStats = [
          ...(box.HomeTeamPlayerStats || []),
          ...(box.AwayTeamPlayerStats || []),
        ];

        for (const ps of playerStats) {
          if (!ps.Minutes || ps.Minutes === 0) continue;
          const teamAbbr = ps.Team || null;
          const oppAbbr = teamAbbr === homeAbbr ? awayAbbr : homeAbbr;
          const isHome = ps.HomeOrAway === "HOME";
          const matchup = isHome
            ? `${teamAbbr} vs ${oppAbbr ?? ""}`
            : `${teamAbbr} @ ${oppAbbr ?? ""}`;

          // Determine win/loss from game scores
          let wl: string | null = null;
          if (homeScore != null && awayScore != null) {
            const teamScore = isHome ? homeScore : awayScore;
            const oppScore = isHome ? awayScore : homeScore;
            wl = teamScore > oppScore ? "W" : "L";
          }

          playerRows.push({
            player_id: ps.PlayerID,
            player_name: `${ps.FirstName ?? ""} ${ps.LastName ?? ""}`.trim() || `Player ${ps.PlayerID}`,
            team_abbr: teamAbbr,
            game_id: gameId,
            game_date: day,
            matchup,
            wl,
            pts: ps.Points ?? 0,
            reb: ps.Rebounds ?? 0,
            ast: ps.Assists ?? 0,
            fg3m: ps.ThreePointersMade ?? 0,
            stl: ps.Steals ?? 0,
            blk: ps.BlockedShots ?? 0,
            sport: "WNBA",
            updated_at: new Date().toISOString(),
          });
        }

        // Team-level rows (one per team per game)
        if (homeAbbr && game.HomeTeamID) {
          const k = `${game.HomeTeamID}|${gameId}`;
          if (!teamRowsByKey.has(k)) {
            teamRowsByKey.set(k, {
              team_id: game.HomeTeamID,
              team_abbr: homeAbbr,
              game_id: gameId,
              game_date: day,
              matchup: `${homeAbbr} vs ${awayAbbr ?? ""}`,
              pts: homeScore,
              wl: homeScore != null && awayScore != null ? (homeScore > awayScore ? "W" : "L") : null,
              sport: "WNBA",
              updated_at: new Date().toISOString(),
            });
          }
        }
        if (awayAbbr && game.AwayTeamID) {
          const k = `${game.AwayTeamID}|${gameId}`;
          if (!teamRowsByKey.has(k)) {
            teamRowsByKey.set(k, {
              team_id: game.AwayTeamID,
              team_abbr: awayAbbr,
              game_id: gameId,
              game_date: day,
              matchup: `${awayAbbr} @ ${homeAbbr ?? ""}`,
              pts: awayScore,
              wl: homeScore != null && awayScore != null ? (awayScore > homeScore ? "W" : "L") : null,
              sport: "WNBA",
              updated_at: new Date().toISOString(),
            });
          }
        }
      }
    }

    let playerInserted = 0;
    let teamInserted = 0;

    if (playerRows.length > 0) {
      const CHUNK = 500;
      for (let i = 0; i < playerRows.length; i += CHUNK) {
        const chunk = playerRows.slice(i, i + CHUNK);
        const { error } = await supabase
          .from("player_recent_games")
          .upsert(chunk, { onConflict: "player_id,game_id" });
        if (error) throw error;
        playerInserted += chunk.length;
      }
    }

    const teamRows = [...teamRowsByKey.values()];
    if (teamRows.length > 0) {
      const CHUNK = 500;
      for (let i = 0; i < teamRows.length; i += CHUNK) {
        const chunk = teamRows.slice(i, i + CHUNK);
        const { error } = await supabase
          .from("team_recent_games")
          .upsert(chunk, { onConflict: "team_id,game_id" });
        if (error) throw error;
        teamInserted += chunk.length;
      }
    }

    return {
      player: { step: "player_recent_games", rows: playerInserted },
      team: { step: "team_recent_games", rows: teamInserted },
    };
  } catch (e: any) {
    return {
      player: { step: "player_recent_games", rows: 0, error: e.message },
      team: { step: "team_recent_games", rows: 0, error: e.message },
    };
  }
}

// ─── Step 3: Recompute streaks (WNBA scope) ─────────────────

interface StreakRow {
  sport: "WNBA";
  entity_type: "player";
  player_id: number;
  player_name: string;
  team_abbr: string | null;
  stat: StatKey;
  threshold: number;
  streak_len: number;
  streak_start: string;
  last_game: string;
  season_wins: number;
  season_games: number;
  season_win_pct: number;
  streak_win_pct: number;
  last5_games: number;
  last5_hits: number;
  last5_hit_pct: number;
  last10_games: number;
  last10_hits: number;
  last10_hit_pct: number;
}

async function recomputeStreaks(supabase: ReturnType<typeof createClient>): Promise<StepResult> {
  try {
    // Pull all WNBA player game logs (paginated)
    const allLogs: any[] = [];
    let offset = 0;
    const PAGE = 1000;
    while (true) {
      const { data: page } = await supabase
        .from("player_recent_games")
        .select("player_id, player_name, team_abbr, game_date, pts, reb, ast, fg3m, stl, blk, wl")
        .eq("sport", "WNBA")
        .order("game_date", { ascending: false })
        .range(offset, offset + PAGE - 1);
      if (!page || page.length === 0) break;
      allLogs.push(...page);
      if (page.length < PAGE) break;
      offset += PAGE;
    }

    if (allLogs.length === 0) {
      return { step: "streaks", rows: 0, skipped: true, reason: "no WNBA game logs" };
    }

    // Group by player
    const byPlayer = new Map<number, any[]>();
    for (const g of allLogs) {
      const arr = byPlayer.get(g.player_id) || [];
      arr.push(g);
      byPlayer.set(g.player_id, arr);
    }

    const streaks: StreakRow[] = [];
    for (const [pid, games] of byPlayer.entries()) {
      games.sort((a: any, b: any) => b.game_date.localeCompare(a.game_date));
      const playerName = games[0].player_name || `Player ${pid}`;
      const teamAbbr = games[0].team_abbr;

      for (const stat of STAT_COLUMNS) {
        for (const threshold of STAT_THRESHOLDS[stat]) {
          // Count current streak from most recent game backwards
          let streakLen = 0;
          for (const g of games) {
            const v = g[stat];
            if (v == null || v < threshold) break;
            streakLen++;
          }
          if (streakLen < MIN_STREAK_LENGTH) continue;

          const seasonGames = games.length;
          const seasonWins = games.filter((g: any) => (g[stat] ?? 0) >= threshold).length;
          const last5 = games.slice(0, 5);
          const last10 = games.slice(0, 10);
          const last5Hits = last5.filter((g: any) => (g[stat] ?? 0) >= threshold).length;
          const last10Hits = last10.filter((g: any) => (g[stat] ?? 0) >= threshold).length;

          streaks.push({
            sport: "WNBA",
            entity_type: "player",
            player_id: pid,
            player_name: playerName,
            team_abbr: teamAbbr,
            stat,
            threshold,
            streak_len: streakLen,
            streak_start: games[streakLen - 1].game_date,
            last_game: games[0].game_date,
            season_wins: seasonWins,
            season_games: seasonGames,
            season_win_pct: seasonGames ? Number((seasonWins / seasonGames).toFixed(3)) : 0,
            streak_win_pct: 1,
            last5_games: last5.length,
            last5_hits: last5Hits,
            last5_hit_pct: last5.length ? Number((last5Hits / last5.length).toFixed(3)) : 0,
            last10_games: last10.length,
            last10_hits: last10Hits,
            last10_hit_pct: last10.length ? Number((last10Hits / last10.length).toFixed(3)) : 0,
          });
        }
      }
    }

    // Replace WNBA streaks (scoped delete then insert — same pattern as NBA Python)
    await supabase.from("streaks").delete().eq("sport", "WNBA");
    if (streaks.length > 0) {
      const CHUNK = 500;
      for (let i = 0; i < streaks.length; i += CHUNK) {
        const chunk = streaks.slice(i, i + CHUNK);
        const { error } = await supabase.from("streaks").insert(chunk);
        if (error) throw error;
      }
    }

    return { step: "streaks", rows: streaks.length };
  } catch (e: any) {
    return { step: "streaks", rows: 0, error: e.message };
  }
}

// ─── HTTP entry ─────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (!isAuthorized(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const start = Date.now();

  // Offseason short-circuit
  if (WNBA_SEASON_STATE === "offseason") {
    console.log(`[refresh-wnba-data] Skipped — WNBA seasonState=${WNBA_SEASON_STATE}`);
    return new Response(
      JSON.stringify({
        ok: true,
        sport: "WNBA",
        skipped: "offseason",
        seasonState: WNBA_SEASON_STATE,
        steps: [],
        duration_ms: Date.now() - start,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (!Deno.env.get("SPORTSDATAIO_API_KEY")) {
    return new Response(
      JSON.stringify({ ok: false, error: "SPORTSDATAIO_API_KEY not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const steps: StepResult[] = [];

  console.log("[refresh-wnba-data] Step 1: games_today");
  steps.push(await refreshGamesToday(supabase));

  console.log("[refresh-wnba-data] Step 2: recent games (player + team)");
  const recent = await refreshRecentGames(supabase);
  steps.push(recent.player);
  steps.push(recent.team);

  console.log("[refresh-wnba-data] Step 3: streaks");
  steps.push(await recomputeStreaks(supabase));

  // Update refresh_status (id=11 reserved for WNBA stats refresh)
  await supabase.from("refresh_status").upsert(
    { id: 11, sport: "WNBA_STATS", last_run: new Date().toISOString() },
    { onConflict: "id" }
  );

  const totalRows = steps.reduce((acc, s) => acc + s.rows, 0);
  const errors = steps.filter(s => s.error).map(s => `${s.step}: ${s.error}`);
  const ok = errors.length === 0;

  const summary = {
    ok,
    sport: "WNBA",
    seasonState: WNBA_SEASON_STATE,
    duration_ms: Date.now() - start,
    total_rows: totalRows,
    steps,
    errors,
    ran_at: new Date().toISOString(),
  };

  console.log("[refresh-wnba-data] complete:", JSON.stringify(summary));

  return new Response(JSON.stringify(summary), {
    status: ok ? 200 : 207,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
