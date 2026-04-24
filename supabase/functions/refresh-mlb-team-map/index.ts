// Backend-only: Refresh MLB team ID map from SportsDataIO /Teams endpoint.
// This is the ONLY authoritative source for TeamID -> abbreviation mapping.
// Do NOT seed mlb_team_id_map from player_prop_scores or team_recent_games.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

interface SportsDataIoTeam {
  TeamID: number;
  Key: string;
  City?: string | null;
  Name?: string | null;
  Active?: boolean;
}

function getSportsDataKey(): string | null {
  return (
    Deno.env.get("SPORTSDATA_MLB_API_KEY") ??
    Deno.env.get("SPORTSDATA_API_KEY") ??
    Deno.env.get("SPORTSDATAIO_API_KEY") ??
    null
  );
}

async function logHealth(
  supabase: ReturnType<typeof createClient>,
  payload: {
    status: "success" | "failed";
    started_at: string;
    finished_at: string;
    duration_ms: number;
    rows_updated: number;
    error_message?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  try {
    await supabase.from("mlb_refresh_health").insert({
      job_name: "refresh-mlb-team-map",
      status: payload.status,
      started_at: payload.started_at,
      finished_at: payload.finished_at,
      duration_ms: payload.duration_ms,
      rows_inserted: 0,
      rows_updated: payload.rows_updated,
      error_message: payload.error_message ?? null,
      metadata: payload.metadata ?? {},
    });
  } catch (e) {
    console.error("[refresh-mlb-team-map] failed to write health row", e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startedAt = new Date();
  const startedAtIso = startedAt.toISOString();

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ success: false, error: "Missing Supabase env vars" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const apiKey = getSportsDataKey();
  if (!apiKey) {
    const finishedAt = new Date();
    await logHealth(supabase, {
      status: "failed",
      started_at: startedAtIso,
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
      rows_updated: 0,
      error_message:
        "Missing SportsDataIO key (SPORTSDATA_MLB_API_KEY / SPORTSDATA_API_KEY / SPORTSDATAIO_API_KEY)",
    });
    return new Response(
      JSON.stringify({ success: false, error: "Missing SportsDataIO API key" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const url = `https://api.sportsdata.io/v3/mlb/scores/json/Teams?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`SportsDataIO /Teams responded ${res.status}: ${body.slice(0, 500)}`);
    }
    const teams = (await res.json()) as SportsDataIoTeam[];
    if (!Array.isArray(teams)) {
      throw new Error("SportsDataIO /Teams did not return an array");
    }

    const rows = teams
      .filter((t) => t && typeof t.TeamID === "number" && typeof t.Key === "string" && t.Key.length > 0)
      .map((t) => {
        const teamName =
          [t.City ?? "", t.Name ?? ""].map((s) => s.trim()).filter(Boolean).join(" ").trim() ||
          null;
        return {
          team_id: t.TeamID,
          team_abbr: t.Key.toUpperCase(),
          team_name: teamName,
          source: "sportsdataio_teams_endpoint",
          updated_at: new Date().toISOString(),
        };
      });

    if (rows.length === 0) {
      throw new Error("SportsDataIO /Teams returned 0 valid rows");
    }

    const { error: upsertError } = await supabase
      .from("mlb_team_id_map")
      .upsert(rows, { onConflict: "team_id" });
    if (upsertError) {
      throw new Error(`Upsert failed: ${upsertError.message}`);
    }

    const mappedTeams = rows
      .map((r) => ({ team_id: r.team_id, team_abbr: r.team_abbr, team_name: r.team_name }))
      .sort((a, b) => a.team_abbr.localeCompare(b.team_abbr));

    const finishedAt = new Date();
    await logHealth(supabase, {
      status: "success",
      started_at: startedAtIso,
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
      rows_updated: rows.length,
      metadata: { team_count: rows.length, mapped_teams: mappedTeams },
    });

    return new Response(
      JSON.stringify({
        success: true,
        team_count: rows.length,
        mapped_teams: mappedTeams,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[refresh-mlb-team-map] error", message);
    const finishedAt = new Date();
    await logHealth(supabase, {
      status: "failed",
      started_at: startedAtIso,
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
      rows_updated: 0,
      error_message: message,
    });
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
