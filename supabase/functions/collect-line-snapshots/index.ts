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

const WNBA_TEAM_ABBRS: Record<string, string> = {
  "Atlanta Dream": "ATL", "Chicago Sky": "CHI", "Connecticut Sun": "CON",
  "Dallas Wings": "DAL", "Golden State Valkyries": "GSV", "Indiana Fever": "IND",
  "Las Vegas Aces": "LVA", "Los Angeles Sparks": "LA", "Minnesota Lynx": "MIN",
  "New York Liberty": "NYL", "Phoenix Mercury": "PHX", "Seattle Storm": "SEA",
  "Washington Mystics": "WAS",
};

const MLB_PRIMARY_ROLE_BY_MARKET: Record<string, "pitcher" | "batter"> = {
  pitcher_strikeouts: "pitcher",
  pitcher_earned_runs: "pitcher",
  pitcher_walks: "pitcher",
  pitcher_hits_allowed: "pitcher",
  batter_hits: "batter",
  batter_total_bases: "batter",
  batter_home_runs: "batter",
};

type SportKey = "NBA" | "WNBA" | "MLB";

interface SportConfig {
  oddsApiSport: string;
  teamMap: Record<string, string>;
  refreshStatusId: number;
  refreshStatusLabel: string;
  seasonState: "preseason" | "regular" | "postseason" | "offseason";
  propMarkets: string;
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
    oddsApiSport: MLB_ODDS_API_SPORT,
    teamMap: {},
    refreshStatusId: 23,
    refreshStatusLabel: "MLB_LINES",
    seasonState: "regular",
    propMarkets: [
      "batter_hits", "batter_total_bases", "batter_home_runs",
      "pitcher_strikeouts", "pitcher_earned_runs", "pitcher_walks",
      "pitcher_hits_allowed",
    ].join(","),
    statRewrite: "passthrough",
  },
};

// ─── Canonical key helpers ────────────────────────────────────────────────────

/** Build deterministic canonical key: SPORT_YYYY-MM-DD_AWAY_HOME */
function buildCanonicalKey(sport: string, gameDate: string, awayAbbr: string | null, homeAbbr: string | null): string | null {
  if (!awayAbbr || !homeAbbr) return null;
  return `${sport}_${gameDate}_${awayAbbr}_${homeAbbr}`;
}

// ─── Verification & confidence helpers ────────────────────────────────────────

interface GameCandidate {
  id: string;
  sport: string;
  game_date: string;
  home_team_abbr: string | null;
  away_team_abbr: string | null;
  game_time: string | null;
  status: string;
  commence_time_iso: string;
  source: string;
  canonical_game_key: string | null;
}

interface VerifiedGameRow {
  id: string;
  sport: string;
  game_date: string;
  home_team_abbr: string | null;
  away_team_abbr: string | null;
  game_time: string | null;
  status: string | null;
  canonical_game_key: string | null;
  source_primary: string;
  source_secondary: string | null;
  verification_status: "verified" | "unverified" | "mismatch" | "missing_secondary";
  schedule_confidence: number;
  mismatch_flags: unknown[];
  is_active: boolean;
  is_postponed: boolean;
  last_verified_at: string;
  updated_at: string;
}

/**
 * Resolve duplicates: when multiple candidates share a canonical_game_key,
 * keep the one with the most complete data; prefer h2h provider entries.
 *
 * Merge rule: winner keeps its own fields; loser contributes source_secondary.
 */
function resolveDuplicates(candidates: GameCandidate[]): Map<string, { winner: GameCandidate; dupeCount: number; mismatchFlags: string[] }> {
  const byKey = new Map<string, GameCandidate[]>();
  for (const c of candidates) {
    const key = c.canonical_game_key;
    if (!key) continue;
    const arr = byKey.get(key) || [];
    arr.push(c);
    byKey.set(key, arr);
  }

  const resolved = new Map<string, { winner: GameCandidate; dupeCount: number; mismatchFlags: string[] }>();

  for (const [key, group] of byKey.entries()) {
    const flags: string[] = [];

    if (group.length > 1) {
      flags.push(`duplicate_candidates_detected:${group.length}`);

      // Check for time disagreements
      const times = new Set(group.map(g => g.commence_time_iso));
      if (times.size > 1) flags.push("start_time_disagrees");

      // Check for team disagreements
      const homes = new Set(group.map(g => g.home_team_abbr));
      const aways = new Set(group.map(g => g.away_team_abbr));
      if (homes.size > 1) flags.push("home_team_disagrees");
      if (aways.size > 1) flags.push("away_team_disagrees");
    }

    // Winner selection:
    // 1. Prefer candidates with both team abbreviations populated
    // 2. Prefer candidates with earlier commence_time (first seen = most trusted)
    // 3. Tie-break by id (deterministic)
    const sorted = [...group].sort((a, b) => {
      const aComplete = (a.home_team_abbr && a.away_team_abbr) ? 1 : 0;
      const bComplete = (b.home_team_abbr && b.away_team_abbr) ? 1 : 0;
      if (bComplete !== aComplete) return bComplete - aComplete; // complete first
      if (a.commence_time_iso !== b.commence_time_iso) return a.commence_time_iso.localeCompare(b.commence_time_iso);
      return a.id.localeCompare(b.id);
    });

    resolved.set(key, { winner: sorted[0], dupeCount: group.length, mismatchFlags: flags });
  }

  return resolved;
}

