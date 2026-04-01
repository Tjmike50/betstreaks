import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify admin
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) {
        const { data: flags } = await supabase
          .from("user_flags")
          .select("is_admin")
          .eq("user_id", user.id)
          .single();
        if (!flags?.is_admin) {
          return new Response(JSON.stringify({ error: "Not admin" }), { status: 403, headers: corsHeaders });
        }
      }
    }

    // Get all slip_leg_outcomes that need enrichment
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

    // Collect unique game dates
    const gameDates = [...new Set(Object.values(dateMap))];

    // Fetch prop scores
    const { data: propScores } = await supabase
      .from("player_prop_scores")
      .select("player_name, stat_type, threshold, game_date, confidence_score, value_score")
      .in("game_date", gameDates)
      .limit(1000);

    const scoreMap: Record<string, { confidence_score: number | null; value_score: number | null }> = {};
    for (const ps of propScores || []) {
      const key = `${ps.player_name.toLowerCase()}|${ps.stat_type.toLowerCase()}|${ps.threshold}|${ps.game_date}`;
      scoreMap[key] = { confidence_score: ps.confidence_score, value_score: ps.value_score };
    }

    // Fetch line snapshots for books count
    const { data: lineSnaps } = await supabase
      .from("line_snapshots")
      .select("player_name, stat_type, threshold, game_date, sportsbook")
      .in("game_date", gameDates)
      .limit(1000);

    const booksMap: Record<string, Set<string>> = {};
    for (const ls of lineSnaps || []) {
      const key = `${ls.player_name.toLowerCase()}|${ls.stat_type.toLowerCase()}|${ls.threshold}|${ls.game_date}`;
      if (!booksMap[key]) booksMap[key] = new Set();
      booksMap[key].add(ls.sportsbook);
    }

    // Update each leg
    let enriched = 0;
    for (const leg of legs) {
      const gameDate = dateMap[leg.slip_outcome_id];
      if (!gameDate) continue;

      const key = `${leg.player_name.toLowerCase()}|${leg.stat_type.toLowerCase()}|${leg.threshold}|${gameDate}`;
      const scores = scoreMap[key];
      const books = booksMap[key];

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
