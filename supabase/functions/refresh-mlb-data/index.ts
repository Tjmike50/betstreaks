// ============================================================
// BetStreaks — MLB Daily Data Refresh (v1 real ingestion)
//
// Source: SportsDataIO MLB endpoints.
// Writes into:
//   • games_today           (sport='MLB', id=`mlb_${GameID}`)
//   • mlb_player_profiles   (player_id, mlb_team_id, bats, throws, primary_role,
//                            is_probable_pitcher)
//   • mlb_game_context      (game_id, venue_name, probable_*_pitcher_id,
//                            game_context_json)
//
// Idempotent — every step upserts. Short-circuits when offseason.
// Mirrors refresh-wnba-data architecture.
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.1";
import { ingestGameLogsWindow } from "../_shared/mlbGameLogIngest.ts";
import {
  rebuildRollingStats,
  rebuildPitcherMatchupSummaries,
  rebuildTeamOffenseDaily,
} from "../_shared/mlbStatRebuild.ts";

// How many days of game logs to backfill on each run. v1: 20 covers L15
// rolling windows + a few extra days of buffer for late-arriving boxscores.
const GAMELOG_LOOKBACK_DAYS = 20;
// Window for matchup/team rebuilds (separate from game-log ingestion window).
const ROLLING_WINDOW_DAYS = 15;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Mirror src/lib/sports/registry.ts seasonState. Flip when MLB offseason.
const MLB_SEASON_STATE: "preseason" | "regular" | "postseason" | "offseason" = "regular";

const SPORTSDATA_BASE = "https://api.sportsdata.io/v3/mlb/scores/json";
// Stats base reserved for future game-log ingestion (PlayerGameStatsByDate, etc.)
// const SPORTSDATA_STATS_BASE = "https://api.sportsdata.io/v3/mlb/stats/json";

// ─── Helpers ────────────────────────────────────────────────

