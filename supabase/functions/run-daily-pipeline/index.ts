import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface StepResult {
  status: "success" | "failed" | "skipped";
  duration_ms: number;
  [key: string]: unknown;
}

type SportKey = "NBA" | "WNBA";

// Mirrors src/lib/sports/registry.ts seasonState — flip when WNBA goes in-season.
// Order matters: NBA runs first so its behavior remains deterministic.
const PIPELINE_SPORTS: { sport: SportKey; seasonState: "preseason" | "regular" | "postseason" | "offseason" }[] = [
  { sport: "NBA", seasonState: "postseason" },
  { sport: "WNBA", seasonState: "offseason" },
];

/**
 * Daily BetStreaks refresh pipeline orchestrator.
 *
 * Phase 2 — multi-sport: loops over PIPELINE_SPORTS and runs the same three steps
 * per sport. Each step accepts {sport} and short-circuits on offseason.
 *
 *   A) collect-line-snapshots  (lines + games_today) per sport
 *   B) refresh-availability    (player status for the slate) per sport
 *   C) prop-scoring-engine     (full-market scoring) per sport
 *
 * NBA path is unchanged when sport==='NBA' (default everywhere downstream).
 * WNBA short-circuits cleanly while seasonState='offseason'.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Allow caller to override sport list (e.g. {"sports":["NBA"]}) for ad-hoc runs.
  const overrideBody = await req.json().catch(() => ({}));
  const overrideSports: SportKey[] | null = Array.isArray(overrideBody?.sports) && overrideBody.sports.length > 0
    ? overrideBody.sports.filter((s: unknown): s is SportKey => s === "NBA" || s === "WNBA")
    : null;

  const pipelineStart = Date.now();
  const allErrors: string[] = [];

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const fnBase = SUPABASE_URL.replace(/\/$/, "") + "/functions/v1";
  const svcHeaders = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
  };

  const perSportResults: Record<string, Record<string, StepResult>> = {};
  const allGameDates = new Set<string>();

  const sportsToRun = overrideSports
    ? PIPELINE_SPORTS.filter(s => overrideSports.includes(s.sport))
    : PIPELINE_SPORTS;

  for (const { sport, seasonState } of sportsToRun) {
    console.log(`\n=== Pipeline starting for ${sport} (seasonState=${seasonState}) ===`);
    const results: Record<string, StepResult> = {};
    perSportResults[sport] = results;

    if (seasonState === "offseason") {
      console.log(`[${sport}] Skipping all steps — offseason.`);
      results.line_collection = { status: "skipped", duration_ms: 0, reason: "offseason" };
      results.availability_refresh = { status: "skipped", duration_ms: 0, reason: "offseason" };
      results.scoring = { status: "skipped", duration_ms: 0, reason: "offseason" };
      if (sport === "WNBA") {
        results.wnba_stats = { status: "skipped", duration_ms: 0, reason: "offseason" };
      }
      continue;
    }

    // ── Step 0 (WNBA only): Refresh stats from SportsDataIO before odds collection ──
    if (sport === "WNBA") {
      console.log(`[${sport}] Step 0: refresh-wnba-data (stats)...`);
      const step0Start = Date.now();
      try {
        const res = await fetch(`${fnBase}/refresh-wnba-data`, {
          method: "POST",
          headers: svcHeaders,
          body: JSON.stringify({}),
          signal: AbortSignal.timeout(120_000),
        });
        const body = await res.json();
        results.wnba_stats = {
          status: body.ok ? "success" : "failed",
          duration_ms: Date.now() - step0Start,
          total_rows: body.total_rows,
          steps: body.steps,
        };
        console.log(`[${sport}] Step 0 done: ${body.total_rows ?? 0} rows`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        allErrors.push(`${sport}.wnba_stats: ${msg}`);
        results.wnba_stats = { status: "failed", duration_ms: Date.now() - step0Start, error: msg };
        console.error(`[${sport}] Step 0 failed (non-fatal):`, msg);
      }
    }

    // ── Step A: Collect line snapshots (also upserts games_today) ──
    console.log(`[${sport}] Step A: collect-line-snapshots...`);
    const stepAStart = Date.now();
    let gameDates: string[] = [];

    try {
      const res = await fetch(`${fnBase}/collect-line-snapshots`, {
        method: "POST",
        headers: svcHeaders,
        body: JSON.stringify({ sport }),
        signal: AbortSignal.timeout(90_000),
      });
      const body = await res.json();

      if (!res.ok || body.ok === false) {
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      gameDates = body.game_dates || [];
      gameDates.forEach(d => allGameDates.add(d));

      results.line_collection = {
        status: "success",
        duration_ms: Date.now() - stepAStart,
        game_dates: gameDates,
        games_processed: body.games_processed,
        new_snapshots: body.new_snapshots,
        skipped_dupes: body.skipped_dupes,
        total_across_dates: body.total_across_dates,
      };
      console.log(`[${sport}] Step A done: ${body.new_snapshots ?? 0} new snapshots, ${body.games_processed ?? 0} games`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      allErrors.push(`${sport}.line_collection: ${msg}`);
      results.line_collection = { status: "failed", duration_ms: Date.now() - stepAStart, error: msg };
      console.error(`[${sport}] Step A failed:`, msg);
      // Line collection is critical for THIS sport — skip downstream for this sport only.
      continue;
    }

    const todayET = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

    // ── Step B: Refresh availability ──
    console.log(`[${sport}] Step B: refresh-availability...`);
    const stepBStart = Date.now();

    try {
      const res = await fetch(`${fnBase}/refresh-availability`, {
        method: "POST",
        headers: svcHeaders,
        body: JSON.stringify({ game_date: todayET, sport }),
        signal: AbortSignal.timeout(60_000),
      });
      const body = await res.json();

      results.availability_refresh = {
        status: "success",
        duration_ms: Date.now() - stepBStart,
        records: body.records,
        status_breakdown: body.status_breakdown,
      };
      console.log(`[${sport}] Step B done: ${body.records ?? 0} players`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      allErrors.push(`${sport}.availability_refresh: ${msg}`);
      results.availability_refresh = { status: "failed", duration_ms: Date.now() - stepBStart, error: msg };
      console.error(`[${sport}] Step B failed (non-fatal):`, msg);
    }

    // ── Step C: Prop scoring engine ──
    console.log(`[${sport}] Step C: prop-scoring-engine...`);
    const stepCStart = Date.now();

    try {
      const res = await fetch(`${fnBase}/prop-scoring-engine`, {
        method: "POST",
        headers: svcHeaders,
        body: JSON.stringify({ score_all_market_players: true, sport }),
        signal: AbortSignal.timeout(90_000),
      });
      const body = await res.json();

      results.scoring = {
        status: "success",
        duration_ms: Date.now() - stepCStart,
        players_analyzed: body.players_analyzed,
        scored_count: body.scored_count,
        scoring_source: body.scoring_source || "market-first",
      };
      console.log(`[${sport}] Step C done: ${body.scored_count ?? 0} props scored`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      allErrors.push(`${sport}.scoring: ${msg}`);
      results.scoring = { status: "failed", duration_ms: Date.now() - stepCStart, error: msg };
      console.error(`[${sport}] Step C failed:`, msg);
    }

    console.log(`=== Pipeline complete for ${sport} ===`);
  }

  // ── Final summary ──
  // "success" = every NON-skipped step succeeded across every sport.
  const allRanSteps = Object.values(perSportResults).flatMap(r => Object.values(r)).filter(r => r.status !== "skipped");
  const allSuccess = allRanSteps.length > 0 && allRanSteps.every(r => r.status === "success");

  const summary = {
    success: allSuccess,
    sports: Object.keys(perSportResults),
    game_dates: [...allGameDates].sort(),
    results: perSportResults,
    total_duration_ms: Date.now() - pipelineStart,
    errors: allErrors,
    ran_at: new Date().toISOString(),
  };

  console.log("Pipeline complete:", JSON.stringify(summary));

  // Update refresh_status id=4 + write pipeline_runs history.
  // The history row aggregates across sports for backward compatibility with
  // /admin dashboards that read this table; per-sport detail lives in `results`.
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    await supabase.from("refresh_status").upsert(
      { id: 4, sport: "PIPELINE", last_run: new Date().toISOString() },
      { onConflict: "id" }
    );

    const aggregate = (key: keyof StepResult) =>
      Object.values(perSportResults).reduce((acc, r) => {
        for (const step of Object.values(r)) {
          const v = step[key as string];
          if (typeof v === "number") acc += v;
        }
        return acc;
      }, 0);

    const firstStatus = (step: string): string | null => {
      // Prefer NBA status for backward compatibility, fall back to first non-null.
      const nba = perSportResults.NBA?.[step]?.status;
      if (nba) return nba;
      for (const r of Object.values(perSportResults)) {
        if (r[step]?.status) return r[step].status;
      }
      return null;
    };

    await supabase.from("pipeline_runs").insert({
      ran_at: new Date().toISOString(),
      success: allSuccess,
      total_duration_ms: Date.now() - pipelineStart,
      line_status: firstStatus("line_collection"),
      line_new_snapshots: aggregate("new_snapshots"),
      line_games_processed: aggregate("games_processed"),
      availability_status: firstStatus("availability_refresh"),
      availability_records: aggregate("records"),
      scoring_status: firstStatus("scoring"),
      scoring_scored_count: aggregate("scored_count"),
      scoring_source:
        (perSportResults.NBA?.scoring?.scoring_source as string | undefined) || null,
      errors: allErrors,
      game_dates: [...allGameDates].sort(),
    });
  } catch (_) { /* non-critical */ }

  return new Response(JSON.stringify(summary), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status: allSuccess ? 200 : 207,
  });
});
