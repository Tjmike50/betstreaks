import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ODDS_API_BASE = "https://api.the-odds-api.com/v4";

const NBA_TEAM_ABBRS: Record<string, string> = {
  "Atlanta Hawks": "ATL", "Boston Celtics": "BOS", "Brooklyn Nets": "BKN",
  "Charlotte Hornets": "CHA", "Chicago Bulls": "CHI", "Cleveland Cavaliers": "CLE",
  "Dallas Mavericks": "DAL", "Denver Nuggets": "DEN", "Detroit Pistons": "DET",
  "Golden State Warriors": "GSW", "Houston Rockets": "HOU", "Indiana Pacers": "IND",
  "Los Angeles Clippers": "LAC", "Los Angeles Lakers": "LAL", "Memphis Grizzlies": "MEM",
  "Miami Heat": "MIA", "Milwaukee Bucks": "MIL", "Minnesota Timberwolves": "MIN",
  "New Orleans Pelicans": "NOP", "New York Knicks": "NYK", "Oklahoma City Thunder": "OKC",
  "Orlando Magic": "ORL", "Philadelphia 76ers": "PHI", "Phoenix Suns": "PHX",
  "Portland Trail Blazers": "POR", "Sacramento Kings": "SAC", "San Antonio Spurs": "SAS",
  "Toronto Raptors": "TOR", "Utah Jazz": "UTA", "Washington Wizards": "WAS",
};

const STAT_MAP: Record<string, string> = {
  player_points: "Points",
  player_rebounds: "Rebounds",
  player_assists: "Assists",
  player_threes: "3-Pointers",
};

