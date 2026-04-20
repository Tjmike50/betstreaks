import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.1";
import {
  MLB_ODDS_API_MARKETS,
  MLB_ODDS_API_SPORT,
} from "../_shared/mlbMarketMap.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

// WNBA team abbreviations as returned by The Odds API "home_team" / "away_team" strings.
const WNBA_TEAM_ABBRS: Record<string, string> = {
  "Atlanta Dream": "ATL", "Chicago Sky": "CHI", "Connecticut Sun": "CON",
  "Dallas Wings": "DAL", "Golden State Valkyries": "GSV", "Indiana Fever": "IND",
  "Las Vegas Aces": "LVA", "Los Angeles Sparks": "LA", "Minnesota Lynx": "MIN",
  "New York Liberty": "NYL", "Phoenix Mercury": "PHX", "Seattle Storm": "SEA",
  "Washington Mystics": "WAS",
};

// Phase 1 sport registry (mirrors src/lib/sports/registry.ts).
// When WNBA goes in-season, flip seasonState below to enable ingestion.
type SportKey = "NBA" | "WNBA" | "MLB";

interface SportConfig {
  oddsApiSport: string;
  teamMap: Record<string, string>;
  refreshStatusId: number;
  refreshStatusLabel: string;
  seasonState: "preseason" | "regular" | "postseason" | "offseason";
  /** Comma-separated player-prop market list passed to get-odds. */
  propMarkets: string;
  /**
   * Stat-type rewrite. NBA/WNBA convert market keys to friendly labels
   * (e.g. player_points → "Points") because their scorer reads friendly
   * labels. MLB keeps the raw Odds API market keys (e.g. "batter_hits")
   * because score-mlb-anchors queries line_snapshots by market key.
   */
  statRewrite: Record<string, string> | "passthrough";
}

const NBA_PROP_MARKETS = "player_points,player_rebounds,player_assists,player_threes";
const NBA_STAT_REWRITE: Record<string, string> = {
  player_points: "Points",
  player_rebounds: "Rebounds",
  player_assists: "Assists",
  player_threes: "3-Pointers",
};

const SPORT_CONFIG: Record<SportKey, SportConfig> = {
  NBA: {
    oddsApiSport: "basketball_nba",
    teamMap: NBA_TEAM_ABBRS,
    refreshStatusId: 3,
    refreshStatusLabel: "NBA_LINES",
    seasonState: "postseason",
    propMarkets: NBA_PROP_MARKETS,
    statRewrite: NBA_STAT_REWRITE,
  },
  WNBA: {
    oddsApiSport: "basketball_wnba",
    teamMap: WNBA_TEAM_ABBRS,
    refreshStatusId: 13,
    refreshStatusLabel: "WNBA_LINES",
    seasonState: "offseason",
    propMarkets: NBA_PROP_MARKETS,
    statRewrite: NBA_STAT_REWRITE,
  },
  MLB: {
    oddsApiSport: MLB_ODDS_API_SPORT, // "baseball_mlb"
    teamMap: {}, // MLB team registry not wired yet — leave abbrs null in games_today.
    refreshStatusId: 23,
    refreshStatusLabel: "MLB_LINES",
    seasonState: "regular",
    // v1 scope: only the 3 anchor markets currently scored by score-mlb-anchors.
    // (batter_hits, batter_total_bases, pitcher_strikeouts)
    propMarkets: [
      "batter_hits",
      "batter_total_bases",
      "pitcher_strikeouts",
    ].join(","),
    statRewrite: "passthrough",
  },
};

