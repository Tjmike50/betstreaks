import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MLB_ODDS_STAT_TYPES = [
  "batter_hits",
  "batter_total_bases",
  "batter_home_runs",
  "pitcher_strikeouts",
  "pitcher_earned_runs",
  "pitcher_walks",
  "pitcher_hits_allowed",
];

type Severity = "warning" | "critical";

interface CheckResult {
  key: string;
  ok: boolean;
  severity: Severity | null;
  message: string;
  metadata: Record<string, unknown>;
}

function todayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function etDayRange(targetDate: string): { startIso: string; endIso: string } {
  const startIso = `${targetDate}T00:00:00-04:00`;
  const end = new Date(`${targetDate}T00:00:00-04:00`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { startIso, endIso: end.toISOString() };
}

function makeCheck(
  key: string,
  ok: boolean,
  severity: Severity | null,
  message: string,
  metadata: Record<string, unknown>,
): CheckResult {
  return { key, ok, severity: ok ? null : severity, message, metadata };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startedAt = new Date();
  const startedAtIso = startedAt.toISOString();

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let body: { game_date?: string } = {};
    try {
      body = await req.json();
    } catch (_) {
      // allow empty body
    }
    const gameDate = body.game_date || todayET();
    const { startIso, endIso } = etDayRange(gameDate);

    const checks: CheckResult[] = [];

    const { count: teamMapCount, error: teamMapErr } = await supabase
      .from("mlb_team_id_map")
      .select("team_id", { count: "exact", head: true })
      .eq("source", "sportsdataio_teams_endpoint");
    checks.push(
      makeCheck(
        "mlb_team_map_count",
        !teamMapErr && (teamMapCount ?? 0) >= 30,
        "critical",
        teamMapErr
          ? `Failed to count mlb_team_id_map rows: ${teamMapErr.message}`
          : `mlb_team_id_map sportsdataio rows=${teamMapCount ?? 0}`,
        { required_minimum: 30, actual_count: teamMapCount ?? 0, source: "sportsdataio_teams_endpoint" },
      ),
    );

    const { data: lineRows, error: lineErr } = await supabase
      .from("line_snapshots")
      .select("player_id,stat_type")
      .eq("game_date", gameDate)
      .in("stat_type", MLB_ODDS_STAT_TYPES);

    const lineCount = lineRows?.length ?? 0;
    const byStatType = Object.fromEntries(
      MLB_ODDS_STAT_TYPES.map((statType) => [
        statType,
        (lineRows ?? []).filter((row) => row.stat_type === statType).length,
      ]),
    );
    const filledPlayerIdCount = (lineRows ?? []).filter((row) => row.player_id != null).length;
    const fillRate = lineCount > 0 ? filledPlayerIdCount / lineCount : 0;

    checks.push(
      makeCheck(
        "mlb_line_snapshots_present",
        !lineErr && lineCount > 0,
        "critical",
        lineErr
          ? `Failed to read MLB line_snapshots: ${lineErr.message}`
          : `MLB line_snapshots rows=${lineCount}`,
        { game_date: gameDate, total_rows: lineCount, by_stat_type: byStatType },
      ),
    );

    checks.push(
      makeCheck(
        "mlb_line_snapshot_fill_rate",
        !lineErr && (lineCount === 0 ? false : fillRate >= 0.85),
        "critical",
        lineErr
          ? `Failed to compute MLB player_id fill rate: ${lineErr.message}`
          : `MLB player_id fill rate=${(fillRate * 100).toFixed(1)}%`,
        {
          game_date: gameDate,
          total_rows: lineCount,
          filled_player_id_rows: filledPlayerIdCount,
          fill_rate: fillRate,
          minimum_fill_rate: 0.85,
        },
      ),
    );

    const { data: scoreRows, error: scoreErr } = await supabase
      .from("player_prop_scores")
      .select("stat_type,summary_json")
      .eq("sport", "MLB")
      .eq("game_date", gameDate);

    checks.push(
      makeCheck(
        "mlb_player_prop_scores_present",
        !scoreErr && (scoreRows?.length ?? 0) > 0,
        "critical",
        scoreErr
          ? `Failed to read MLB player_prop_scores: ${scoreErr.message}`
          : `MLB player_prop_scores rows=${scoreRows?.length ?? 0}`,
        { game_date: gameDate, total_rows: scoreRows?.length ?? 0 },
      ),
    );

    const strikeoutRows = (scoreRows ?? []).filter((row) => row.stat_type === "STRIKEOUTS");
    const strikeoutMissing = strikeoutRows.filter((row) => {
      const summary = (row.summary_json ?? {}) as Record<string, unknown>;
      return !(
        "k_l3_avg" in summary &&
        "k_l5_avg" in summary &&
        "k_l10_avg" in summary &&
        "over_line_l5_rate" in summary &&
        "over_line_l10_rate" in summary
      );
    }).length;
    checks.push(
      makeCheck(
        "mlb_strikeouts_context",
        strikeoutRows.length === 0 || strikeoutMissing === 0,
        "warning",
        `STRIKEOUTS rows=${strikeoutRows.length}, missing_context_rows=${strikeoutMissing}`,
        {
          game_date: gameDate,
          total_rows: strikeoutRows.length,
          missing_context_rows: strikeoutMissing,
          required_fields: [
            "k_l3_avg",
            "k_l5_avg",
            "k_l10_avg",
            "over_line_l5_rate",
            "over_line_l10_rate",
          ],
        },
      ),
    );

    const pitcherSideStatTypes = ["EARNED_RUNS_ALLOWED", "HITS_ALLOWED", "WALKS_ALLOWED"];
    const pitcherSideRows = (scoreRows ?? []).filter((row) => pitcherSideStatTypes.includes(row.stat_type));
    const pitcherSideMissing = pitcherSideRows.filter((row) => {
      const summary = (row.summary_json ?? {}) as Record<string, unknown>;
      const hasShared =
        "ip_l3_avg" in summary &&
        "ip_l5_avg" in summary &&
        "bf_l3_avg" in summary &&
        "bf_l5_avg" in summary;
      const hasSpecific =
        "er_l3_avg" in summary ||
        "hits_allowed_l3_avg" in summary ||
        "walks_allowed_l3_avg" in summary;
      return !(hasShared && hasSpecific);
    }).length;
    checks.push(
      makeCheck(
        "mlb_pitcher_side_context",
        pitcherSideRows.length === 0 || pitcherSideMissing === 0,
        "warning",
        `Pitcher-side rows=${pitcherSideRows.length}, missing_context_rows=${pitcherSideMissing}`,
        {
          game_date: gameDate,
          total_rows: pitcherSideRows.length,
          missing_context_rows: pitcherSideMissing,
          required_shared_fields: ["ip_l3_avg", "ip_l5_avg", "bf_l3_avg", "bf_l5_avg"],
          required_any_of: ["er_l3_avg", "hits_allowed_l3_avg", "walks_allowed_l3_avg"],
        },
      ),
    );

    const { count: unresolvedCount, error: unresolvedErr } = await supabase
      .from("mlb_unresolved_players")
      .select("id", { count: "exact", head: true })
      .gte("first_seen_at", startIso)
      .lt("first_seen_at", endIso);
    checks.push(
      makeCheck(
        "mlb_unresolved_players_today",
        !unresolvedErr && (unresolvedCount ?? 0) < 10,
        "warning",
        unresolvedErr
          ? `Failed to count mlb_unresolved_players: ${unresolvedErr.message}`
          : `MLB unresolved players today=${unresolvedCount ?? 0}`,
        { game_date: gameDate, unresolved_rows: unresolvedCount ?? 0, maximum_allowed: 10 },
      ),
    );

    const failedChecks = checks.filter((check) => !check.ok);
    const criticalFailures = failedChecks.filter((check) => check.severity === "critical").length;
    const warningFailures = failedChecks.filter((check) => check.severity === "warning").length;

    const existingAlertTypes = new Set<string>();
    if (failedChecks.length > 0) {
      const { data: existingAlerts } = await supabase
        .from("backend_alerts")
        .select("alert_type")
        .eq("sport", "MLB")
        .or("resolved.is.false,resolved.is.null")
        .gte("created_at", startIso)
        .lt("created_at", endIso)
        .in("alert_type", failedChecks.map((check) => check.key));
      for (const row of existingAlerts ?? []) existingAlertTypes.add(row.alert_type);
    }

    const alertsToCreate = failedChecks
      .filter((check) => !existingAlertTypes.has(check.key))
      .map((check) => ({
        sport: "MLB",
        alert_type: check.key,
        severity: check.severity ?? "warning",
        message: check.message,
        metadata: {
          game_date: gameDate,
          ...check.metadata,
        },
        resolved: false,
      }));

    let alertsCreated = 0;
    if (alertsToCreate.length > 0) {
      const { error: alertInsertErr } = await supabase.from("backend_alerts").insert(alertsToCreate);
      if (alertInsertErr) {
        console.error("[mlb-health-check] backend_alerts insert failed", alertInsertErr);
      } else {
        alertsCreated = alertsToCreate.length;
      }
    }

    const report = {
      game_date: gameDate,
      checks,
      alerts_created: alertsCreated,
      critical_failures: criticalFailures,
      warning_failures: warningFailures,
      generated_at: new Date().toISOString(),
    };

    const finishedAt = new Date();
    await supabase.from("mlb_refresh_health").insert({
      job_name: "mlb-health-check",
      status: criticalFailures === 0 ? "success" : "failed",
      started_at: startedAtIso,
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
      rows_inserted: alertsCreated,
      rows_updated: 0,
      metadata: report,
      error_message: criticalFailures === 0 ? null : `${criticalFailures} critical failure(s)`,
    });

    return new Response(
      JSON.stringify({
        ok: criticalFailures === 0,
        game_date: gameDate,
        checks,
        alerts_created: alertsCreated,
        critical_failures: criticalFailures,
        warning_failures: warningFailures,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[mlb-health-check] fatal error", e);
    try {
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
      const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const finishedAt = new Date();
        await supabase.from("mlb_refresh_health").insert({
          job_name: "mlb-health-check",
          status: "failed",
          started_at: startedAtIso,
          finished_at: finishedAt.toISOString(),
          duration_ms: finishedAt.getTime() - startedAt.getTime(),
          rows_inserted: 0,
          rows_updated: 0,
          metadata: { fatal_error: e instanceof Error ? e.message : String(e) },
          error_message: e instanceof Error ? e.message : String(e),
        });
      }
    } catch (logErr) {
      console.error("[mlb-health-check] failed to write fatal health row", logErr);
    }
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
