import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-refresh-secret",
};

interface GameData {
  id: string;
  home_team_abbr: string | null;
  away_team_abbr: string | null;
  home_score: number | null;
  away_score: number | null;
  status: string | null;
  game_date: string;
  game_time: string | null;
  sport: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    // Validate refresh secret
    const refreshSecret = req.headers.get("x-refresh-secret");
    const expectedSecret = Deno.env.get("REFRESH_SECRET");

    if (!refreshSecret || refreshSecret !== expectedSecret) {
      console.error("Invalid or missing x-refresh-secret header");
      return new Response(
        JSON.stringify({ ok: false, error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Initialize Supabase with service role key for server-side operations
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log("Starting refresh_games_today...");

    // ========================================
    // PLACEHOLDER: NBA API LOGIC GOES HERE
    // ========================================
    // This is where you'll add the NBA API calls to fetch today's games.
    // The logic should:
    // 1. Fetch today's NBA schedule from the NBA API
    // 2. For each game, get scores and status
    // 3. Transform the data into GameData format
    // 4. Upsert into games_today table
    //
    // Example structure:
    // const games: GameData[] = await fetchNBAGamesToday();
    //
    // For now, we'll just update the refresh_status to indicate the function ran.
    // ========================================

    const games: GameData[] = [];
    
    // Example: If you have games data, upsert them
    if (games.length > 0) {
      const { error: upsertError } = await supabase
        .from("games_today")
        .upsert(
          games.map((g) => ({
            ...g,
            updated_at: new Date().toISOString(),
          })),
          { onConflict: "id" }
        );

      if (upsertError) {
        console.error("Error upserting games:", upsertError);
        throw upsertError;
      }
    }

    // Update refresh_status for games refresh
    // Using id=2 for games_today refresh (id=1 is for player/streak data)
    const { error: statusError } = await supabase
      .from("refresh_status")
      .upsert(
        { id: 2, sport: "NBA", last_run: new Date().toISOString() },
        { onConflict: "id" }
      );

    if (statusError) {
      console.error("Error updating refresh_status:", statusError);
      // Non-fatal, continue
    }

    const duration = Date.now() - startTime;

    console.log(`refresh_games_today completed in ${duration}ms, processed ${games.length} games`);

    return new Response(
      JSON.stringify({
        ok: true,
        ran_at: new Date().toISOString(),
        counts: { games: games.length },
        duration_ms: duration,
        message: "Placeholder - add NBA API logic to fetch real game data",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error("refresh_games_today failed:", error);

    return new Response(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
        duration_ms: duration,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
