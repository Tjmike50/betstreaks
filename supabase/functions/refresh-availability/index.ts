import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Refresh player availability for today's NBA games.
 *
 * Strategy:
 * 1. Get today's games from games_today table to know which teams are playing.
 * 2. For each team, fetch player_recent_games to identify roster players.
 * 3. Derive availability status from game log patterns:
 *    - Missed recent team games → questionable/doubtful/out
 *    - Consistent recent play → active
 *    - Extended absence → out
 * 4. Upsert into player_availability with source="derived" and confidence levels.
 * 5. Update refresh_status tracking row for availability freshness.
 */

interface GameLog {
  player_id: number;
  player_name: string;
  team_abbr: string | null;
  game_date: string;
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a), db = new Date(b);
  return Math.round(Math.abs(da.getTime() - db.getTime()) / 86400000);
}

function deriveStatus(
  playerId: number,
  playerLogs: GameLog[],
  today: string,
  teamGameDates: string[]
): { status: string; reason: string | null; confidence: string } {
  if (playerLogs.length === 0) {
    return { status: "unknown", reason: "no game data", confidence: "low" };
  }

  const lastGameDate = playerLogs[0].game_date;
  const daysSinceLast = daysBetween(today, lastGameDate);

  // Extended absence: 14+ days = out, 10+ = doubtful
  if (daysSinceLast >= 14) {
    return { status: "out", reason: `no game in ${daysSinceLast} days`, confidence: "high" };
  }
  if (daysSinceLast >= 10) {
    return { status: "out", reason: `no game in ${daysSinceLast} days`, confidence: "medium" };
  }

  // Check missed team games
  const recentTeamGames = teamGameDates
    .filter(d => {
      const gap = daysBetween(today, d);
      return gap <= 14 && gap > 0;
    })
    .sort((a, b) => b.localeCompare(a));

  const playerGameDates = new Set(playerLogs.map(g => g.game_date));

  // Count missed in last 5 and last 10 team games
  let missedLast5 = 0;
  let missedLast10 = 0;
  for (let i = 0; i < Math.min(10, recentTeamGames.length); i++) {
    if (!playerGameDates.has(recentTeamGames[i])) {
      if (i < 5) missedLast5++;
      missedLast10++;
    }
  }

  // Pattern analysis
  if (missedLast5 >= 4 && recentTeamGames.length >= 5) {
    return { status: "out", reason: `missed ${missedLast5} of last 5 team games`, confidence: "high" };
  }
  if (missedLast5 >= 3 && recentTeamGames.length >= 4) {
    return { status: "doubtful", reason: `missed ${missedLast5} of last ${Math.min(5, recentTeamGames.length)} team games`, confidence: "medium" };
  }
  if (missedLast5 >= 2 && recentTeamGames.length >= 4) {
    return { status: "questionable", reason: `missed ${missedLast5} of last ${Math.min(5, recentTeamGames.length)} team games`, confidence: "medium" };
  }

  if (daysSinceLast >= 5) {
    return { status: "questionable", reason: `${daysSinceLast} days since last game`, confidence: "low" };
  }

  if (daysSinceLast >= 3 && missedLast10 >= 3 && recentTeamGames.length >= 8) {
    return { status: "probable", reason: `intermittent: missed ${missedLast10} of last 10 team games`, confidence: "low" };
  }

  return { status: "active", reason: null, confidence: "high" };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const body = await req.json().catch(() => ({}));
    const today = body.game_date || new Date().toISOString().split("T")[0];
    const sport: "NBA" | "WNBA" = body.sport === "WNBA" ? "WNBA" : "NBA";

    console.log(`[${sport}] Refreshing availability for ${today}...`);

    // 1. Get today's games to know which teams are playing (sport-scoped)
    const { data: games } = await supabase
      .from("games_today")
      .select("home_team_abbr, away_team_abbr")
      .eq("game_date", today)
      .eq("sport", sport);

    const teamsPlaying = new Set<string>();
    for (const g of games || []) {
      if (g.home_team_abbr) teamsPlaying.add(g.home_team_abbr);
      if (g.away_team_abbr) teamsPlaying.add(g.away_team_abbr);
    }

    if (teamsPlaying.size === 0) {
      console.log(`[${sport}] No games today — skipping availability refresh.`);
      return new Response(
        JSON.stringify({ ok: true, sport, message: "No games today", records: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Teams playing today: ${[...teamsPlaying].join(", ")}`);

    // 2. Fetch recent game logs for all teams playing
    const allLogs: GameLog[] = [];
    for (const team of teamsPlaying) {
      const { data: logs } = await supabase
        .from("player_recent_games")
        .select("player_id, player_name, team_abbr, game_date")
        .eq("team_abbr", team)
        .order("game_date", { ascending: false })
        .limit(500);
      if (logs) allLogs.push(...(logs as GameLog[]));
    }

    // 3. Group by player
    const playerLogs: Record<number, GameLog[]> = {};
    for (const log of allLogs) {
      if (!playerLogs[log.player_id]) playerLogs[log.player_id] = [];
      playerLogs[log.player_id].push(log);
    }

    // 4. Build team game date sets
    const teamGameDates: Record<string, string[]> = {};
    for (const team of teamsPlaying) {
      const dates = new Set<string>();
      for (const logs of Object.values(playerLogs)) {
        for (const g of logs) {
          if (g.team_abbr === team) dates.add(g.game_date);
        }
      }
      teamGameDates[team] = [...dates].sort((a, b) => b.localeCompare(a));
    }

    // 5. Derive availability for each player and upsert
    const rows: any[] = [];
    const teamCoverage: Record<string, number> = {};

    for (const [pidStr, logs] of Object.entries(playerLogs)) {
      const playerId = Number(pidStr);
      const team = logs[0]?.team_abbr;
      if (!team || !teamsPlaying.has(team)) continue;

      logs.sort((a, b) => b.game_date.localeCompare(a.game_date));
      const derived = deriveStatus(playerId, logs, today, teamGameDates[team] || []);

      rows.push({
        player_id: playerId,
        player_name: logs[0].player_name || `Player ${playerId}`,
        team_abbr: team,
        game_date: today,
        status: derived.status,
        reason: derived.reason,
        source: "derived",
        confidence: derived.confidence,
        updated_at: new Date().toISOString(),
      });

      teamCoverage[team] = (teamCoverage[team] || 0) + 1;
    }

    console.log(`Upserting ${rows.length} availability records...`);

    // Upsert in batches of 100
    let upsertErrors = 0;
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      const { error } = await supabase
        .from("player_availability")
        .upsert(batch, { onConflict: "player_id,game_date" });
      if (error) {
        console.error(`Upsert error batch ${i}:`, error);
        upsertErrors++;
      }
    }

    // 6. Update refresh_status for availability tracking
    // (id=2 for NBA, id=12 for WNBA — keeps history separable per sport)
    await supabase
      .from("refresh_status")
      .upsert(
        sport === "WNBA"
          ? { id: 12, sport: "WNBA_AVAIL", last_run: new Date().toISOString() }
          : { id: 2, sport: "NBA_AVAIL", last_run: new Date().toISOString() },
        { onConflict: "id" }
      );

    // Build coverage report
    const teamsWithData = Object.keys(teamCoverage);
    const teamsMissing = [...teamsPlaying].filter(t => !teamsWithData.includes(t));

    const result = {
      ok: upsertErrors === 0,
      game_date: today,
      records: rows.length,
      teams_playing: teamsPlaying.size,
      teams_covered: teamsWithData.length,
      teams_missing: teamsMissing,
      coverage: teamCoverage,
      status_breakdown: {
        active: rows.filter(r => r.status === "active").length,
        probable: rows.filter(r => r.status === "probable").length,
        questionable: rows.filter(r => r.status === "questionable").length,
        doubtful: rows.filter(r => r.status === "doubtful").length,
        out: rows.filter(r => r.status === "out").length,
        unknown: rows.filter(r => r.status === "unknown").length,
      },
      refreshed_at: new Date().toISOString(),
    };

    console.log("Availability refresh complete:", JSON.stringify(result));

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("refresh-availability error:", e);
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
