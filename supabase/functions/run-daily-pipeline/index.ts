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

/**
 * Daily BetStreaks refresh pipeline orchestrator.
 *
 * Runs three steps in sequence:
 *   A) collect-line-snapshots  (lines + games_today)
 *   B) refresh-availability    (player status for the slate)
 *   C) prop-scoring-engine     (full-market scoring)
 *
 * Safe to invoke multiple times per day — each downstream function
 * handles its own deduplication / upsert logic.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const pipelineStart = Date.now();
  const errors: string[] = [];

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const fnBase = SUPABASE_URL.replace(/\/$/, "") + "/functions/v1";
  const svcHeaders = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
  };

  const results: Record<string, StepResult> = {};

  // ── Step A: Collect line snapshots (also upserts games_today) ──
  console.log("Pipeline Step A: collect-line-snapshots...");
  const stepAStart = Date.now();
  let gameDates: string[] = [];

  try {
    const res = await fetch(`${fnBase}/collect-line-snapshots`, {
      method: "POST",
      headers: svcHeaders,
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(90_000),
    });
    const body = await res.json();

    if (!res.ok || body.ok === false) {
      throw new Error(body.error || `HTTP ${res.status}`);
    }

    gameDates = body.game_dates || [];

    results.line_collection = {
      status: "success",
      duration_ms: Date.now() - stepAStart,
      game_dates: gameDates,
      games_processed: body.games_processed,
      new_snapshots: body.new_snapshots,
      skipped_dupes: body.skipped_dupes,
      total_across_dates: body.total_across_dates,
      // Note: collect-line-snapshots already chains availability + scoring internally,
      // but we run them explicitly below for visibility and independent error handling.
    };
    console.log(`Step A done: ${body.new_snapshots} new snapshots, ${body.games_processed} games`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`line_collection: ${msg}`);
    results.line_collection = { status: "failed", duration_ms: Date.now() - stepAStart, error: msg };
    console.error("Step A failed:", msg);

    // Line collection is critical — abort pipeline
    return new Response(JSON.stringify({
      success: false,
      results,
      total_duration_ms: Date.now() - pipelineStart,
      errors,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 });
  }

  // Determine today's ET date for downstream calls
  const todayET = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const activeDates = gameDates.length > 0 ? gameDates : [todayET];

  // ── Step B: Refresh availability ──
  console.log("Pipeline Step B: refresh-availability...");
  const stepBStart = Date.now();

  try {
    const res = await fetch(`${fnBase}/refresh-availability`, {
      method: "POST",
      headers: svcHeaders,
      body: JSON.stringify({ game_date: todayET }),
      signal: AbortSignal.timeout(60_000),
    });
    const body = await res.json();

    results.availability_refresh = {
      status: "success",
      duration_ms: Date.now() - stepBStart,
      records: body.records,
      status_breakdown: body.status_breakdown,
    };
    console.log(`Step B done: ${body.records} players`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`availability_refresh: ${msg}`);
    results.availability_refresh = { status: "failed", duration_ms: Date.now() - stepBStart, error: msg };
    console.error("Step B failed (non-fatal):", msg);
    // Availability is non-critical — continue to scoring
  }

  // ── Step C: Prop scoring engine ──
  console.log("Pipeline Step C: prop-scoring-engine...");
  const stepCStart = Date.now();

  try {
    const res = await fetch(`${fnBase}/prop-scoring-engine`, {
      method: "POST",
      headers: svcHeaders,
      body: JSON.stringify({ score_all_market_players: true }),
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
    console.log(`Step C done: ${body.scored_count} props scored`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`scoring: ${msg}`);
    results.scoring = { status: "failed", duration_ms: Date.now() - stepCStart, error: msg };
    console.error("Step C failed:", msg);
  }

  // ── Final summary ──
  const allSuccess = Object.values(results).every((r) => r.status === "success");
  const summary = {
    success: allSuccess,
    game_dates: activeDates,
    results,
    total_duration_ms: Date.now() - pipelineStart,
    errors,
    ran_at: new Date().toISOString(),
  };

  console.log("Pipeline complete:", JSON.stringify(summary));

  // Update refresh_status id=4 + write pipeline_runs history
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    await supabase.from("refresh_status").upsert(
      { id: 4, sport: "NBA_PIPELINE", last_run: new Date().toISOString() },
      { onConflict: "id" }
    );
    await supabase.from("pipeline_runs").insert({
      ran_at: new Date().toISOString(),
      success: allSuccess,
      total_duration_ms: Date.now() - pipelineStart,
      line_status: results.line_collection?.status || null,
      line_new_snapshots: results.line_collection?.new_snapshots as number || 0,
      line_games_processed: results.line_collection?.games_processed as number || 0,
      availability_status: results.availability_refresh?.status || null,
      availability_records: results.availability_refresh?.records as number || 0,
      scoring_status: results.scoring?.status || null,
      scoring_scored_count: results.scoring?.scored_count as number || 0,
      scoring_source: (results.scoring?.scoring_source as string) || null,
      errors,
      game_dates: activeDates,
    });
  } catch (_) { /* non-critical */ }

  return new Response(JSON.stringify(summary), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status: allSuccess ? 200 : 207,
  });
});
