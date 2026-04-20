// ============================================================
// BetStreaks — MLB Daily Data Refresh (skeleton)
//
// Mirrors the architecture of `refresh-wnba-data`. This is the
// MLB-specific stats/profile/schedule ingestion entry point.
//
// Scope (v1 skeleton):
//   1) Teams       → mlb_player_profiles (team metadata, stub)
//   2) Players     → mlb_player_profiles (bats/throws/role)
//   3) Games       → games_today (sport='MLB') + mlb_game_context
//   4) Probable pitchers → mlb_game_context.probable_*_pitcher_id
//
// Steps are split into discrete async functions so each can be
// promoted from STUB → REAL independently. Today, every step is
// a structured stub that returns `{ skipped: true, reason: "stub" }`
// so the pipeline can run end-to-end without errors.
//
// Idempotent by design — every real implementation MUST upsert.
// Short-circuits cleanly when MLB is offseason.
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Mirror src/lib/sports/registry.ts seasonState. Flip when MLB data is wired.
const MLB_SEASON_STATE: "preseason" | "regular" | "postseason" | "offseason" = "regular";

// SportsDataIO MLB endpoints (preferred provider — same vendor as WNBA path).
// const SPORTSDATA_BASE = "https://api.sportsdata.io/v3/mlb/scores/json";
// const SPORTSDATA_STATS_BASE = "https://api.sportsdata.io/v3/mlb/stats/json";

// ─── Helpers ────────────────────────────────────────────────

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

type Supa = ReturnType<typeof createClient>;

// ─── Step 1: Teams ──────────────────────────────────────────
// REAL plan: GET /Teams from SportsDataIO MLB → upsert minimal team
// metadata onto mlb_player_profiles via team_id reference. For MLB v1 we
// don't have a dedicated mlb_teams table, so this primarily warms the
// `mlb_team_id` foreign-key space used by player profiles + game context.
//
// CURRENT: stub.
async function ingestTeams(_supabase: Supa): Promise<StepResult> {
  return {
    step: "mlb_teams",
    rows: 0,
    skipped: true,
    reason: "stub — wire SportsDataIO /mlb/scores/json/Teams",
  };
}

// ─── Step 2: Players ────────────────────────────────────────
// REAL plan: GET /Players from SportsDataIO MLB → upsert into
// mlb_player_profiles (player_id, mlb_team_id, bats, throws, primary_role).
// `is_probable_pitcher` stays false here — set in Step 4.
//
// CURRENT: stub.
async function ingestPlayers(_supabase: Supa): Promise<StepResult> {
  return {
    step: "mlb_player_profiles",
    rows: 0,
    skipped: true,
    reason: "stub — wire SportsDataIO /mlb/scores/json/Players",
  };
}

// ─── Step 3: Games ──────────────────────────────────────────
// REAL plan: GET /GamesByDate/{today} from SportsDataIO MLB.
//   • Upsert today's slate into shared `games_today` (sport='MLB',
//     id=`mlb_${GameID}`) so the existing UI works.
//   • Upsert one row per game into `mlb_game_context` with venue_name,
//     leaving probable pitchers + JSON context for Step 4 / future steps.
//
// CURRENT: stub.
async function ingestGames(_supabase: Supa): Promise<StepResult> {
  return {
    step: "games_today",
    rows: 0,
    skipped: true,
    reason: "stub — wire SportsDataIO /mlb/scores/json/GamesByDate/{date}",
  };
}

// ─── Step 4: Probable Pitchers ──────────────────────────────
// REAL plan: GET /ProbablePitchers (or derive from GamesByDate which
// includes ProbableAwayStartingPitcherID / ProbableHomeStartingPitcherID).
//   • Update mlb_game_context.probable_home_pitcher_id / probable_away_pitcher_id
//   • Set mlb_player_profiles.is_probable_pitcher=true for those player_ids
//
// CURRENT: stub.
async function ingestProbablePitchers(_supabase: Supa): Promise<StepResult> {
  return {
    step: "mlb_probable_pitchers",
    rows: 0,
    skipped: true,
    reason: "stub — derive from GamesByDate or call /ProbablePitchers",
  };
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

  // Offseason short-circuit (mirrors refresh-wnba-data behavior).
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

  console.log(`[refresh-mlb-data] Run start — date=${todayET()} state=${MLB_SEASON_STATE}`);

  const steps: StepResult[] = [];

  // Run sequentially; each step is independent and currently a stub.
  steps.push(await ingestTeams(supabase));
  steps.push(await ingestPlayers(supabase));
  steps.push(await ingestGames(supabase));
  steps.push(await ingestProbablePitchers(supabase));

  const totalRows = steps.reduce((acc, s) => acc + (s.rows || 0), 0);
  const hasError = steps.some((s) => s.error);

  // Update refresh_status (id=5 reserved for MLB stats refresh).
  try {
    await supabase
      .from("refresh_status")
      .upsert({ id: 5, sport: "MLB", last_run: new Date().toISOString() }, { onConflict: "id" });
  } catch (_) { /* non-critical */ }

  return new Response(
    JSON.stringify({
      ok: !hasError,
      sport: "MLB",
      seasonState: MLB_SEASON_STATE,
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