/**
 * Automated line snapshot collector.
 * 
 * Now uses the get-odds edge function for provider-agnostic fetching with
 * automatic failover and caching. Falls back gracefully when all providers are down.
 *
 * Scheduled 3x on game days: ~11am ET (open), ~3pm ET (mid), ~6pm ET (pre-tip).
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const fnBase = SUPABASE_URL.replace(/\/$/, "") + "/functions/v1";
    const svcHeaders = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
    };

    // Sport selection (default NBA for backward compatibility).
    const reqBody = await req.json().catch(() => ({}));
    const rawSport = String(reqBody?.sport ?? "NBA").toUpperCase();
    const sport: SportKey =
      rawSport === "WNBA" ? "WNBA" : rawSport === "MLB" ? "MLB" : "NBA";
    const cfg = SPORT_CONFIG[sport];

    // Offseason short-circuit (saves Odds API quota).
    if (cfg.seasonState === "offseason") {
      console.log(`[${sport}] seasonState=offseason — skipping line collection.`);
      await supabase.from("refresh_status").upsert(
        { id: cfg.refreshStatusId, sport: cfg.refreshStatusLabel, last_run: new Date().toISOString() },
        { onConflict: "id" }
      );
      return new Response(
        JSON.stringify({ ok: true, sport, skipped: "offseason", new_snapshots: 0, games_processed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const todayStr = new Date().toISOString().split("T")[0];
    console.log(`[${sport}] Collecting line snapshots for ${todayStr}...`);

    // 1. Fetch today's games via get-odds (game-level h2h)
    let gamesOddsResponse: any;
    try {
      const res = await fetch(`${fnBase}/get-odds`, {
        method: "POST",
        headers: svcHeaders,
        body: JSON.stringify({ sport: cfg.oddsApiSport, market: "h2h", ttl: 300 }),
        signal: AbortSignal.timeout(30_000),
      });
      gamesOddsResponse = await res.json();
    } catch (e) {
      console.error("Failed to fetch game odds:", e);
      gamesOddsResponse = { ok: false, data: [] };
    }

    const oddsData = gamesOddsResponse.data || [];
    const oddsProvider = gamesOddsResponse.meta?.provider || "unknown";
    const oddsFallback = gamesOddsResponse.meta?.fallbackUsed || false;
    const oddsStale = gamesOddsResponse.meta?.isStale || false;

    console.log(`[${sport}] Got ${oddsData.length} game-odds entries from ${oddsProvider} (fallback=${oddsFallback}, stale=${oddsStale})`);

    // Deduplicate events by eventId
    const eventMap = new Map<string, any>();
    for (const entry of oddsData) {
      if (!eventMap.has(entry.eventId)) {
        eventMap.set(entry.eventId, {
          id: entry.eventId,
          home_team: entry.homeTeam,
          away_team: entry.awayTeam,
          commence_time: entry.commenceTime,
        });
      }
    }
    const gamesData = [...eventMap.values()];
    console.log(`[${sport}] Found ${gamesData.length} unique games`);

    if (gamesData.length === 0) {
      await supabase.from("refresh_status").upsert(
        { id: cfg.refreshStatusId, sport: cfg.refreshStatusLabel, last_run: new Date().toISOString() },
        { onConflict: "id" }
      );
      return new Response(
        JSON.stringify({ ok: true, sport, message: `No ${sport} games today`, snapshots: 0, provider: oddsProvider }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1b. Upsert games_today
    const gamesTodayRows: any[] = [];
    for (const game of gamesData) {
      const commence = new Date(game.commence_time);
      const gameDate = commence.toISOString().split("T")[0];
      const homeAbbr = cfg.teamMap[game.home_team] || null;
      const awayAbbr = cfg.teamMap[game.away_team] || null;
      const gameTime = commence.toLocaleTimeString("en-US", {
        hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "America/New_York",
      });
      gamesTodayRows.push({
        id: game.id,
        sport,
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
      if (gtErr) console.error("games_today upsert error:", gtErr);
      else console.log(`Upserted ${gamesTodayRows.length} games_today rows`);
    }

    // Build game_id → game_date map
    const gameIdToDate = new Map<string, string>();
    const allGameDates = new Set<string>();
    for (const game of gamesData) {
      const commence = new Date(game.commence_time);
      const etDate = commence.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
      gameIdToDate.set(game.id, etDate);
      allGameDates.add(etDate);
    }
    console.log(`Game dates: ${[...allGameDates].sort().join(", ")}`);

    // 2. Fetch existing snapshots for deduplication
    const { data: existingSnaps } = await supabase
      .from("line_snapshots")
      .select("player_name, stat_type, threshold, over_odds, under_odds, sportsbook, game_date")
      .in("game_date", [...allGameDates])
      .order("snapshot_at", { ascending: false });

    const latestByKey = new Map<string, { over_odds: string | null; under_odds: string | null; threshold: number }>();
    for (const s of existingSnaps || []) {
      const key = `${s.player_name}|${s.stat_type}|${s.sportsbook}|${s.game_date}`;
      if (!latestByKey.has(key)) {
        latestByKey.set(key, { over_odds: s.over_odds, under_odds: s.under_odds, threshold: s.threshold });
      }
    }

    // 3. Fetch player props for up to 5 games via get-odds
    const newRows: any[] = [];
    let skippedDupes = 0;
    let gamesProcessed = 0;
    const propMarkets = cfg.propMarkets;

    for (const game of gamesData.slice(0, 5)) {
      const gameDate = gameIdToDate.get(game.id) || todayStr;
      try {
        const propsRes = await fetch(`${fnBase}/get-odds`, {
          method: "POST",
          headers: svcHeaders,
          body: JSON.stringify({
            sport: cfg.oddsApiSport,
            market: propMarkets,
            eventId: game.id,
            ttl: 120,
          }),
          signal: AbortSignal.timeout(30_000),
        });
        const propsResponse = await propsRes.json();
        if (!propsResponse.ok && (!propsResponse.data || propsResponse.data.length === 0)) {
          console.warn(`No props for game ${game.id}`);
          continue;
        }

        gamesProcessed++;
        const propsData = propsResponse.data || [];

        for (const entry of propsData) {
          // NBA/WNBA rewrite friendly labels; MLB stores raw market keys
          // because score-mlb-anchors queries line_snapshots by market key.
          let statType: string | null;
          if (cfg.statRewrite === "passthrough") {
            statType = MLB_ODDS_API_MARKETS.includes(entry.marketKey)
              ? entry.marketKey
              : null;
          } else {
            statType = cfg.statRewrite[entry.marketKey] ?? null;
          }
          if (!statType) continue;

          // Group outcomes by player+point to get over/under pair
          const outcomesByPlayer: Record<string, { over?: string; under?: string; point?: number; player?: string }> = {};
          for (const o of entry.outcomes || []) {
            const desc = (o as any).description || o.name;
            const key = `${desc}_${o.point}`;
            if (!outcomesByPlayer[key]) outcomesByPlayer[key] = { player: desc, point: o.point };
            if (o.name === "Over") outcomesByPlayer[key].over = String(o.price);
            if (o.name === "Under") outcomesByPlayer[key].under = String(o.price);
          }

          for (const prop of Object.values(outcomesByPlayer)) {
            if (!prop.player || prop.point == null) continue;

            const dedupKey = `${prop.player}|${statType}|${entry.bookmakerKey}|${gameDate}`;
            const prev = latestByKey.get(dedupKey);
            if (prev &&
                prev.threshold === prop.point &&
                prev.over_odds === (prop.over || null) &&
                prev.under_odds === (prop.under || null)) {
              skippedDupes++;
              continue;
            }

            newRows.push({
              player_name: prop.player,
              stat_type: statType,
              threshold: prop.point,
              over_odds: prop.over || null,
              under_odds: prop.under || null,
              sportsbook: entry.bookmakerKey,
              game_date: gameDate,
            });

            latestByKey.set(dedupKey, {
              over_odds: prop.over || null,
              under_odds: prop.under || null,
              threshold: prop.point,
            });
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

    // 5. Update refresh_status
    await supabase.from("refresh_status").upsert(
      { id: cfg.refreshStatusId, sport: cfg.refreshStatusLabel, last_run: new Date().toISOString() },
      { onConflict: "id" }
    );

    // 6. Count total snapshots
    const { count: totalToday } = await supabase
      .from("line_snapshots")
      .select("id", { count: "exact", head: true })
      .in("game_date", [...allGameDates]);

    const dateCounts: Record<string, number> = {};
    for (const row of newRows) {
      dateCounts[row.game_date] = (dateCounts[row.game_date] || 0) + 1;
    }

    // 7. Chain pipeline
    const pipelineResults: Record<string, any> = {};
    const todayET = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

    if (allGameDates.has(todayET) && gamesProcessed > 0) {
      try {
        console.log(`[${sport}] Pipeline: triggering refresh-availability...`);
        const availRes = await fetch(`${fnBase}/refresh-availability`, {
          method: "POST", headers: svcHeaders,
          body: JSON.stringify({ game_date: todayET, sport }),
          signal: AbortSignal.timeout(45_000),
        });
        const availBody = await availRes.json();
        pipelineResults.availability = { ok: availBody.ok, records: availBody.records };
        console.log(`[${sport}] Pipeline: availability done — ${availBody.records} records`);
      } catch (e) {
        console.error(`[${sport}] Pipeline: availability failed:`, e);
        pipelineResults.availability = { ok: false, error: String(e) };
      }

      try {
        // Route MLB to the new anchor scorer; NBA/WNBA stay on the legacy engine.
        const scoringFn = sport === "MLB" ? "score-mlb-anchors" : "prop-scoring-engine";
        console.log(`[${sport}] Pipeline: triggering ${scoringFn}...`);
        const scoreRes = await fetch(`${fnBase}/${scoringFn}`, {
          method: "POST", headers: svcHeaders,
          body: JSON.stringify(
            sport === "MLB"
              ? { game_date: todayET }
              : { score_all_market_players: true, sport },
          ),
          signal: AbortSignal.timeout(60_000),
        });
        const scoreBody = await scoreRes.json();
        pipelineResults.scoring = {
          ok: !!scoreBody.ok || scoreBody.scored_count != null,
          scored_count: scoreBody.scored_count ?? scoreBody.scored ?? null,
          source: scoringFn,
        };
        console.log(`[${sport}] Pipeline: scoring done via ${scoringFn} — ${pipelineResults.scoring.scored_count} props scored`);
      } catch (e) {
        console.error(`[${sport}] Pipeline: scoring failed:`, e);
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
      odds_provider: oddsProvider,
      odds_fallback: oddsFallback,
      odds_stale: oddsStale,
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
