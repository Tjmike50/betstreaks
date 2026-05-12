import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.1";
import { requireAdmin } from "../_shared/adminAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type Outcome = "hit" | "miss" | "push" | "pending" | "void";
type PickSide = "over" | "under";

interface ScoreRow {
  id: string;
  sport: string;
  game_date: string;
  player_id: number;
  player_name: string;
  team_abbr: string | null;
  opponent_abbr: string | null;
  home_away: string | null;
  stat_type: string;
  threshold: number;
  confidence_score: number | null;
  value_score: number | null;
  consistency_score: number | null;
  volatility_score: number | null;
  last10_hit_rate: number | null;
  season_hit_rate: number | null;
  reason_tags: unknown;
}

interface HitterLog {
  player_id: number;
  game_date: string;
  game_id: string;
  hits: number | null;
  total_bases: number | null;
  home_runs: number | null;
}

interface PitcherLog {
  player_id: number;
  game_date: string;
  game_id: string;
  strikeouts: number | null;
  earned_runs_allowed: number | null;
  walks_allowed: number | null;
  hits_allowed: number | null;
}

function todayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function inferPickSide(_row: ScoreRow): PickSide {
  return "over";
}

function actualForScore(
  row: ScoreRow,
  hitterLog: HitterLog | null,
  pitcherLog: PitcherLog | null,
): number | null {
  switch (row.stat_type) {
    case "HITS":
      return hitterLog?.hits ?? null;
    case "TOTAL_BASES":
      return hitterLog?.total_bases ?? null;
    case "HOME_RUNS":
      return hitterLog?.home_runs ?? null;
    case "STRIKEOUTS":
      return pitcherLog?.strikeouts ?? null;
    case "EARNED_RUNS_ALLOWED":
      return pitcherLog?.earned_runs_allowed ?? null;
    case "WALKS_ALLOWED":
      return pitcherLog?.walks_allowed ?? null;
    case "HITS_ALLOWED":
      return pitcherLog?.hits_allowed ?? null;
    default:
      return null;
  }
}

function gradeOutcome(actual: number, threshold: number, side: PickSide): Outcome {
  if (side === "under") {
    if (actual < threshold) return "hit";
    if (actual === threshold) return "push";
    return "miss";
  }
  if (actual > threshold) return "hit";
  if (actual === threshold) return "push";
  return "miss";
}

function isOfficialActualValue(actual: number | null): actual is number {
  return actual != null && Number.isFinite(actual) && Number.isInteger(actual);
}