async function sportsDataFetch(path: string): Promise<any> {
  const apiKey = Deno.env.get("SPORTSDATAIO_API_KEY");
  if (!apiKey) throw new Error("SPORTSDATAIO_API_KEY not configured");
  const url = `${path}?key=${apiKey}`;
  console.log(`[sportsdata-mlb] GET ${path}`);
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

interface RefreshRequestBody {
  game_date?: string;
  logs_only?: boolean;
  debug_raw?: boolean;
}

type Supa = ReturnType<typeof createClient>;

// In-memory cache populated by step 1 so subsequent steps can map TeamID → abbr
// without re-fetching /Teams.
const teamIdToAbbr = new Map<number, string>();

// Map SportsDataIO PositionCategory → our `primary_role`.
// "P" / "Pitcher"  → "pitcher", everything else → "batter".
function rolePrimary(positionCategory?: string | null, position?: string | null): "pitcher" | "batter" {
  const pc = (positionCategory ?? "").toUpperCase();
  const p = (position ?? "").toUpperCase();
  if (pc === "P" || pc === "PITCHER" || p === "P" || p === "SP" || p === "RP") return "pitcher";
  return "batter";
}

// Normalize handedness ("L"/"R"/"S"/"B"/null) into a single uppercase letter or null.
function normHand(v?: string | null): string | null {
  if (!v) return null;
  const t = v.trim().toUpperCase();
  if (!t) return null;
  return t.charAt(0); // "L", "R", "S" (switch), "B" (both)
}

// ─── Step 1: Teams ──────────────────────────────────────────
// REAL: GET /Teams from SportsDataIO MLB.
// We don't have a dedicated mlb_teams table in v1 — instead we cache
// TeamID → Abbreviation in memory so steps 3/4 can write usable
// home_team_abbr / away_team_abbr to games_today.
async function ingestTeams(_supabase: Supa): Promise<StepResult> {
  try {
    const teams = (await sportsDataFetch(`${SPORTSDATA_BASE}/Teams`)) as any[];
    if (!Array.isArray(teams)) {
      return { step: "mlb_teams", rows: 0, error: "unexpected response shape" };
    }
    let cached = 0;
    for (const t of teams) {
      const id = Number(t?.TeamID);
      const abbr = (t?.Key ?? t?.Abbreviation ?? "").toString().toUpperCase();
      if (Number.isFinite(id) && abbr) {
        teamIdToAbbr.set(id, abbr);
        cached++;
      }
    }
    console.log(`[refresh-mlb-data] Teams cached=${cached}`);
    return { step: "mlb_teams", rows: cached };
  } catch (e: any) {
    return { step: "mlb_teams", rows: 0, error: String(e?.message ?? e) };
  }
}

// ─── Step 2: Players ────────────────────────────────────────
// REAL: GET /Players from SportsDataIO MLB → upsert mlb_player_profiles.
// is_probable_pitcher is reset to false here; step 4 sets it true for today's
// announced starters. Active filter applied to keep the table compact.
async function ingestPlayers(supabase: Supa): Promise<StepResult> {
  try {
    const players = (await sportsDataFetch(`${SPORTSDATA_BASE}/Players`)) as any[];
    if (!Array.isArray(players)) {
      return { step: "mlb_player_profiles", rows: 0, error: "unexpected response shape" };
    }

    const rows = players
      .filter((p) => Number.isFinite(Number(p?.PlayerID)))
      .filter((p) => {
        // Keep active + minor-league-callable; drop clearly retired entries.
        const status = (p?.Status ?? "").toString().toLowerCase();
        return status !== "retired" && status !== "deceased";
      })
      .map((p) => {
        const first = (p?.FirstName ?? "").toString().trim();
        const last = (p?.LastName ?? "").toString().trim();
        const full = (p?.Name ?? `${first} ${last}`).toString().trim() || null;
        return {
          player_id: Number(p.PlayerID),
          player_name: full,
          mlb_team_id: Number.isFinite(Number(p?.TeamID)) ? Number(p.TeamID) : null,
          bats: normHand(p?.BatHand),
          throws: normHand(p?.ThrowHand),
          primary_role: rolePrimary(p?.PositionCategory, p?.Position),
          is_probable_pitcher: false,
        };
      });

    if (rows.length === 0) {
      return { step: "mlb_player_profiles", rows: 0, skipped: true, reason: "no active players" };
    }

    // Chunk to avoid hitting payload limits.
    const CHUNK = 500;
    let written = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const { error } = await supabase
        .from("mlb_player_profiles")
        .upsert(slice, { onConflict: "player_id" });
      if (error) throw error;
      written += slice.length;
    }
    console.log(`[refresh-mlb-data] Players upserted=${written}`);
    return { step: "mlb_player_profiles", rows: written };
  } catch (e: any) {
    return { step: "mlb_player_profiles", rows: 0, error: String(e?.message ?? e) };
  }
}

