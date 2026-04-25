import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MLB_LINE_STAT_TYPES = [
  "batter_hits",
  "batter_total_bases",
  "batter_home_runs",
  "pitcher_strikeouts",
  "pitcher_earned_runs",
  "pitcher_walks",
  "pitcher_hits_allowed",
];

function todayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function anchorNow(gameDate?: string): Date {
  if (!gameDate) return new Date();
  return new Date(`${gameDate}T12:00:00-04:00`);
}

function isoDaysAgo(base: Date, days: number): string {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

async function logCleanupHealth(
  supabase: ReturnType<typeof createClient>,
  payload: {
    status: "success" | "failed";
    started_at: string;
    finished_at: string;
    duration_ms: number;
    metadata: Record<string, unknown>;
    error_message?: string | null;
  },
) {
  try {
    await supabase.from("mlb_refresh_health").insert({
      job_name: "mlb-stale-data-cleanup",
      status: payload.status,
      started_at: payload.started_at,
      finished_at: payload.finished_at,
      duration_ms: payload.duration_ms,
      rows_inserted: 0,
      rows_updated: 0,
      metadata: payload.metadata,
      error_message: payload.error_message ?? null,
    });
  } catch (e) {
    console.error("[mlb-stale-data-cleanup] failed to write health row", e);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startedAt = new Date();
  const startedAtIso = startedAt.toISOString();
  const errors: string[] = [];

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let body: { dry_run?: boolean; game_date?: string } = {};
    try {
      body = await req.json();
    } catch (_) {
      // allow empty body
    }

    const dryRun = body.dry_run ?? true;
    const gameDate = body.game_date || todayET();
    const baseNow = anchorNow(body.game_date);
    const oddsCutoff = isoDaysAgo(baseNow, 2);
    const lineCutoff = isoDaysAgo(baseNow, 30);
    const alertsCutoff = isoDaysAgo(baseNow, 60);
    const unresolvedCutoff = isoDaysAgo(baseNow, 30);

    const counts = {
      odds_cache_expired: 0,
      mlb_line_snapshots_old: 0,
      resolved_backend_alerts_old: 0,
      stale_resolved_unresolved_players: 0,
    };

    const deleted = {
      odds_cache_expired: 0,
      mlb_line_snapshots_old: 0,
      resolved_backend_alerts_old: 0,
      stale_resolved_unresolved_players: 0,
    };

    const { count: oddsCount, error: oddsCountErr } = await supabase
      .from("odds_cache")
      .select("id", { count: "exact", head: true })
      .eq("sport_key", "baseball_mlb")
      .lt("expires_at", oddsCutoff);
    if (oddsCountErr) errors.push(`odds_cache count failed: ${oddsCountErr.message}`);
    counts.odds_cache_expired = oddsCount ?? 0;

    const { count: lineCount, error: lineCountErr } = await supabase
      .from("line_snapshots")
      .select("id", { count: "exact", head: true })
      .in("stat_type", MLB_LINE_STAT_TYPES)
      .lt("snapshot_at", lineCutoff);
    if (lineCountErr) errors.push(`line_snapshots count failed: ${lineCountErr.message}`);
    counts.mlb_line_snapshots_old = lineCount ?? 0;

    const { count: alertCount, error: alertCountErr } = await supabase
      .from("backend_alerts")
      .select("id", { count: "exact", head: true })
      .eq("sport", "MLB")
      .eq("resolved", true)
      .lt("created_at", alertsCutoff);
    if (alertCountErr) errors.push(`backend_alerts count failed: ${alertCountErr.message}`);
    counts.resolved_backend_alerts_old = alertCount ?? 0;

    const { data: unresolvedRows, error: unresolvedErr } = await supabase
      .from("mlb_unresolved_players")
      .select("id,resolution_status,last_seen_at,first_seen_at")
      .or(`last_seen_at.lt.${unresolvedCutoff},and(last_seen_at.is.null,first_seen_at.lt.${unresolvedCutoff})`);
    if (unresolvedErr) {
      errors.push(`mlb_unresolved_players scan failed: ${unresolvedErr.message}`);
    }
    const unresolvedIds = (unresolvedRows ?? [])
      .filter((row) => row.resolution_status !== "unresolved")
      .map((row) => row.id);
    counts.stale_resolved_unresolved_players = unresolvedIds.length;

    if (!dryRun) {
      if (counts.odds_cache_expired > 0) {
        const { error } = await supabase
          .from("odds_cache")
          .delete()
          .eq("sport_key", "baseball_mlb")
          .lt("expires_at", oddsCutoff);
        if (error) errors.push(`odds_cache delete failed: ${error.message}`);
        else deleted.odds_cache_expired = counts.odds_cache_expired;
      }

      if (counts.mlb_line_snapshots_old > 0) {
        const { error } = await supabase
          .from("line_snapshots")
          .delete()
          .in("stat_type", MLB_LINE_STAT_TYPES)
          .lt("snapshot_at", lineCutoff);
        if (error) errors.push(`line_snapshots delete failed: ${error.message}`);
        else deleted.mlb_line_snapshots_old = counts.mlb_line_snapshots_old;
      }

      if (counts.resolved_backend_alerts_old > 0) {
        const { error } = await supabase
          .from("backend_alerts")
          .delete()
          .eq("sport", "MLB")
          .eq("resolved", true)
          .lt("created_at", alertsCutoff);
        if (error) errors.push(`backend_alerts delete failed: ${error.message}`);
        else deleted.resolved_backend_alerts_old = counts.resolved_backend_alerts_old;
      }

      if (unresolvedIds.length > 0) {
        for (let i = 0; i < unresolvedIds.length; i += 500) {
          const chunk = unresolvedIds.slice(i, i + 500);
          const { error } = await supabase
            .from("mlb_unresolved_players")
            .delete()
            .in("id", chunk);
          if (error) {
            errors.push(`mlb_unresolved_players delete failed: ${error.message}`);
            break;
          }
          deleted.stale_resolved_unresolved_players += chunk.length;
        }
      }
    }

    const result = {
      ok: errors.length === 0,
      dry_run: dryRun,
      counts,
      deleted,
      errors,
      cutoffs: {
        odds_cache_before: oddsCutoff,
        line_snapshots_before: lineCutoff,
        backend_alerts_before: alertsCutoff,
        mlb_unresolved_players_before: unresolvedCutoff,
      },
      game_date: gameDate,
    };

    const finishedAt = new Date();
    await logCleanupHealth(supabase, {
      status: errors.length === 0 ? "success" : "failed",
      started_at: startedAtIso,
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
      metadata: result,
      error_message: errors.length > 0 ? errors.join(" | ") : null,
    });

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    errors.push(message);
    console.error("[mlb-stale-data-cleanup] fatal error", e);

    try {
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
      const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const finishedAt = new Date();
        await logCleanupHealth(supabase, {
          status: "failed",
          started_at: startedAtIso,
          finished_at: finishedAt.toISOString(),
          duration_ms: finishedAt.getTime() - startedAt.getTime(),
          metadata: { ok: false, errors },
          error_message: message,
        });
      }
    } catch (logErr) {
      console.error("[mlb-stale-data-cleanup] failed to write fatal health row", logErr);
    }

    return new Response(
      JSON.stringify({
        ok: false,
        dry_run: true,
        counts: {},
        deleted: {},
        errors,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
