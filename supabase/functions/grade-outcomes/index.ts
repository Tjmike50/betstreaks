import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const STAT_MAP: Record<string, string> = {
  Points: "pts", Rebounds: "reb", Assists: "ast", "3-Pointers": "fg3m",
  Steals: "stl", Blocks: "blk",
  pts: "pts", reb: "reb", ast: "ast", fg3m: "fg3m", stl: "stl", blk: "blk",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const body = await req.json().catch(() => ({}));
    const { game_date } = body;

    if (!game_date) throw new Error("game_date is required (YYYY-MM-DD)");

    // 1. Get actual game results for that date
    const { data: gameLogs, error: logsErr } = await supabase
      .from("player_recent_games")
      .select("player_id, player_name, team_abbr, game_date, matchup, pts, reb, ast, fg3m, stl, blk")
      .eq("game_date", game_date);

    if (logsErr) throw new Error(`Failed to fetch game logs: ${logsErr.message}`);
    if (!gameLogs || gameLogs.length === 0) {
      return new Response(
        JSON.stringify({ message: "No game logs found for this date", graded_props: 0, graded_slips: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Index actual results by player_id
    const actualResults: Record<number, Record<string, number>> = {};
    for (const log of gameLogs) {
      actualResults[log.player_id] = {
        pts: log.pts ?? 0,
        reb: log.reb ?? 0,
        ast: log.ast ?? 0,
        fg3m: log.fg3m ?? 0,
        stl: log.stl ?? 0,
        blk: log.blk ?? 0,
      };
    }

    // 2. Grade prop outcomes from player_prop_scores
    const { data: propScores } = await supabase
      .from("player_prop_scores")
      .select("*")
      .eq("game_date", game_date);

    let gradedProps = 0;
    if (propScores && propScores.length > 0) {
      const propRows = [];
      for (const p of propScores) {
        const actual = actualResults[p.player_id];
        if (!actual) continue;

        const statCol = STAT_MAP[p.stat_type] || p.stat_type;
        const actualValue = actual[statCol];
        if (actualValue == null) continue;

        const hit = actualValue >= p.threshold;

        propRows.push({
          game_date,
          player_id: p.player_id,
          player_name: p.player_name,
          team_abbr: p.team_abbr,
          opponent_abbr: p.opponent_abbr,
          home_away: p.home_away,
          stat_type: p.stat_type,
          threshold: p.threshold,
          confidence_score: p.confidence_score,
          value_score: p.value_score,
          volatility_score: p.volatility_score,
          consistency_score: p.consistency_score,
          line_hit_rate_l10: p.last10_hit_rate,
          line_hit_rate_season: p.season_hit_rate,
          actual_value: actualValue,
          hit,
          graded_at: new Date().toISOString(),
          reason_tags: p.reason_tags || [],
        });
      }

      if (propRows.length > 0) {
        const { error: upsertErr } = await supabase
          .from("prop_outcomes")
          .upsert(propRows, { onConflict: "game_date,player_id,stat_type,threshold" });
        if (upsertErr) console.error("Prop outcomes upsert error:", upsertErr);
        else gradedProps = propRows.length;
      }
    }

    // 3. Grade slip outcomes
    // Find slips generated on or for this game_date
    const dateStart = `${game_date}T00:00:00.000Z`;
    const dateEnd = `${game_date}T23:59:59.999Z`;

    const { data: slips } = await supabase
      .from("ai_slips")
      .select("id, slip_name, risk_label, estimated_odds, prompt, created_at")
      .gte("created_at", dateStart)
      .lte("created_at", dateEnd);

    let gradedSlips = 0;
    if (slips && slips.length > 0) {
      for (const slip of slips) {
        const { data: legs } = await supabase
          .from("ai_slip_legs")
          .select("*")
          .eq("slip_id", slip.id)
          .order("leg_order");

        if (!legs || legs.length === 0) continue;

        // Grade each leg
        const legOutcomes = [];
        let legsHit = 0;
        let firstFailed: number | null = null;

        for (const leg of legs) {
          // Find player in game logs by name match
          const playerLog = gameLogs.find(
            (g) => g.player_name?.toLowerCase() === leg.player_name?.toLowerCase()
          );

          let actualValue: number | null = null;
          let hit: boolean | null = null;

          if (playerLog) {
            const statCol = STAT_MAP[leg.stat_type] || leg.stat_type.toLowerCase();
            actualValue = (playerLog as any)[statCol] ?? null;

            if (actualValue != null) {
              const lineNum = parseFloat(leg.line.replace(/[^0-9.]/g, ""));
              if (!isNaN(lineNum)) {
                const isOver = leg.pick.toLowerCase().includes("over");
                hit = isOver ? actualValue >= lineNum : actualValue <= lineNum;
                if (hit) legsHit++;
                else if (firstFailed === null) firstFailed = leg.leg_order;
              }
            }
          }

          legOutcomes.push({
            leg_order: leg.leg_order,
            player_name: leg.player_name,
            team_abbr: leg.team_abbr,
            stat_type: leg.stat_type,
            threshold: parseFloat(leg.line.replace(/[^0-9.]/g, "")) || 0,
            pick: leg.pick,
            actual_value: actualValue,
            hit,
            confidence_score: null, // Could be enriched later
          });
        }

        const allGraded = legOutcomes.every((l) => l.hit !== null);
        const slipHit = allGraded ? legOutcomes.every((l) => l.hit === true) : null;

        // Insert slip outcome
        const { data: slipOutcome, error: soErr } = await supabase
          .from("slip_outcomes")
          .insert({
            slip_id: slip.id,
            slip_name: slip.slip_name,
            risk_label: slip.risk_label,
            estimated_odds: slip.estimated_odds,
            leg_count: legs.length,
            legs_hit: legsHit,
            slip_hit: slipHit,
            first_failed_leg: firstFailed,
            prompt: slip.prompt,
            game_date,
            graded_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (soErr) {
          console.error("Slip outcome insert error:", soErr);
          continue;
        }

        // Insert leg outcomes
        if (slipOutcome) {
          const legRows = legOutcomes.map((l) => ({
            ...l,
            slip_outcome_id: slipOutcome.id,
          }));
          const { error: legErr } = await supabase
            .from("slip_leg_outcomes")
            .insert(legRows);
          if (legErr) console.error("Slip leg outcomes insert error:", legErr);
          else gradedSlips++;
        }
      }
    }

    return new Response(
      JSON.stringify({
        game_date,
        graded_props: gradedProps,
        graded_slips: gradedSlips,
        total_game_logs: gameLogs.length,
        total_prop_scores: propScores?.length || 0,
        total_slips: slips?.length || 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("grade-outcomes error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