// ─── Step 3: Games ──────────────────────────────────────────
// REAL: GET /GamesByDate/{today} → upsert games_today + mlb_game_context.
// Probable pitcher IDs are written here too because GamesByDate already
// includes ProbableHome/AwayStartingPitcherID. Step 4 then flips the
// is_probable_pitcher flag on mlb_player_profiles.
async function ingestGames(supabase: Supa): Promise<{ games: StepResult; context: StepResult; pitcherIds: Set<number> }> {
  const dateStr = todayET();
  // SportsDataIO expects format YYYY-MMM-DD (e.g. 2025-APR-20). Use ISO YYYY-MM-DD;
  // their endpoint also accepts that form.
  const pitcherIds = new Set<number>();
  try {
    const games = (await sportsDataFetch(`${SPORTSDATA_BASE}/GamesByDate/${dateStr}`)) as any[];
    if (!Array.isArray(games)) {
      return {
        games: { step: "games_today", rows: 0, error: "unexpected response shape" },
        context: { step: "mlb_game_context", rows: 0, skipped: true, reason: "games failed" },
        pitcherIds,
      };
    }

    const todayRows: any[] = [];
    const contextRows: any[] = [];

    for (const g of games) {
      const gameId = Number(g?.GameID);
      if (!Number.isFinite(gameId)) continue;

      const homeTeamId = Number(g?.HomeTeamID);
      const awayTeamId = Number(g?.AwayTeamID);
      const homeAbbr = (g?.HomeTeam ?? teamIdToAbbr.get(homeTeamId) ?? "").toString().toUpperCase();
      const awayAbbr = (g?.AwayTeam ?? teamIdToAbbr.get(awayTeamId) ?? "").toString().toUpperCase();
      if (!homeAbbr || !awayAbbr) continue;

      const id = `mlb_${gameId}`;
      const dateTime: string | null = g?.DateTime ?? g?.Day ?? null;
      const status = (g?.Status ?? "Scheduled").toString();

      todayRows.push({
        id,
        sport: "MLB",
        game_date: dateStr,
        game_time: dateTime,
        home_team_abbr: homeAbbr,
        away_team_abbr: awayAbbr,
        home_score: Number.isFinite(Number(g?.HomeTeamRuns)) ? Number(g.HomeTeamRuns) : null,
        away_score: Number.isFinite(Number(g?.AwayTeamRuns)) ? Number(g.AwayTeamRuns) : null,
        status,
      });

      const homePitcher = Number(g?.HomeStartingPitcherID ?? g?.ProbableHomeStartingPitcherID);
      const awayPitcher = Number(g?.AwayStartingPitcherID ?? g?.ProbableAwayStartingPitcherID);
      if (Number.isFinite(homePitcher)) pitcherIds.add(homePitcher);
      if (Number.isFinite(awayPitcher)) pitcherIds.add(awayPitcher);

      contextRows.push({
        game_id: id,
        venue_name: (g?.StadiumName ?? g?.Stadium?.Name ?? null) as string | null,
        probable_home_pitcher_id: Number.isFinite(homePitcher) ? homePitcher : null,
        probable_away_pitcher_id: Number.isFinite(awayPitcher) ? awayPitcher : null,
        game_context_json: {
          source: "sportsdataio",
          game_id_raw: gameId,
          home_team_id: homeTeamId,
          away_team_id: awayTeamId,
          status,
          datetime: dateTime,
        },
      });
    }

    let gamesWritten = 0;
    if (todayRows.length > 0) {
      const { error } = await supabase
        .from("games_today")
        .upsert(todayRows, { onConflict: "id" });
      if (error) throw error;
      gamesWritten = todayRows.length;
    }

    let contextWritten = 0;
    if (contextRows.length > 0) {
      const { error } = await supabase
        .from("mlb_game_context")
        .upsert(contextRows, { onConflict: "game_id" });
      if (error) throw error;
      contextWritten = contextRows.length;
    }

    console.log(
      `[refresh-mlb-data] Games today=${gamesWritten} context=${contextWritten} pitcherIds=${pitcherIds.size}`,
    );

    return {
      games: { step: "games_today", rows: gamesWritten },
      context: { step: "mlb_game_context", rows: contextWritten },
      pitcherIds,
    };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    return {
      games: { step: "games_today", rows: 0, error: msg },
      context: { step: "mlb_game_context", rows: 0, error: msg },
      pitcherIds,
    };
  }
}