async function logHealth(
  supabase: ReturnType<typeof createClient>,
  payload: {
    status: "success" | "failed";
    started_at: string;
    finished_at: string;
    duration_ms: number;
    rows_inserted: number;
    rows_updated: number;
    metadata: Record<string, unknown>;
    error_message?: string | null;
  },
) {
  try {
    await supabase.from("mlb_refresh_health").insert({
      job_name: "grade-mlb-props",
      status: payload.status,
      started_at: payload.started_at,
      finished_at: payload.finished_at,
      duration_ms: payload.duration_ms,
      rows_inserted: payload.rows_inserted,
      rows_updated: payload.rows_updated,
      metadata: payload.metadata,
      error_message: payload.error_message ?? null,
    });
  } catch (e) {
    console.error("[grade-mlb-props] failed to write health row", e);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const __auth = await requireAdmin(req);
  if (!__auth.ok) {
    return new Response(JSON.stringify({ error: __auth.error }), {
      status: __auth.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const startedAt = new Date();
  const startedAtIso = startedAt.toISOString();

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let body: { game_date?: string; dry_run?: boolean; limit?: number } = {};
    try {
      body = await req.json();
    } catch (_) {
      // allow empty body
    }

    const gameDate = body.game_date || todayET();
    const dryRun = body.dry_run ?? true;
    const limit = Math.max(1, Math.min(Number(body.limit ?? 1000), 5000));

    const { data: scoreRowsRaw, error: scoreErr } = await supabase
      .from("player_prop_scores")
      .select(
        "id,sport,game_date,player_id,player_name,team_abbr,opponent_abbr,home_away,stat_type,threshold,confidence_score,value_score,consistency_score,volatility_score,last10_hit_rate,season_hit_rate,reason_tags",
      )
      .eq("sport", "MLB")
      .eq("game_date", gameDate)
      .not("player_id", "is", null)
      .limit(limit);
    if (scoreErr) throw new Error(`Failed to fetch MLB player_prop_scores: ${scoreErr.message}`);

    const scoreRows = (scoreRowsRaw ?? []) as ScoreRow[];
    if (scoreRows.length === 0) {
      const finishedAt = new Date();
      const metadata = {
        dry_run: dryRun,
        game_date: gameDate,
        official_log_source: "mlb_statsapi",
        official_logs_only: true,
        graded_count: 0,
        hit_count: 0,
        miss_count: 0,
        push_count: 0,
        pending_count: 0,
        missing_result_count: 0,
        pending_due_to_missing_official_log_count: 0,
        invalid_actual_count: 0,
        error_count: 0,
      };
      await logHealth(supabase, {
        status: "success",
        started_at: startedAtIso,
        finished_at: finishedAt.toISOString(),
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
        rows_inserted: 0,
        rows_updated: 0,
        metadata,
      });
      return new Response(JSON.stringify({
        ok: true,
        game_date: gameDate,
        dry_run: dryRun,
        props_checked: 0,
        graded_count: 0,
        hit_count: 0,
        miss_count: 0,
        push_count: 0,
        pending_count: 0,
        missing_result_count: 0,
        pending_due_to_missing_official_log_count: 0,
        invalid_actual_count: 0,
        error_count: 0,
        sample_results: [],
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: existingOutcomes, error: existingErr } = await supabase
      .from("mlb_prop_outcomes")
      .select("player_prop_score_id,outcome")
      .in("player_prop_score_id", scoreRows.map((row) => row.id));
    if (existingErr) throw new Error(`Failed to fetch existing MLB outcomes: ${existingErr.message}`);
    const existingOutcomeByScoreId = new Map<string, Outcome>();
    for (const row of existingOutcomes ?? []) {
      existingOutcomeByScoreId.set(row.player_prop_score_id, row.outcome as Outcome);
    }

    const targetRows = scoreRows.filter((row) => {
      const existing = existingOutcomeByScoreId.get(row.id);
      return existing == null || existing === "pending";
    });

    if (targetRows.length === 0) {
      const finishedAt = new Date();
      const metadata = {
        dry_run: dryRun,
        game_date: gameDate,
        official_log_source: "mlb_statsapi",
        official_logs_only: true,
        graded_count: 0,
        hit_count: 0,
        miss_count: 0,
        push_count: 0,
        pending_count: 0,
        missing_result_count: 0,
        pending_due_to_missing_official_log_count: 0,
        invalid_actual_count: 0,
        error_count: 0,
        note: "no pending or ungraded MLB prop rows matched the request",
      };
      await logHealth(supabase, {
        status: "success",
        started_at: startedAtIso,
        finished_at: finishedAt.toISOString(),
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
        rows_inserted: 0,
        rows_updated: 0,
        metadata,
      });
      return new Response(JSON.stringify({
        ok: true,
        game_date: gameDate,
        dry_run: dryRun,
        props_checked: 0,
        graded_count: 0,
        hit_count: 0,
        miss_count: 0,
        push_count: 0,
        pending_count: 0,
        missing_result_count: 0,
        pending_due_to_missing_official_log_count: 0,
        invalid_actual_count: 0,
        error_count: 0,
        sample_results: [],
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const playerIds = [...new Set(targetRows.map((row) => row.player_id))];
    const { data: hitterLogsRaw, error: hitterErr } = await supabase
      .from("mlb_hitter_game_logs")
      .select("player_id,game_date,game_id,hits,total_bases,home_runs")
      .eq("game_date", gameDate)
      .like("game_id", "mlb_statsapi_%")
      .in("player_id", playerIds);
    if (hitterErr) throw new Error(`Failed to fetch mlb_hitter_game_logs: ${hitterErr.message}`);

    const { data: pitcherLogsRaw, error: pitcherErr } = await supabase
      .from("mlb_pitcher_game_logs")
      .select("player_id,game_date,game_id,strikeouts,earned_runs_allowed,walks_allowed,hits_allowed")
      .eq("game_date", gameDate)
      .like("game_id", "mlb_statsapi_%")
      .in("player_id", playerIds);
    if (pitcherErr) throw new Error(`Failed to fetch mlb_pitcher_game_logs: ${pitcherErr.message}`);

    const hitterLogsByPlayer = new Map<number, HitterLog[]>();
    for (const row of (hitterLogsRaw ?? []) as HitterLog[]) {
      const arr = hitterLogsByPlayer.get(row.player_id) ?? [];
      arr.push(row);
      hitterLogsByPlayer.set(row.player_id, arr);
    }

    const pitcherLogsByPlayer = new Map<number, PitcherLog[]>();
    for (const row of (pitcherLogsRaw ?? []) as PitcherLog[]) {
      const arr = pitcherLogsByPlayer.get(row.player_id) ?? [];
      arr.push(row);
      pitcherLogsByPlayer.set(row.player_id, arr);
    }

    const upserts: Record<string, unknown>[] = [];
    const sampleResults: Record<string, unknown>[] = [];

    let gradedCount = 0;
    let hitCount = 0;
    let missCount = 0;
    let pushCount = 0;
    let pendingCount = 0;
    let missingResultCount = 0;
    let pendingDueToMissingOfficialLogCount = 0;
    let invalidActualCount = 0;
    let errorCount = 0;

    for (const row of targetRows) {
      try {
        const hitterLogs = hitterLogsByPlayer.get(row.player_id) ?? [];
        const pitcherLogs = pitcherLogsByPlayer.get(row.player_id) ?? [];
        const hitterLog = hitterLogs.length === 1 ? hitterLogs[0] : null;
        const pitcherLog = pitcherLogs.length === 1 ? pitcherLogs[0] : null;
        const duplicateLogs =
          hitterLogs.length > 1 || pitcherLogs.length > 1;

        const pickSide = inferPickSide(row);
        let outcome: Outcome = "pending";
        let actualValue: number | null = null;
        const metadata: Record<string, unknown> = {
          source_table: row.stat_type === "HITS" || row.stat_type === "TOTAL_BASES" || row.stat_type === "HOME_RUNS"
            ? "mlb_hitter_game_logs"
            : "mlb_pitcher_game_logs",
          duplicate_game_logs: duplicateLogs,
          official_log_source: "mlb_statsapi",
          official_logs_only: true,
        };

        if (duplicateLogs) {
          pendingCount++;
          missingResultCount++;
          pendingDueToMissingOfficialLogCount++;
          metadata.note = "multiple official mlb_statsapi game logs found for player/date; leaving pending to avoid grading wrong game";
        } else {
          actualValue = actualForScore(row, hitterLog, pitcherLog);
          if (actualValue == null) {
            pendingCount++;
            missingResultCount++;
            pendingDueToMissingOfficialLogCount++;
            metadata.note = "no official mlb_statsapi game log available";
          } else if (!isOfficialActualValue(actualValue)) {
            actualValue = null;
            pendingCount++;
            invalidActualCount++;
            metadata.note = "official mlb_statsapi actual was fractional/invalid; leaving pending";
          } else {
            outcome = gradeOutcome(actualValue, Number(row.threshold), pickSide);
            gradedCount++;
            if (outcome === "hit") hitCount++;
            else if (outcome === "miss") missCount++;
            else if (outcome === "push") pushCount++;
          }
        }

        upserts.push({
          player_prop_score_id: row.id,
          sport: "MLB",
          game_date: row.game_date,
          player_id: row.player_id,
          player_name: row.player_name,
          team_abbr: row.team_abbr,
          opponent_abbr: row.opponent_abbr,
          stat_type: row.stat_type,
          threshold: row.threshold,
          pick_side: pickSide,
          actual_value: actualValue,
          outcome,
          graded_at: new Date().toISOString(),
          source: "grade-mlb-props",
          metadata,
        });

        if (sampleResults.length < 10) {
          sampleResults.push({
            player_prop_score_id: row.id,
            player_name: row.player_name,
            stat_type: row.stat_type,
            threshold: row.threshold,
            pick_side: pickSide,
            actual_value: actualValue,
            outcome,
          });
        }
      } catch (e) {
        errorCount++;
        console.error("[grade-mlb-props] row grading failed", row.id, e);
      }
    }

    if (!dryRun && upserts.length > 0) {
      const CHUNK = 250;
      for (let i = 0; i < upserts.length; i += CHUNK) {
        const chunk = upserts.slice(i, i + CHUNK);
        const { error } = await supabase
          .from("mlb_prop_outcomes")
          .upsert(chunk, { onConflict: "player_prop_score_id" });
        if (error) {
          errorCount++;
          console.error(`[grade-mlb-props] upsert failed chunk ${i / CHUNK}`, error);
        }
      }
    }

    const finishedAt = new Date();
    const metadata = {
      dry_run: dryRun,
      game_date: gameDate,
      official_log_source: "mlb_statsapi",
      official_logs_only: true,
      graded_count: gradedCount,
      hit_count: hitCount,
      miss_count: missCount,
      push_count: pushCount,
      pending_count: pendingCount,
      missing_result_count: missingResultCount,
      pending_due_to_missing_official_log_count: pendingDueToMissingOfficialLogCount,
      invalid_actual_count: invalidActualCount,
      error_count: errorCount,
    };

    await logHealth(supabase, {
      status: errorCount === 0 ? "success" : "failed",
      started_at: startedAtIso,
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
      rows_inserted: dryRun ? 0 : upserts.length,
      rows_updated: 0,
      metadata,
      error_message: errorCount > 0 ? `${errorCount} grading error(s)` : null,
    });

    return new Response(
      JSON.stringify({
        ok: errorCount === 0,
        game_date: gameDate,
        dry_run: dryRun,
        props_checked: targetRows.length,
        graded_count: gradedCount,
        hit_count: hitCount,
        miss_count: missCount,
        push_count: pushCount,
        pending_count: pendingCount,
        missing_result_count: missingResultCount,
        pending_due_to_missing_official_log_count: pendingDueToMissingOfficialLogCount,
        invalid_actual_count: invalidActualCount,
        error_count: errorCount,
        sample_results: sampleResults,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[grade-mlb-props] fatal error", e);

    try {
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
      const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const finishedAt = new Date();
        await logHealth(supabase, {
          status: "failed",
          started_at: startedAtIso,
          finished_at: finishedAt.toISOString(),
          duration_ms: finishedAt.getTime() - startedAt.getTime(),
          rows_inserted: 0,
          rows_updated: 0,
          metadata: { ok: false, error: message },
          error_message: message,
        });
      }
    } catch (logErr) {
      console.error("[grade-mlb-props] failed to write fatal health row", logErr);
    }

    return new Response(
      JSON.stringify({
        ok: false,
        game_date: todayET(),
        dry_run: true,
        props_checked: 0,
        graded_count: 0,
        hit_count: 0,
        miss_count: 0,
        push_count: 0,
        pending_count: 0,
        missing_result_count: 0,
        pending_due_to_missing_official_log_count: 0,
        invalid_actual_count: 0,
        error_count: 1,
        sample_results: [],
        error: message,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