/**
 * Automated line snapshot collector.
 * 
 * Fetches current player props from the Odds API for today's NBA games
 * and stores them in line_snapshots. Deduplicates by skipping inserts
 * when the line+odds haven't changed since the last snapshot.
 *
 * Scheduled 3x on game days: ~11am ET (open), ~3pm ET (mid), ~6pm ET (pre-tip).
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const ODDS_API_KEY = Deno.env.get("ODDS_API_KEY");
    if (!ODDS_API_KEY) throw new Error("ODDS_API_KEY not configured");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const todayStr = new Date().toISOString().split("T")[0];
    console.log(`Collecting line snapshots for ${todayStr}...`);

    // 1. Fetch today's NBA games from Odds API
    const gamesUrl = `${ODDS_API_BASE}/sports/basketball_nba/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h&oddsFormat=american&bookmakers=draftkings,fanduel,betmgm,pointsbetus`;
    const gamesRes = await fetch(gamesUrl);
    if (!gamesRes.ok) {
      const errText = await gamesRes.text();
      throw new Error(`Odds API games error ${gamesRes.status}: ${errText}`);
    }
    const gamesData: any[] = await gamesRes.json();
    console.log(`Found ${gamesData.length} NBA games from Odds API`);

    if (gamesData.length === 0) {
      // Update status even if no games
      await supabase.from("refresh_status").upsert(
        { id: 3, sport: "NBA_LINES", last_run: new Date().toISOString() },
        { onConflict: "id" }
      );
      return new Response(
        JSON.stringify({ ok: true, message: "No NBA games today", snapshots: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1b. Upsert games_today from Odds API so schedule is always populated
    const gamesTodayRows: any[] = [];
    for (const game of gamesData) {
      const commence = new Date(game.commence_time);
      const gameDate = commence.toISOString().split("T")[0];
      // Only upsert games that start today (UTC date)
      const homeAbbr = NBA_TEAM_ABBRS[game.home_team] || null;
      const awayAbbr = NBA_TEAM_ABBRS[game.away_team] || null;
      const gameTime = commence.toLocaleTimeString("en-US", {
        hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "America/New_York",
      });
      gamesTodayRows.push({
        id: game.id,
        sport: "NBA",
        game_date: gameDate,
        home_team_abbr: homeAbbr,
        away_team_abbr: awayAbbr,
        game_time: gameTime,
        status: "Scheduled",
        updated_at: new Date().toISOString(),
      });
    }
    if (gamesTodayRows.length > 0) {
      const { error: gtErr } = await supabase
        .from("games_today")
        .upsert(gamesTodayRows, { onConflict: "id" });
      if (gtErr) {
        console.error("games_today upsert error:", gtErr);
      } else {
        console.log(`Upserted ${gamesTodayRows.length} games_today rows`);
      }
    }

    // Build game_id → game_date map from commence_time
    const gameIdToDate = new Map<string, string>();
    const allGameDates = new Set<string>();
    for (const game of gamesData) {
      const commence = new Date(game.commence_time);
      // Use ET date for game_date (NBA games are scheduled in ET)
      const etDate = commence.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
      gameIdToDate.set(game.id, etDate);
      allGameDates.add(etDate);
    }
    console.log(`Game dates from commence_time: ${[...allGameDates].sort().join(", ")}`);

    // 2. Fetch existing snapshots for relevant dates to enable deduplication
    const { data: existingSnaps } = await supabase
      .from("line_snapshots")
      .select("player_name, stat_type, threshold, over_odds, under_odds, sportsbook, game_date")
      .in("game_date", [...allGameDates])
      .order("snapshot_at", { ascending: false });

    // Build a map of latest snapshot per prop for dedup (include game_date in key)
    const latestByKey = new Map<string, { over_odds: string | null; under_odds: string | null; threshold: number }>();
    for (const s of existingSnaps || []) {
      const key = `${s.player_name}|${s.stat_type}|${s.sportsbook}|${s.game_date}`;
      if (!latestByKey.has(key)) {
        latestByKey.set(key, { over_odds: s.over_odds, under_odds: s.under_odds, threshold: s.threshold });
      }
    }

    // 3. Fetch player props for up to 5 games (balance API quota)
    const newRows: any[] = [];
    let skippedDupes = 0;
    let gamesProcessed = 0;

    for (const game of gamesData.slice(0, 5)) {
      const gameDate = gameIdToDate.get(game.id) || todayStr;
      try {
        const propsUrl = `${ODDS_API_BASE}/sports/basketball_nba/events/${game.id}/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=player_points,player_rebounds,player_assists,player_threes&oddsFormat=american&bookmakers=draftkings,fanduel,betmgm,pointsbetus`;
        const propsRes = await fetch(propsUrl);
        if (!propsRes.ok) {
          console.warn(`Props fetch failed for game ${game.id}: ${propsRes.status}`);
          continue;
        }

        const propsData = await propsRes.json();
        gamesProcessed++;

        for (const bm of propsData.bookmakers || []) {
          for (const market of bm.markets || []) {
            const statType = STAT_MAP[market.key];
            if (!statType) continue;

            // Group outcomes by player+point to get over/under pair
            const outcomesByPlayer: Record<string, { over?: string; under?: string; point?: number; player?: string }> = {};
            for (const o of market.outcomes || []) {
              const key = `${o.description}_${o.point}`;
              if (!outcomesByPlayer[key]) outcomesByPlayer[key] = { player: o.description, point: o.point };
              if (o.name === "Over") outcomesByPlayer[key].over = String(o.price);
              if (o.name === "Under") outcomesByPlayer[key].under = String(o.price);
            }

            for (const entry of Object.values(outcomesByPlayer)) {
              if (!entry.player || entry.point == null) continue;

              // Dedup: skip if line + odds haven't changed since last snapshot
              const dedupKey = `${entry.player}|${statType}|${bm.key}|${gameDate}`;
              const prev = latestByKey.get(dedupKey);
              if (prev &&
                  prev.threshold === entry.point &&
                  prev.over_odds === (entry.over || null) &&
                  prev.under_odds === (entry.under || null)) {
                skippedDupes++;
                continue;
              }

              newRows.push({
                player_name: entry.player,
                stat_type: statType,
                threshold: entry.point,
                over_odds: entry.over || null,
                under_odds: entry.under || null,
                sportsbook: bm.key,
                game_date: gameDate,
              });

              // Update dedup map for within-batch dedup
              latestByKey.set(dedupKey, {
                over_odds: entry.over || null,
                under_odds: entry.under || null,
                threshold: entry.point,
              });
            }
          }
        }
      } catch (e) {
        console.error(`Error processing game ${game.id}:`, e);
      }
    }

    console.log(`New snapshots: ${newRows.length}, skipped dupes: ${skippedDupes}, games: ${gamesProcessed}`);

    // 4. Insert new snapshots in batches
    let insertErrors = 0;
    for (let i = 0; i < newRows.length; i += 200) {
      const batch = newRows.slice(i, i + 200);
      const { error } = await supabase.from("line_snapshots").insert(batch);
      if (error) {
        console.error(`Insert error batch ${i}:`, error);
        insertErrors++;
      }
    }

    // 5. Update refresh_status (id=3 for line snapshots)
    await supabase.from("refresh_status").upsert(
      { id: 3, sport: "NBA_LINES", last_run: new Date().toISOString() },
      { onConflict: "id" }
    );

    // 6. Count total snapshots for relevant dates
    const { count: totalToday } = await supabase
      .from("line_snapshots")
      .select("id", { count: "exact", head: true })
      .in("game_date", [...allGameDates]);

    // Count by date for visibility
    const dateCounts: Record<string, number> = {};
    for (const row of newRows) {
      dateCounts[row.game_date] = (dateCounts[row.game_date] || 0) + 1;
    }

    // 7. Chain pipeline: trigger availability refresh → scoring engine
    //    Non-blocking with 45s timeout per step. Only for today's date.
    const pipelineResults: Record<string, any> = {};
    const todayET = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

    if (allGameDates.has(todayET) && gamesProcessed > 0) {
      const fnBase = SUPABASE_URL.replace(/\/$/, "") + "/functions/v1";
      const svcHeaders = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
      };

      // Step A: Refresh availability
      try {
        console.log("Pipeline: triggering refresh-availability...");
        const availRes = await fetch(`${fnBase}/refresh-availability`, {
          method: "POST",
          headers: svcHeaders,
          body: JSON.stringify({ game_date: todayET }),
          signal: AbortSignal.timeout(45_000),
        });
        const availBody = await availRes.json();
        pipelineResults.availability = { ok: availBody.ok, records: availBody.records, status_breakdown: availBody.status_breakdown };
        console.log(`Pipeline: availability done — ${availBody.records} records`);
      } catch (e) {
        console.error("Pipeline: availability failed:", e);
        pipelineResults.availability = { ok: false, error: String(e) };
      }

      // Step B: Trigger scoring engine with full market coverage
      try {
        console.log("Pipeline: triggering prop-scoring-engine...");
        const scoreRes = await fetch(`${fnBase}/prop-scoring-engine`, {
          method: "POST",
          headers: svcHeaders,
          body: JSON.stringify({ score_all_market_players: true }),
          signal: AbortSignal.timeout(45_000),
        });
        const scoreBody = await scoreRes.json();
        pipelineResults.scoring = { ok: true, players_analyzed: scoreBody.players_analyzed, scored_count: scoreBody.scored_count };
        console.log(`Pipeline: scoring done — ${scoreBody.scored_count} props scored`);
      } catch (e) {
        console.error("Pipeline: scoring failed:", e);
        pipelineResults.scoring = { ok: false, error: String(e) };
      }
    } else {
      pipelineResults.skipped = "no games today or no games processed";
    }

    const result = {
      ok: insertErrors === 0,
      game_dates: [...allGameDates].sort(),
      games_processed: gamesProcessed,
      new_snapshots: newRows.length,
      new_by_date: dateCounts,
      skipped_dupes: skippedDupes,
      total_across_dates: totalToday || 0,
      pipeline: pipelineResults,
      refreshed_at: new Date().toISOString(),
    };

    console.log("Snapshot collection + pipeline complete:", JSON.stringify(result));

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("collect-line-snapshots error:", e);
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