// ─── Step 4: Probable Pitchers ──────────────────────────────
// REAL: For every probable pitcher id collected in Step 3, set
// mlb_player_profiles.is_probable_pitcher=true. Other pitchers stay false.
//
// NOTE: We intentionally do not flip every pitcher in the league back to false
// each run — that's already handled in Step 2 (Players resets the flag on every
// player upsert). Step 4 just promotes today's starters.
async function ingestProbablePitchers(supabase: Supa, pitcherIds: Set<number>): Promise<StepResult> {
  if (pitcherIds.size === 0) {
    return {
      step: "mlb_probable_pitchers",
      rows: 0,
      skipped: true,
      reason: "no probable pitcher ids in today's slate",
    };
  }
  try {
    const ids = Array.from(pitcherIds);
    const { error, count } = await supabase
      .from("mlb_player_profiles")
      .update({ is_probable_pitcher: true })
      .in("player_id", ids)
      .select("player_id", { count: "exact", head: true });
    if (error) throw error;
    console.log(`[refresh-mlb-data] Probable pitchers flagged=${count ?? ids.length}`);
    return { step: "mlb_probable_pitchers", rows: count ?? ids.length };
  } catch (e: any) {
    return { step: "mlb_probable_pitchers", rows: 0, error: String(e?.message ?? e) };
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
  let body: RefreshRequestBody = {};
  try {
    body = await req.json();
  } catch (_) {
    // allow empty body
  }
  const requestedDate = body.game_date || todayET();
  const logsOnly = body.logs_only === true;
  const debugRaw = body.debug_raw === true;

  if ((MLB_SEASON_STATE as string) === "offseason") {
    console.log(`[refresh-mlb-data] Skipped — MLB seasonState=${MLB_SEASON_STATE}`);
    return new Response(
      JSON.stringify({
        ok: true,
        sport: "MLB",
        skipped: "offseason",
        seasonState: MLB_SEASON_STATE,
        steps: [],
        duration_ms: Date.now() - start,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  console.log(
    `[refresh-mlb-data] Run start — requestedDate=${requestedDate} logsOnly=${logsOnly} debugRaw=${debugRaw} state=${MLB_SEASON_STATE}`,
  );

  const steps: StepResult[] = [];

  if (!logsOnly) {
    steps.push(await ingestTeams(supabase));
    steps.push(await ingestPlayers(supabase));
    const gamesResult = await ingestGames(supabase);
    steps.push(gamesResult.games);
    steps.push(gamesResult.context);
    steps.push(await ingestProbablePitchers(supabase, gamesResult.pitcherIds));
  }

  // ─── Game-log ingestion (hitter + pitcher) ───────
  const logResult = logsOnly
    ? await ingestGameLogsWindow(supabase, requestedDate, 1, { debugRaw })
    : await ingestGameLogsWindow(supabase, requestedDate, GAMELOG_LOOKBACK_DAYS, { debugRaw });
  steps.push(logResult.hitter);
  steps.push(logResult.pitcher);

  if (!logsOnly) {
    // These read from the logs we just upserted.
    const [rolling, matchup, teamOff] = await Promise.all([
      rebuildRollingStats(supabase, requestedDate, ROLLING_WINDOW_DAYS),
      rebuildPitcherMatchupSummaries(supabase, requestedDate, ROLLING_WINDOW_DAYS),
      rebuildTeamOffenseDaily(supabase, requestedDate, ROLLING_WINDOW_DAYS),
    ]);
    steps.push(rolling);
    steps.push(matchup);
    steps.push(teamOff);
  }

  const totalRows = steps.reduce((acc, s) => acc + (s.rows || 0), 0);
  const hasError = steps.some((s) => s.error);

  if (!logsOnly) {
    // refresh_status id=5 reserved for MLB stats refresh.
    try {
      await supabase
        .from("refresh_status")
        .upsert({ id: 5, sport: "MLB", last_run: new Date().toISOString() }, { onConflict: "id" });
    } catch (_) { /* non-critical */ }
  }

  return new Response(
    JSON.stringify({
      ok: !hasError,
      sport: "MLB",
      seasonState: MLB_SEASON_STATE,
      requested_date: requestedDate,
      logs_only: logsOnly,
      total_rows: totalRows,
      steps,
      duration_ms: Date.now() - start,
    }),
    {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: hasError ? 207 : 200,
    },
  );
});
