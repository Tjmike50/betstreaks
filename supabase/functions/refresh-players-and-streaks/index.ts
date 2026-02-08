import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-refresh-secret",
};

interface RefreshCounts {
  player_recent_games: number;
  team_recent_games: number;
  streaks: number;
  streak_events: number;
}

interface PlayerGameLog {
  player_id: number;
  player_name: string;
  team_abbr: string;
  game_id: string;
  game_date: string;
  matchup: string;
  wl: string | null;
  pts: number;
  reb: number;
  ast: number;
  fg3m: number;
  blk: number;
  stl: number;
}

interface StreakData {
  player_id: number;
  player_name: string;
  team_abbr: string | null;
  stat: string;
  threshold: number;
  streak_len: number;
  streak_start: string;
  last_game: string;
  streak_win_pct: number;
  season_wins: number;
  season_games: number;
  season_win_pct: number;
  last5_hits: number;
  last5_games: number;
  last5_hit_pct: number | null;
  last10_hits: number;
  last10_games: number;
  last10_hit_pct: number | null;
  last15_hits: number;
  last15_games: number;
  last15_hit_pct: number | null;
  last20_hits: number;
  last20_games: number;
  last20_hit_pct: number | null;
  entity_type: string;
  sport: string;
}

interface StreakEvent {
  player_id: number;
  player_name: string;
  team_abbr: string | null;
  stat: string;
  threshold: number;
  event_type: "started" | "extended" | "broken";
  prev_streak_len: number | null;
  new_streak_len: number | null;
  last_game: string | null;
  entity_type: string;
  sport: string;
}

// Threshold ranges by stat type (matching src/types/streak.ts)
const THRESHOLD_RANGES: Record<string, { min: number; max: number; step: number }> = {
  PTS: { min: 10, max: 40, step: 5 },
  REB: { min: 3, max: 15, step: 1 },
  AST: { min: 3, max: 15, step: 1 },
  "3PM": { min: 1, max: 8, step: 1 },
  BLK: { min: 1, max: 5, step: 1 },
  STL: { min: 1, max: 5, step: 1 },
};

const STAT_KEYS: Record<string, keyof PlayerGameLog> = {
  PTS: "pts",
  REB: "reb",
  AST: "ast",
  "3PM": "fg3m",
  BLK: "blk",
  STL: "stl",
};

const MIN_STREAK_LENGTH = 3;

// NBA Stats API headers to avoid blocking
const NBA_STATS_HEADERS = {
  "Host": "stats.nba.com",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "x-nba-stats-origin": "stats",
  "x-nba-stats-token": "true",
  "Origin": "https://stats.nba.com",
  "Referer": "https://stats.nba.com/",
  "Connection": "keep-alive",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
};

function getCurrentSeason(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  // NBA season starts in October, so Oct-Dec is current year, Jan-Jun is previous year
  if (month >= 10) {
    return `${year}-${(year + 1).toString().slice(-2)}`;
  } else {
    return `${year - 1}-${year.toString().slice(-2)}`;
  }
}

