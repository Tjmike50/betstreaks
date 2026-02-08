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

// NBA CDN API response types
interface NBAGame {
  gameId: string;
  gameCode: string;
  gameStatus: number;
  gameStatusText: string;
  gameTimeUTC: string;
  gameDateTimeUTC: string;
  homeTeam: {
    teamId: number;
    teamName: string;
    teamCity: string;
    teamTricode: string;
    score: number;
  };
  awayTeam: {
    teamId: number;
    teamName: string;
    teamCity: string;
    teamTricode: string;
    score: number;
  };
}

interface NBAScoreboardResponse {
  scoreboard: {
    gameDate: string;
    games: NBAGame[];
  };
}

function parseGameTime(gameTimeUTC: string): { gameDate: string; gameTime: string } {
  try {
    const date = new Date(gameTimeUTC);
    // Format date as YYYY-MM-DD
    const gameDate = date.toISOString().split("T")[0];
    
    // Format time in ET (Eastern Time)
    const gameTime = date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "America/New_York",
    }) + " ET";
    
    return { gameDate, gameTime };
  } catch (error) {
    console.error("Error parsing game time:", gameTimeUTC, error);
    return { gameDate: new Date().toISOString().split("T")[0], gameTime: null as unknown as string };
  }
}

function transformNBAGame(nbaGame: NBAGame): GameData {
  const { gameDate, gameTime } = parseGameTime(nbaGame.gameTimeUTC || nbaGame.gameDateTimeUTC);
  
  return {
    id: nbaGame.gameId,
    home_team_abbr: nbaGame.homeTeam.teamTricode,
    away_team_abbr: nbaGame.awayTeam.teamTricode,
    home_score: nbaGame.homeTeam.score,
    away_score: nbaGame.awayTeam.score,
    status: nbaGame.gameStatusText,
    game_date: gameDate,
    game_time: gameTime,
    sport: "NBA",
  };
}

async function fetchNBAScoreboard(): Promise<NBAGame[]> {
  const url = "https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json";
  
  console.log("Fetching NBA scoreboard from CDN...");
  
  const response = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`NBA CDN API error: ${response.status} ${response.statusText}`);
  }

  const data: NBAScoreboardResponse = await response.json();
  
  console.log(`Fetched ${data.scoreboard?.games?.length || 0} games for ${data.scoreboard?.gameDate}`);
  
  return data.scoreboard?.games || [];
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

    console.log("Starting refresh_games_today with NBA CDN API...");

    // Fetch today's games from NBA CDN
    const nbaGames = await fetchNBAScoreboard();
    
    // Transform to our format
    const games: GameData[] = nbaGames.map(transformNBAGame);
    
    console.log(`Transformed ${games.length} games for upsert`);
    
    // Upsert games if we have any
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
      
      console.log(`Successfully upserted ${games.length} games`);
    } else {
      console.log("No games to upsert (likely no games today)");
    }

    // Update refresh_status for games refresh (id=2)
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
        sample: games.slice(0, 3).map(g => ({
          id: g.id,
          matchup: `${g.away_team_abbr} @ ${g.home_team_abbr}`,
          status: g.status,
        })),
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