/**
 * Assign verification_status & schedule_confidence based on available signals.
 *
 * Confidence scoring (0–100):
 *   Base 50 = came from odds API (primary source)
 *   +20 = both team abbreviations resolved
 *   +15 = game_time populated
 *   +10 = no mismatch flags
 *   +5  = status is "Scheduled" (not unknown)
 *   −20 = has duplicate_candidates_detected flag
 *   −10 = start_time_disagrees
 *   −15 = team disagrees
 */
function computeVerification(
  candidate: GameCandidate,
  mismatchFlags: string[],
  dupeCount: number,
  existingRow: { verification_status: string; source_secondary: string | null } | null,
): { verification_status: string; schedule_confidence: number; source_secondary: string | null } {
  let confidence = 50; // base: from odds API

  if (candidate.home_team_abbr && candidate.away_team_abbr) confidence += 20;
  if (candidate.game_time) confidence += 15;
  if (candidate.status === "Scheduled") confidence += 5;
  if (mismatchFlags.length === 0) confidence += 10;

  // Penalties
  if (mismatchFlags.some(f => f.startsWith("duplicate_candidates_detected"))) confidence -= 20;
  if (mismatchFlags.includes("start_time_disagrees")) confidence -= 10;
  if (mismatchFlags.includes("home_team_disagrees") || mismatchFlags.includes("away_team_disagrees")) confidence -= 15;

  confidence = Math.max(0, Math.min(100, confidence));

  // Preserve existing source_secondary if set by verify-schedule
  const sourceSecondary = existingRow?.source_secondary || null;

  let verificationStatus: string;
  if (mismatchFlags.length > 0) {
    verificationStatus = "mismatch";
  } else if (existingRow?.verification_status === "verified" && mismatchFlags.length === 0) {
    // Preserve verified status from a previous verify-schedule pass
    verificationStatus = "verified";
    confidence = Math.max(confidence, 85);
  } else {
    // Single source only — cannot claim verified; wait for verify-schedule
    verificationStatus = "unverified";
  }

  return { verification_status: verificationStatus, schedule_confidence: confidence, source_secondary: sourceSecondary };
}

/**
 * Determine is_active and is_postponed from status string.
 */
