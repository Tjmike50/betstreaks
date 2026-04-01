import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Map display stat types to prop_scores stat types
const STAT_TYPE_MAP: Record<string, string> = {
  "points": "pts", "rebounds": "reb", "assists": "ast",
  "3-pointers": "fg3m", "steals": "stl", "blocks": "blk",
};

function normStat(st: string): string {
  return STAT_TYPE_MAP[st.toLowerCase()] || st.toLowerCase();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get all slip_leg_outcomes that need enrichment (no confidence_score yet)
    const { data: legs, error: legErr } = await supabase
      .from("slip_leg_outcomes")
      .select("id, player_name, stat_type, threshold, slip_outcome_id, confidence_score, value_score, books_count")
      .is("confidence_score", null)
      .limit(500);

    if (legErr) throw legErr;
    if (!legs || legs.length === 0) {
      return new Response(JSON.stringify({ enriched: 0, message: "No legs to backfill" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get parent slip outcomes for game_date
    const slipOutcomeIds = [...new Set(legs.map(l => l.slip_outcome_id))];
    const { data: slipOutcomes } = await supabase
      .from("slip_outcomes")
      .select("id, game_date")
      .in("id", slipOutcomeIds);

    const dateMap: Record<string, string> = {};
    for (const so of slipOutcomes || []) {
      dateMap[so.id] = so.game_date;
    }

    const gameDates = [...new Set(Object.values(dateMap))];

    // Build score map from prop_scores using mapped stat types
    const scoreMap: Record<string, { confidence_score: number | null; value_score: number | null }> = {};

    // First try exact game_date match
    const { data: propScores } = await supabase
      .from("player_prop_scores")
      .select("player_name, stat_type, threshold, game_date, confidence_score, value_score")
      .in("game_date", gameDates)
      .limit(1000);

    for (const ps of propScores || []) {
      const key = `${ps.player_name.toLowerCase()}|${ps.stat_type.toLowerCase()}|${ps.threshold}|${ps.game_date}`;
      scoreMap[key] = { confidence_score: ps.confidence_score, value_score: ps.value_score };
    }

    // For unmatched legs, find nearest scores by player+stat+threshold (any date)
    const unmatchedCombos = new Set<string>();
    for (const leg of legs) {
      const gd = dateMap[leg.slip_outcome_id];
      if (!gd) continue;
      // Skip non-player legs (team names for Moneyline/Spread/Total)
      if (["moneyline", "spread", "total"].includes(leg.stat_type.toLowerCase())) continue;
      const mapped = normStat(leg.stat_type);
      const key = `${leg.player_name.toLowerCase()}|${mapped}|${leg.threshold}|${gd}`;
      if (!scoreMap[key]) {
        unmatchedCombos.add(`${leg.player_name.toLowerCase()}|${mapped}|${leg.threshold}`);
      }
    }

    for (const combo of unmatchedCombos) {
      const [pn, st, th] = combo.split("|");
      const { data: nearest } = await supabase
        .from("player_prop_scores")
        .select("confidence_score, value_score, game_date")
        .ilike("player_name", pn)
        .eq("stat_type", st)
        .eq("threshold", parseFloat(th))
        .order("game_date", { ascending: false })
        .limit(1);

      if (nearest && nearest.length > 0) {
        // Apply to all legs with this combo
        for (const leg of legs) {
          const gd = dateMap[leg.slip_outcome_id];
          if (!gd) continue;
          const legCombo = `${leg.player_name.toLowerCase()}|${normStat(leg.stat_type)}|${leg.threshold}`;
          if (legCombo === combo) {
            const key = `${leg.player_name.toLowerCase()}|${normStat(leg.stat_type)}|${leg.threshold}|${gd}`;
            scoreMap[key] = { confidence_score: nearest[0].confidence_score, value_score: nearest[0].value_score };
          }
        }
      }
    }

    // Fetch line snapshots for books count
    const { data: lineSnaps } = await supabase
      .from("line_snapshots")
      .select("player_name, stat_type, threshold, game_date, sportsbook")
      .in("game_date", gameDates)
      .limit(1000);

    const booksMap: Record<string, Set<string>> = {};
    for (const ls of lineSnaps || []) {
      // line_snapshots stat_type matches prop_scores format (lowercase abbrevs)
      const key = `${ls.player_name.toLowerCase()}|${ls.stat_type.toLowerCase()}|${ls.threshold}|${ls.game_date}`;
      booksMap[key] = booksMap[key] || new Set();
      booksMap[key].add(ls.sportsbook);
    }

    // Update each leg
    let enriched = 0;
    for (const leg of legs) {
      const gameDate = dateMap[leg.slip_outcome_id];
      if (!gameDate) continue;

      const mapped = normStat(leg.stat_type);
      const scoreKey = `${leg.player_name.toLowerCase()}|${mapped}|${leg.threshold}|${gameDate}`;
      const scores = scoreMap[scoreKey];
      const books = booksMap[scoreKey];

      const updates: Record<string, number | null> = {};
      if (scores?.confidence_score != null) updates.confidence_score = scores.confidence_score;
      if (scores?.value_score != null) updates.value_score = scores.value_score;
      if (books) updates.books_count = books.size;

      if (Object.keys(updates).length > 0) {
        const { error } = await supabase
          .from("slip_leg_outcomes")
          .update(updates)
          .eq("id", leg.id);
        if (!error) enriched++;
      }
    }

    return new Response(JSON.stringify({ enriched, total_checked: legs.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
