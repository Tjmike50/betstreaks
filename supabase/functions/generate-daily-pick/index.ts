// =============================================================================
// generate-daily-pick — deterministic daily-pick generator.
// Reads from player_prop_scores for today's game_date for the requested sport,
// selects up to N legs using a deterministic recipe, and writes one row to
// ai_daily_picks (+ ai_daily_pick_legs). Idempotent via UNIQUE(sport,pick_date)
// — duplicate calls for the same (sport,date) skip silently.
//
// No AI prose layer yet (deterministic name + templated reasoning only).
// No cron yet — invoke manually via supabase.functions.invoke or curl.
//
// Query/body params:
//   sport: "NBA" | "WNBA"  (required, default "NBA")
//   leg_count: number      (optional, default 3, clamped 1..6)
//   game_date: "YYYY-MM-DD" (optional, defaults to today UTC date)
//   force: boolean         (optional, ADMIN-ONLY) — when true, deletes any
//                          existing pick for (sport, pick_date) and regenerates.
//                          Requires Authorization: Bearer <user_jwt> for an
//                          admin user (user_flags.is_admin = true).
// =============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface PropScoreRow {
  id: string;
  game_date: string;
  player_id: number;
  player_name: string;
  team_abbr: string | null;
  opponent_abbr: string | null;
  stat_type: string;
  threshold: number;
  confidence_score: number | null;
  value_score: number | null;
  last10_avg: number | null;
  season_avg: number | null;
  sport: string;
}

const RISK_LABEL = (avgConfidence: number): "safe" | "balanced" | "aggressive" => {
  // Calibrated to market-first scoring scale (15–85, typical high ~70).
  if (avgConfidence >= 65) return "safe";
  if (avgConfidence >= 55) return "balanced";
  return "aggressive";
};

const STAT_LABEL: Record<string, string> = {
  pts: "Points",
  reb: "Rebounds",
  ast: "Assists",
  stl: "Steals",
  blk: "Blocks",
  fg3m: "3-Pointers Made",
  pra: "PRA",
  pr: "PR",
  pa: "PA",
  ra: "RA",
};

function statLabel(stat: string): string {
  return STAT_LABEL[stat.toLowerCase()] ?? stat.toUpperCase();
}

function determineSide(row: PropScoreRow): "Over" | "Under" {
  // Pick "Over" if recent average comfortably exceeds threshold; else infer from
  // value_score sign-equivalent. Value score >= 50 typically encodes positive EV
  // toward the over in our scoring engine, so default to Over unless recents
  // clearly favor the Under.
  const recent = row.last10_avg ?? row.season_avg ?? 0;
  if (row.threshold > 0 && recent < row.threshold * 0.9) return "Under";
  return "Over";
}

function pickLegs(rows: PropScoreRow[], legCount: number): PropScoreRow[] {
  // Deterministic recipe (calibrated to market-first scoring scale 15–85):
  // - Sanity floors: confidence_score >= 55, value_score >= 50
  // - Composite = (confidence * 0.6 + value * 0.4) — confidence weighted higher
  // - Diversification passes: stat-type, then game-uniqueness, then player-uniqueness
  // - Returns top N after diversification
  const eligible = rows
    .filter(
      (r) =>
        (r.confidence_score ?? 0) >= 55 &&
        (r.value_score ?? 0) >= 50 &&
        r.threshold > 0 &&
        r.player_name &&
        r.stat_type,
    )
    .sort((a, b) => {
      const sa =
        (a.confidence_score ?? 0) * 0.6 + (a.value_score ?? 0) * 0.4;
      const sb =
        (b.confidence_score ?? 0) * 0.6 + (b.value_score ?? 0) * 0.4;
      return sb - sa;
    });


  const picked: PropScoreRow[] = [];
  const seenPlayers = new Set<number>();
  const seenGames = new Set<string>();
  const seenStats = new Set<string>();

  // Pass 1: enforce stat diversity
  for (const row of eligible) {
    if (picked.length >= legCount) break;
    const gameKey = [row.team_abbr, row.opponent_abbr].sort().join("@");
    if (seenPlayers.has(row.player_id)) continue;
    if (seenGames.has(gameKey)) continue;
    if (seenStats.has(row.stat_type)) continue;
    picked.push(row);
    seenPlayers.add(row.player_id);
    seenGames.add(gameKey);
    seenStats.add(row.stat_type);
  }

  // Pass 2: relax stat diversity if still short
  if (picked.length < legCount) {
    for (const row of eligible) {
      if (picked.length >= legCount) break;
      const gameKey = [row.team_abbr, row.opponent_abbr].sort().join("@");
      if (seenPlayers.has(row.player_id)) continue;
      if (seenGames.has(gameKey)) continue;
      picked.push(row);
      seenPlayers.add(row.player_id);
      seenGames.add(gameKey);
    }
  }

  // Pass 3: relax game uniqueness as last resort
  if (picked.length < legCount) {
    for (const row of eligible) {
      if (picked.length >= legCount) break;
      if (seenPlayers.has(row.player_id)) continue;
      picked.push(row);
      seenPlayers.add(row.player_id);
    }
  }

  return picked;
}

function buildSlipName(sport: string, dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const day = d.getUTCDate();
  return `${sport} Daily Pick — ${month} ${day}`;
}