async function fetchLeagueGameLog(): Promise<PlayerGameLog[]> {
  const season = getCurrentSeason();
  const url = new URL("https://stats.nba.com/stats/leaguegamelog");
  url.searchParams.set("Counter", "0");
  url.searchParams.set("DateFrom", "");
  url.searchParams.set("DateTo", "");
  url.searchParams.set("Direction", "DESC");
  url.searchParams.set("ISTRound", "");
  url.searchParams.set("LeagueID", "00");
  url.searchParams.set("PlayerOrTeam", "P");
  url.searchParams.set("Season", season);
  url.searchParams.set("SeasonType", "Regular Season");
  url.searchParams.set("Sorter", "DATE");

  console.log(`Fetching league game log for season ${season}...`);
  console.log(`URL: ${url.toString()}`);

  const response = await fetch(url.toString(), {
    headers: NBA_STATS_HEADERS,
  });

  if (!response.ok) {
    const text = await response.text();
    console.error("NBA Stats API error response:", text.substring(0, 500));
    throw new Error(`NBA Stats API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  
  // Parse the NBA API response format
  const resultSet = data.resultSets?.[0];
  if (!resultSet) {
    throw new Error("No result set in NBA API response");
  }

  const headers: string[] = resultSet.headers;
  const rows: unknown[][] = resultSet.rowSet;

  // Map column indices
  const colIndex: Record<string, number> = {};
  headers.forEach((h: string, i: number) => {
    colIndex[h] = i;
  });

  console.log(`Received ${rows.length} game log rows`);
  console.log(`Headers: ${headers.join(", ")}`);

  const gameLogs: PlayerGameLog[] = rows.map((row: unknown[]) => ({
    player_id: row[colIndex["PLAYER_ID"]] as number,
    player_name: row[colIndex["PLAYER_NAME"]] as string,
    team_abbr: row[colIndex["TEAM_ABBREVIATION"]] as string,
    game_id: row[colIndex["GAME_ID"]] as string,
    game_date: row[colIndex["GAME_DATE"]] as string,
    matchup: row[colIndex["MATCHUP"]] as string,
    wl: row[colIndex["WL"]] as string | null,
    pts: (row[colIndex["PTS"]] as number) || 0,
    reb: (row[colIndex["REB"]] as number) || 0,
    ast: (row[colIndex["AST"]] as number) || 0,
    fg3m: (row[colIndex["FG3M"]] as number) || 0,
    blk: (row[colIndex["BLK"]] as number) || 0,
    stl: (row[colIndex["STL"]] as number) || 0,
  }));

  return gameLogs;
}

function calculateStreaks(
  gameLogs: PlayerGameLog[],
  existingStreaks: Map<string, { streak_len: number }>
): { streaks: StreakData[]; events: StreakEvent[] } {
  const streaks: StreakData[] = [];
  const events: StreakEvent[] = [];

  // Group games by player
  const playerGames = new Map<number, PlayerGameLog[]>();
  for (const log of gameLogs) {
    if (!playerGames.has(log.player_id)) {
      playerGames.set(log.player_id, []);
    }
    playerGames.get(log.player_id)!.push(log);
  }

  // For each player, calculate streaks
  for (const [playerId, games] of playerGames) {
    // Sort games by date DESC (most recent first)
    games.sort((a, b) => new Date(b.game_date).getTime() - new Date(a.game_date).getTime());
    
    const playerName = games[0].player_name;
    const teamAbbr = games[0].team_abbr;

    // For each stat type
    for (const [stat, statKey] of Object.entries(STAT_KEYS)) {
      const range = THRESHOLD_RANGES[stat];
      if (!range) continue;

      // Generate thresholds
      const thresholds: number[] = [];
      for (let t = range.min; t <= range.max; t += range.step) {
        thresholds.push(t);
      }

      // For each threshold
      for (const threshold of thresholds) {
        // Calculate consecutive streak from most recent game
        let streakLen = 0;
        for (const game of games) {
          const value = game[statKey] as number;
          if (value >= threshold) {
            streakLen++;
          } else {
            break;
          }
        }

        // Skip if streak is too short
        if (streakLen < MIN_STREAK_LENGTH) continue;

        // Calculate season stats
        let seasonWins = 0;
        for (const game of games) {
          if ((game[statKey] as number) >= threshold) {
            seasonWins++;
          }
        }
        const seasonGames = games.length;
        const seasonWinPct = seasonGames > 0 ? (seasonWins / seasonGames) * 100 : 0;

        // Calculate last N stats
        const last5 = games.slice(0, 5);
        const last10 = games.slice(0, 10);
        const last15 = games.slice(0, 15);
        const last20 = games.slice(0, 20);

        const calcHits = (subset: PlayerGameLog[]) => 
          subset.filter(g => (g[statKey] as number) >= threshold).length;

        const last5Hits = calcHits(last5);
        const last10Hits = calcHits(last10);
        const last15Hits = calcHits(last15);
        const last20Hits = calcHits(last20);

        // Find streak start date
        const streakStartGame = games[streakLen - 1];
        const streakStart = streakStartGame?.game_date || games[0].game_date;
        const lastGame = games[0].game_date;

        const streak: StreakData = {
          player_id: playerId,
          player_name: playerName,
          team_abbr: teamAbbr,
          stat,
          threshold,
          streak_len: streakLen,
          streak_start: streakStart,
          last_game: lastGame,
          streak_win_pct: 100, // Current streak is always 100%
          season_wins: seasonWins,
          season_games: seasonGames,
          season_win_pct: Math.round(seasonWinPct * 100) / 100,
          last5_hits: last5Hits,
          last5_games: last5.length,
          last5_hit_pct: last5.length > 0 ? Math.round((last5Hits / last5.length) * 100 * 100) / 100 : null,
          last10_hits: last10Hits,
          last10_games: last10.length,
          last10_hit_pct: last10.length > 0 ? Math.round((last10Hits / last10.length) * 100 * 100) / 100 : null,
          last15_hits: last15Hits,
          last15_games: last15.length,
          last15_hit_pct: last15.length > 0 ? Math.round((last15Hits / last15.length) * 100 * 100) / 100 : null,
          last20_hits: last20Hits,
          last20_games: last20.length,
          last20_hit_pct: last20.length > 0 ? Math.round((last20Hits / last20.length) * 100 * 100) / 100 : null,
          entity_type: "player",
          sport: "NBA",
        };

        streaks.push(streak);

        // Check for streak events
        const key = `${playerId}-${stat}-${threshold}`;
        const existing = existingStreaks.get(key);

        if (!existing) {
          // New streak started
          events.push({
            player_id: playerId,
            player_name: playerName,
            team_abbr: teamAbbr,
            stat,
            threshold,
            event_type: "started",
            prev_streak_len: null,
            new_streak_len: streakLen,
            last_game: lastGame,
            entity_type: "player",
            sport: "NBA",
          });
        } else if (streakLen > existing.streak_len) {
          // Streak extended
          events.push({
            player_id: playerId,
            player_name: playerName,
            team_abbr: teamAbbr,
            stat,
            threshold,
            event_type: "extended",
            prev_streak_len: existing.streak_len,
            new_streak_len: streakLen,
            last_game: lastGame,
            entity_type: "player",
            sport: "NBA",
          });
        }
      }
    }
  }

  // Check for broken streaks (existed before but not now)
  for (const [key, existing] of existingStreaks) {
    const [playerIdStr, stat, thresholdStr] = key.split("-");
    const playerId = parseInt(playerIdStr);
    const threshold = parseInt(thresholdStr);
    
    const stillExists = streaks.some(
      s => s.player_id === playerId && s.stat === stat && s.threshold === threshold
    );

    if (!stillExists) {
      // Find player name from game logs
      const playerGames = gameLogs.filter(g => g.player_id === playerId);
      if (playerGames.length > 0) {
        events.push({
          player_id: playerId,
          player_name: playerGames[0].player_name,
          team_abbr: playerGames[0].team_abbr,
          stat,
          threshold,
          event_type: "broken",
          prev_streak_len: existing.streak_len,
          new_streak_len: null,
          last_game: playerGames[0].game_date,
          entity_type: "player",
          sport: "NBA",
        });
      }
    }
  }

  return { streaks, events };
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

    console.log("Starting refresh_players_and_streaks with NBA Stats API...");

    const counts: RefreshCounts = {
      player_recent_games: 0,
      team_recent_games: 0,
      streaks: 0,
      streak_events: 0,
    };

    // Step 1: Fetch league game log
    let gameLogs: PlayerGameLog[];
    try {
      gameLogs = await fetchLeagueGameLog();
      console.log(`Fetched ${gameLogs.length} player game logs`);
    } catch (apiError) {
      console.error("NBA Stats API fetch failed:", apiError);
      // Return partial failure - API might be blocking
      return new Response(
        JSON.stringify({
          ok: false,
          error: `NBA Stats API error: ${apiError instanceof Error ? apiError.message : "Unknown error"}`,
          duration_ms: Date.now() - startTime,
          hint: "stats.nba.com may be blocking cloud server IPs. Consider using an alternative data source.",
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 2: Upsert player recent games
    if (gameLogs.length > 0) {
      // Take only last 20 games per player for recent games table
      const playerGameCounts = new Map<number, number>();
      const recentGames = gameLogs.filter(log => {
        const count = playerGameCounts.get(log.player_id) || 0;
        if (count < 20) {
          playerGameCounts.set(log.player_id, count + 1);
          return true;
        }
        return false;
      });

      const { error: gamesError } = await supabase
        .from("player_recent_games")
        .upsert(
          recentGames.map(g => ({
            player_id: g.player_id,
            player_name: g.player_name,
            team_abbr: g.team_abbr,
            game_id: g.game_id,
            game_date: g.game_date,
            matchup: g.matchup,
            wl: g.wl,
            pts: g.pts,
            reb: g.reb,
            ast: g.ast,
            fg3m: g.fg3m,
            blk: g.blk,
            stl: g.stl,
            sport: "NBA",
            updated_at: new Date().toISOString(),
          })),
          { onConflict: "player_id,game_id" }
        );

      if (gamesError) {
        console.error("Error upserting player_recent_games:", gamesError);
        // Non-fatal, continue
      } else {
        counts.player_recent_games = recentGames.length;
        console.log(`Upserted ${recentGames.length} player recent games`);
      }
    }

    // Step 3: Fetch existing streaks for event detection
    const { data: existingStreaksData } = await supabase
      .from("streaks")
      .select("player_id, stat, threshold, streak_len")
      .eq("sport", "NBA")
      .eq("entity_type", "player");

    const existingStreaks = new Map<string, { streak_len: number }>();
    for (const s of existingStreaksData || []) {
      const key = `${s.player_id}-${s.stat}-${s.threshold}`;
      existingStreaks.set(key, { streak_len: s.streak_len });
    }

    console.log(`Found ${existingStreaks.size} existing streaks`);

    // Step 4: Calculate new streaks
    const { streaks, events } = calculateStreaks(gameLogs, existingStreaks);
    
    console.log(`Calculated ${streaks.length} streaks and ${events.length} events`);

    // Step 5: Delete old player streaks and insert new ones
    if (streaks.length > 0) {
      // Delete existing player streaks
      const { error: deleteError } = await supabase
        .from("streaks")
        .delete()
        .eq("sport", "NBA")
        .eq("entity_type", "player");

      if (deleteError) {
        console.error("Error deleting old streaks:", deleteError);
      }

      // Insert new streaks in batches
      const BATCH_SIZE = 500;
      for (let i = 0; i < streaks.length; i += BATCH_SIZE) {
        const batch = streaks.slice(i, i + BATCH_SIZE);
        const { error: insertError } = await supabase
          .from("streaks")
          .insert(batch.map(s => ({
            ...s,
            updated_at: new Date().toISOString(),
          })));

        if (insertError) {
          console.error(`Error inserting streaks batch ${i / BATCH_SIZE}:`, insertError);
        }
      }
      
      counts.streaks = streaks.length;
      console.log(`Inserted ${streaks.length} streaks`);
    }

    // Step 6: Insert streak events
    if (events.length > 0) {
      const { error: eventsError } = await supabase
        .from("streak_events")
        .insert(events);

      if (eventsError) {
        console.error("Error inserting streak_events:", eventsError);
      } else {
        counts.streak_events = events.length;
        console.log(`Inserted ${events.length} streak events`);
      }
    }

    // Update refresh_status for player/streak refresh (id=1)
    const { error: statusError } = await supabase
      .from("refresh_status")
      .upsert(
        { id: 1, sport: "NBA", last_run: new Date().toISOString() },
        { onConflict: "id" }
      );

    if (statusError) {
      console.error("Error updating refresh_status:", statusError);
      // Non-fatal, continue
    }

    const duration = Date.now() - startTime;

    console.log(`refresh_players_and_streaks completed in ${duration}ms`);
    console.log(`Counts: ${JSON.stringify(counts)}`);

    // Sample of top streaks for response
    const topStreaks = streaks
      .sort((a, b) => b.streak_len - a.streak_len)
      .slice(0, 5)
      .map(s => ({
        player: s.player_name,
        stat: s.stat,
        threshold: s.threshold,
        streak: s.streak_len,
      }));

    return new Response(
      JSON.stringify({
        ok: true,
        ran_at: new Date().toISOString(),
        counts,
        duration_ms: duration,
        sample_streaks: topStreaks,
        sample_events: events.slice(0, 5),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error("refresh_players_and_streaks failed:", error);

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