function deriveActiveFlags(status: string | null): { is_active: boolean; is_postponed: boolean } {
  const s = (status || "").toLowerCase();
  if (s.includes("postponed") || s.includes("ppd")) return { is_active: false, is_postponed: true };
  if (s.includes("cancel") || s.includes("suspended")) return { is_active: false, is_postponed: false };
  if (s.includes("final") || s.includes("completed")) return { is_active: false, is_postponed: false };
  return { is_active: true, is_postponed: false };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

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

    const reqBody = await req.json().catch(() => ({}));
    const rawSport = String(reqBody?.sport ?? "NBA").toUpperCase();
    const sport: SportKey =
      rawSport === "WNBA" ? "WNBA" : rawSport === "MLB" ? "MLB" : "NBA";
    const cfg = SPORT_CONFIG[sport];

    // Offseason short-circuit
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

    // ── 1. Fetch today's games via get-odds (game-level h2h) ──
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

    // ── 1b. Build game candidates with canonical keys ──
    const candidates: GameCandidate[] = [];
    const gameIdToDate = new Map<string, string>();
    const allGameDates = new Set<string>();

    for (const game of gamesData) {
      const commence = new Date(game.commence_time);
      const gameDate = commence.toISOString().split("T")[0];
      const homeAbbr = cfg.teamMap[game.home_team] || null;
      const awayAbbr = cfg.teamMap[game.away_team] || null;
      const gameTime = commence.toLocaleTimeString("en-US", {
        hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "America/New_York",
      });

      const canonicalKey = buildCanonicalKey(sport, gameDate, awayAbbr, homeAbbr);

      candidates.push({
        id: game.id,
        sport,
        game_date: gameDate,
        home_team_abbr: homeAbbr,
        away_team_abbr: awayAbbr,
        game_time: gameTime,
        status: "Scheduled",
        commence_time_iso: commence.toISOString(),
        source: `odds_api_${oddsProvider}`,
        canonical_game_key: canonicalKey,
      });

      gameIdToDate.set(game.id, gameDate);
      allGameDates.add(gameDate);
    }

    // ── 1c. Duplicate resolution ──
    const resolved = resolveDuplicates(candidates);
    // Also include candidates that don't have a canonical key (MLB with no team map)
    const orphanCandidates = candidates.filter(c => !c.canonical_game_key);

    // Fetch existing games_today rows for this sport + dates to preserve verification state
    const { data: existingGames } = await supabase
      .from("games_today")
      .select("id, canonical_game_key, verification_status, source_secondary, source_primary")
      .eq("sport", sport)
      .in("game_date", [...allGameDates]);

    const existingByKey = new Map<string, { verification_status: string; source_secondary: string | null }>();
    const existingById = new Map<string, { verification_status: string; source_secondary: string | null }>();
    for (const row of existingGames || []) {
      if (row.canonical_game_key) existingByKey.set(row.canonical_game_key, row);
      existingById.set(row.id, row);
    }

    // ── 1d. Build final upsert rows with all verification fields ──
    const now = new Date().toISOString();
    const gamesTodayRows: VerifiedGameRow[] = [];
    let dupesMerged = 0;

    for (const [key, { winner, dupeCount, mismatchFlags }] of resolved.entries()) {
      if (dupeCount > 1) dupesMerged += dupeCount - 1;
      const existing = existingByKey.get(key) || existingById.get(winner.id) || null;
      const { verification_status, schedule_confidence, source_secondary } = computeVerification(winner, mismatchFlags, dupeCount, existing);
      const { is_active, is_postponed } = deriveActiveFlags(winner.status);

      gamesTodayRows.push({
        id: winner.id,
        sport: winner.sport,
        game_date: winner.game_date,
        home_team_abbr: winner.home_team_abbr,
        away_team_abbr: winner.away_team_abbr,
        game_time: winner.game_time,
        status: winner.status,
        canonical_game_key: key,
        source_primary: `odds_api_${oddsProvider}`,
        source_secondary,
        verification_status,
        schedule_confidence,
        mismatch_flags: mismatchFlags.length > 0 ? mismatchFlags.map(f => ({ flag: f, detected_at: now })) : [],
        is_active,
        is_postponed,
        last_verified_at: now,
        updated_at: now,
      });
    }

    // Handle orphan candidates (no canonical key — e.g. MLB without team map)
    for (const c of orphanCandidates) {
      const existing = existingById.get(c.id) || null;
      const flags = ["missing_team_abbreviations"];
      const { verification_status, schedule_confidence, source_secondary } = computeVerification(c, flags, 1, existing);
      const { is_active, is_postponed } = deriveActiveFlags(c.status);

      gamesTodayRows.push({
        id: c.id,
        sport: c.sport,
        game_date: c.game_date,
        home_team_abbr: c.home_team_abbr,
        away_team_abbr: c.away_team_abbr,
        game_time: c.game_time,
        status: c.status,
        canonical_game_key: null,
        source_primary: `odds_api_${oddsProvider}`,
        source_secondary,
        verification_status,
        schedule_confidence: Math.min(schedule_confidence, 40), // cap for orphans
        mismatch_flags: flags.map(f => ({ flag: f, detected_at: now })),
        is_active,
        is_postponed,
        last_verified_at: now,
        updated_at: now,
      });
    }

    if (gamesTodayRows.length > 0) {
      const { error: gtErr } = await supabase
        .from("games_today")
        .upsert(gamesTodayRows as any[], { onConflict: "id" });
      if (gtErr) console.error("games_today upsert error:", gtErr);
      else console.log(`Upserted ${gamesTodayRows.length} games_today rows (${dupesMerged} dupes merged)`);
    }

    console.log(`Game dates: ${[...allGameDates].sort().join(", ")}`);

    // ── 2. Fetch existing snapshots for deduplication ──
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

    // ── 3. Fetch player props for up to 5 games via get-odds ──
    const newRows: any[] = [];
    let skippedDupes = 0;
    let gamesProcessed = 0;
    let mlbResolvedPlayers = 0;
    let mlbUnresolvedPlayers = 0;
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
          let statType: string | null;
          if (cfg.statRewrite === "passthrough") {
            statType = MLB_ODDS_API_MARKETS.includes(entry.marketKey) ? entry.marketKey : null;
          } else {
            statType = cfg.statRewrite[entry.marketKey] ?? null;
          }
          if (!statType) continue;

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

            let playerId: number | null = null;
            if (sport === "MLB") {
              const primaryRole = MLB_PRIMARY_ROLE_BY_MARKET[statType] ?? null;
              const teamAbbr = null;

              try {
                const { data: resolutionRows, error: resolutionError } = await supabase.rpc(
                  "resolve_mlb_player_for_odds",
                  {
                    p_raw_name: prop.player,
                    p_team_abbr: teamAbbr,
                    p_market_key: statType,
                    p_sportsbook: entry.bookmakerKey,
                    p_event_id: game.id,
                    p_primary_role: primaryRole ?? undefined,
                  },
                );

                if (resolutionError) {
                  console.error(
                    `[MLB] resolve_mlb_player_for_odds failed for ${prop.player} (${statType}, ${entry.bookmakerKey}, ${game.id}):`,
                    resolutionError,
                  );
                  mlbUnresolvedPlayers++;
                } else {
                  const resolved = Array.isArray(resolutionRows) ? resolutionRows[0] : null;
                  if (resolved && typeof resolved.player_id === "number" && Number.isFinite(resolved.player_id)) {
                    playerId = resolved.player_id;
                    mlbResolvedPlayers++;
                  } else {
                    mlbUnresolvedPlayers++;
                  }
                }
              } catch (resolutionErr) {
                console.error(
                  `[MLB] resolver exception for ${prop.player} (${statType}, ${entry.bookmakerKey}, ${game.id}):`,
                  resolutionErr,
                );
                mlbUnresolvedPlayers++;
              }
            }

            newRows.push({
              player_id: playerId,
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

    // ── 4. Insert new snapshots in batches ──
    let insertErrors = 0;
    for (let i = 0; i < newRows.length; i += 200) {
      const batch = newRows.slice(i, i + 200);
      const { error } = await supabase.from("line_snapshots").insert(batch);
      if (error) {
        console.error(`Insert error batch ${i}:`, error);
        insertErrors++;
      }
    }

    // ── 5. Update refresh_status ──
    await supabase.from("refresh_status").upsert(
      { id: cfg.refreshStatusId, sport: cfg.refreshStatusLabel, last_run: new Date().toISOString() },
      { onConflict: "id" }
    );

    // ── 6. Count total snapshots ──
    const { count: totalToday } = await supabase
      .from("line_snapshots")
      .select("id", { count: "exact", head: true })
      .in("game_date", [...allGameDates]);

    const dateCounts: Record<string, number> = {};
    for (const row of newRows) {
      dateCounts[row.game_date] = (dateCounts[row.game_date] || 0) + 1;
    }

    // ── 7. Chain pipeline ──
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

    // Verification summary for response
    const verificationSummary = {
      total_rows: gamesTodayRows.length,
      dupes_merged: dupesMerged,
      by_status: {
        verified: gamesTodayRows.filter(r => r.verification_status === "verified").length,
        unverified: gamesTodayRows.filter(r => r.verification_status === "unverified").length,
        mismatch: gamesTodayRows.filter(r => r.verification_status === "mismatch").length,
        missing_secondary: gamesTodayRows.filter(r => r.verification_status === "missing_secondary").length,
      },
    };

    const result = {
      ok: insertErrors === 0,
      game_dates: [...allGameDates].sort(),
      games_processed: gamesProcessed,
      new_snapshots: newRows.length,
      new_by_date: dateCounts,
      skipped_dupes: skippedDupes,
      total_across_dates: totalToday || 0,
      mlb_resolved_players: mlbResolvedPlayers,
      mlb_unresolved_players: mlbUnresolvedPlayers,
      odds_provider: oddsProvider,
      odds_fallback: oddsFallback,
      odds_stale: oddsStale,
      verification: verificationSummary,
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