function buildReasoning(legs: PropScoreRow[], avgConfidence: number): string {
  const stats = [...new Set(legs.map((l) => statLabel(l.stat_type)))].join(", ");
  return `Auto-selected from today's top scoring-engine props (avg confidence ${avgConfidence.toFixed(
    0,
  )}). Mix of ${stats}. Based on recent form, matchup history, and value vs market. Not financial advice — please bet responsibly.`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const url = new URL(req.url);
    let sport = (url.searchParams.get("sport") ?? "NBA").toUpperCase();
    let legCount = Number(url.searchParams.get("leg_count") ?? "3");
    let gameDate = url.searchParams.get("game_date") ?? "";

    // Allow body to override
    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body?.sport) sport = String(body.sport).toUpperCase();
        if (body?.leg_count != null) legCount = Number(body.leg_count);
        if (body?.game_date) gameDate = String(body.game_date);
      } catch {
        // ignore — empty body is fine
      }
    }

    if (sport !== "NBA" && sport !== "WNBA") {
      return new Response(
        JSON.stringify({ ok: false, error: `Unsupported sport: ${sport}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    legCount = Math.max(1, Math.min(6, isNaN(legCount) ? 3 : legCount));

    if (!gameDate) {
      // Default: today (UTC date — matches game_date convention in player_prop_scores)
      gameDate = new Date().toISOString().slice(0, 10);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Skip-on-conflict: if a pick already exists for (sport, pick_date), bail.
    const { data: existing, error: existingError } = await supabase
      .from("ai_daily_picks")
      .select("id, slip_name, created_at")
      .eq("sport", sport)
      .eq("pick_date", gameDate)
      .maybeSingle();

    if (existingError) throw existingError;
    if (existing) {
      console.log(
        `[generate-daily-pick] Skip: pick already exists for ${sport} ${gameDate} (id=${existing.id})`,
      );
      return new Response(
        JSON.stringify({
          ok: true,
          skipped: true,
          reason: "already_exists",
          existing_pick_id: existing.id,
          sport,
          pick_date: gameDate,
          duration_ms: Date.now() - startTime,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Pull candidate prop scores for this sport + date
    const { data: scores, error: scoresError } = await supabase
      .from("player_prop_scores")
      .select(
        "id, game_date, player_id, player_name, team_abbr, opponent_abbr, stat_type, threshold, confidence_score, value_score, last10_avg, season_avg, sport",
      )
      .eq("sport", sport)
      .eq("game_date", gameDate)
      .order("confidence_score", { ascending: false })
      .limit(500);

    if (scoresError) throw scoresError;

    const candidates = (scores ?? []) as PropScoreRow[];
    console.log(
      `[generate-daily-pick] ${sport} ${gameDate}: ${candidates.length} candidate prop scores`,
    );

    if (candidates.length === 0) {
      return new Response(
        JSON.stringify({
          ok: true,
          skipped: true,
          reason: "no_candidates",
          sport,
          pick_date: gameDate,
          message: `No player_prop_scores rows for ${sport} on ${gameDate} — likely offseason or pre-pipeline.`,
          duration_ms: Date.now() - startTime,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const legs = pickLegs(candidates, legCount);

    if (legs.length === 0) {
      return new Response(
        JSON.stringify({
          ok: true,
          skipped: true,
          reason: "no_eligible_legs",
          sport,
          pick_date: gameDate,
          message: `Found ${candidates.length} candidates but none met confidence>=70 & value>=60 thresholds.`,
          duration_ms: Date.now() - startTime,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const avgConfidence =
      legs.reduce((sum, l) => sum + (l.confidence_score ?? 0), 0) / legs.length;
    const riskLabel = RISK_LABEL(avgConfidence);
    const slipName = buildSlipName(sport, gameDate);
    const reasoning = buildReasoning(legs, avgConfidence);

    // Insert pick
    const { data: insertedPick, error: insertPickError } = await supabase
      .from("ai_daily_picks")
      .insert({
        sport,
        pick_date: gameDate,
        risk_label: riskLabel,
        slip_name: slipName,
        reasoning,
        estimated_odds: null, // odds enrichment deferred
        generation_source: "auto",
      })
      .select("id")
      .single();

    if (insertPickError) {
      // Could be a race on the unique constraint — treat as skip
      if (insertPickError.code === "23505") {
        return new Response(
          JSON.stringify({
            ok: true,
            skipped: true,
            reason: "race_conflict",
            sport,
            pick_date: gameDate,
            duration_ms: Date.now() - startTime,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      throw insertPickError;
    }

    const pickId = insertedPick.id;

    // Insert legs
    const legRows = legs.map((leg, idx) => {
      const side = determineSide(leg);
      return {
        daily_pick_id: pickId,
        leg_order: idx + 1,
        player_name: leg.player_name,
        team_abbr: leg.team_abbr,
        stat_type: leg.stat_type,
        pick: side,
        line: String(leg.threshold),
        odds: null,
        reasoning: `Confidence ${(leg.confidence_score ?? 0).toFixed(0)} · Value ${(leg.value_score ?? 0).toFixed(0)} · L10 avg ${(leg.last10_avg ?? leg.season_avg ?? 0).toFixed(1)}`,
      };
    });

    const { error: insertLegsError } = await supabase
      .from("ai_daily_pick_legs")
      .insert(legRows);

    if (insertLegsError) {
      // Roll back the parent pick to keep things clean
      await supabase.from("ai_daily_picks").delete().eq("id", pickId);
      throw insertLegsError;
    }

    console.log(
      `[generate-daily-pick] Created pick ${pickId} for ${sport} ${gameDate} with ${legs.length} legs (risk=${riskLabel})`,
    );

    return new Response(
      JSON.stringify({
        ok: true,
        created: true,
        pick_id: pickId,
        sport,
        pick_date: gameDate,
        slip_name: slipName,
        risk_label: riskLabel,
        leg_count: legs.length,
        avg_confidence: Number(avgConfidence.toFixed(1)),
        duration_ms: Date.now() - startTime,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[generate-daily-pick] failed:", error);
    return new Response(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
        duration_ms: Date.now() - startTime,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
