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

const MLB_TEAM_ABBRS: Record<string, string> = {
  "ARIZONA DIAMONDBACKS": "ARI",
  "DIAMONDBACKS": "ARI",
  "D-BACKS": "ARI",
  "DBACKS": "ARI",
  "ARIZONA": "ARI",
  "ATLANTA BRAVES": "ATL",
  "BRAVES": "ATL",
  "ATLANTA": "ATL",
  "BALTIMORE ORIOLES": "BAL",
  "ORIOLES": "BAL",
  "BALTIMORE": "BAL",
  "BOSTON RED SOX": "BOS",
  "RED SOX": "BOS",
  "BOSTON": "BOS",
  "CHICAGO CUBS": "CHC",
  "CUBS": "CHC",
  "CHICAGO WHITE SOX": "CWS",
  "WHITE SOX": "CWS",
  "SOX": "CWS",
  "CINCINNATI REDS": "CIN",
  "REDS": "CIN",
  "CINCINNATI": "CIN",
  "CLEVELAND GUARDIANS": "CLE",
  "GUARDIANS": "CLE",
  "CLEVELAND": "CLE",
  "COLORADO ROCKIES": "COL",
  "ROCKIES": "COL",
  "COLORADO": "COL",
  "DETROIT TIGERS": "DET",
  "TIGERS": "DET",
  "DETROIT": "DET",
  "HOUSTON ASTROS": "HOU",
  "ASTROS": "HOU",
  "HOUSTON": "HOU",
  "KANSAS CITY ROYALS": "KC",
  "ROYALS": "KC",
  "KANSAS CITY": "KC",
  "LOS ANGELES ANGELS": "LAA",
  "LA ANGELS": "LAA",
  "ANGELS": "LAA",
  "LOS ANGELES DODGERS": "LAD",
  "LA DODGERS": "LAD",
  "DODGERS": "LAD",
  "MIAMI MARLINS": "MIA",
  "MARLINS": "MIA",
  "MIAMI": "MIA",
  "MILWAUKEE BREWERS": "MIL",
  "BREWERS": "MIL",
  "MILWAUKEE": "MIL",
  "MINNESOTA TWINS": "MIN",
  "TWINS": "MIN",
  "MINNESOTA": "MIN",
  "NEW YORK METS": "NYM",
  "METS": "NYM",
  "NEW YORK YANKEES": "NYY",
  "YANKEES": "NYY",
  "ATHLETICS": "ATH",
  "OAKLAND ATHLETICS": "ATH",
  "SACRAMENTO ATHLETICS": "ATH",
  "A'S": "ATH",
  "AS": "ATH",
  "PHILADELPHIA PHILLIES": "PHI",
  "PHILLIES": "PHI",
  "PHILADELPHIA": "PHI",
  "PITTSBURGH PIRATES": "PIT",
  "PIRATES": "PIT",
  "PITTSBURGH": "PIT",
  "SAN DIEGO PADRES": "SD",
  "PADRES": "SD",
  "SAN DIEGO": "SD",
  "SAN FRANCISCO GIANTS": "SF",
  "GIANTS": "SF",
  "SAN FRANCISCO": "SF",
  "SEATTLE MARINERS": "SEA",
  "MARINERS": "SEA",
  "SEATTLE": "SEA",
  "ST. LOUIS CARDINALS": "STL",
  "ST LOUIS CARDINALS": "STL",
  "CARDINALS": "STL",
  "ST. LOUIS": "STL",
  "ST LOUIS": "STL",
  "TAMPA BAY RAYS": "TB",
  "RAYS": "TB",
  "TAMPA BAY": "TB",
  "TEXAS RANGERS": "TEX",
  "RANGERS": "TEX",
  "TEXAS": "TEX",
  "TORONTO BLUE JAYS": "TOR",
  "BLUE JAYS": "TOR",
  "TORONTO": "TOR",
  "WASHINGTON NATIONALS": "WSH",
  "NATIONALS": "WSH",
  "WASHINGTON": "WSH",
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

const NBA_PROP_MARKETS = "player_points,player_rebounds,player_assists,player_threes,player_blocks,player_steals";
const NBA_STAT_REWRITE: Record<string, string> = {
  player_points: "Points",
  player_rebounds: "Rebounds",
  player_assists: "Assists",
  player_threes: "3-Pointers",
  player_blocks: "Blocks",
  player_steals: "Steals",
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
    teamMap: MLB_TEAM_ABBRS,
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

interface ManualGameInput {
  away_team_abbr?: string;
  home_team_abbr?: string;
  game_time?: string;
  status?: string;
}

interface EspnSlateGame {
  id: string;
  home_team_abbr: string | null;
  away_team_abbr: string | null;
  game_time: string | null;
  status: string;
  canonical_game_key: string | null;
  commence_time_iso: string;
}

function easternDateString(date = new Date()): string {
  return date.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function compactDateString(isoDate: string): string {
  return isoDate.replace(/-/g, "");
}

function teamPairKey(awayAbbr: string | null, homeAbbr: string | null): string | null {
  if (!awayAbbr || !homeAbbr) return null;
  return `${awayAbbr}_${homeAbbr}`;
}

function resolveBasketballTeamAbbr(raw: string | null | undefined, teamMap: Record<string, string>): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const upper = value.toUpperCase();
  const direct = teamMap[value] || teamMap[upper] || null;
  if (direct) return direct;
  if (["ATL","BOS","BKN","CHA","CHI","CLE","DAL","DEN","DET","GSW","HOU","IND","LAC","LAL","MEM","MIA","MIL","MIN","NOP","NYK","OKC","ORL","PHI","PHX","POR","SAC","SAS","TOR","UTA","WAS"].includes(upper)) {
    return upper;
  }
  if (upper === "SA") return "SAS";
  if (upper === "GS") return "GSW";
  if (upper === "NO") return "NOP";
  if (upper === "NY") return "NYK";
  if (upper === "PHO") return "PHX";
  const lastWord = upper.split(" ").pop() || upper;
  const nicknameMap: Record<string, string> = {
    HAWKS: "ATL", CELTICS: "BOS", NETS: "BKN", HORNETS: "CHA", BULLS: "CHI", CAVALIERS: "CLE",
    MAVERICKS: "DAL", NUGGETS: "DEN", PISTONS: "DET", WARRIORS: "GSW", ROCKETS: "HOU", PACERS: "IND",
    CLIPPERS: "LAC", LAKERS: "LAL", GRIZZLIES: "MEM", HEAT: "MIA", BUCKS: "MIL", TIMBERWOLVES: "MIN",
    PELICANS: "NOP", KNICKS: "NYK", THUNDER: "OKC", MAGIC: "ORL", "76ERS": "PHI", SIXERS: "PHI",
    SUNS: "PHX", BLAZERS: "POR", KINGS: "SAC", SPURS: "SAS", RAPTORS: "TOR", JAZZ: "UTA", WIZARDS: "WAS",
  };
  return nicknameMap[lastWord] || null;
}

function normalizeMlbTeamKey(raw: string | null | undefined): string {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[.'’]/g, "")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ");
}

function resolveMlbTeamAbbr(raw: string | null | undefined, teamMap: Record<string, string>): string | null {
  const normalized = normalizeMlbTeamKey(raw);
  if (!normalized) return null;
  if (teamMap[normalized]) return teamMap[normalized];
  const lastWord = normalized.split(" ").pop() || normalized;
  if (teamMap[lastWord]) return teamMap[lastWord];
  if (normalized.includes("WHITE SOX")) return "CWS";
  if (normalized.includes("RED SOX")) return "BOS";
  if (normalized.includes("DIAMONDBACK")) return "ARI";
  if (normalized.includes("D BACK")) return "ARI";
  if (normalized.includes("ATHLETIC")) return "ATH";
  if (normalized.includes("YANKEE")) return "NYY";
  if (normalized.includes("DODGER")) return "LAD";
  if (normalized.includes("ANGEL")) return "LAA";
  if (normalized.includes("CUB")) return "CHC";
  if (normalized.includes("MET")) return "NYM";
  return null;
}

function chooseOddsGameForSlateDate(
  games: any[] | undefined,
  requestedGameDate: string,
): any | null {
  if (!games || games.length === 0) return null;
  const exact = games.find((game) => {
    if (!game?.commence_time) return false;
    return easternDateString(new Date(game.commence_time)) === requestedGameDate;
  });
  return exact ?? games[0] ?? null;
}

function rankOddsGamesForSlateDate(
  games: any[] | undefined,
  requestedGameDate: string,
): any[] {
  if (!games || games.length === 0) return [];
  const requestedTs = new Date(`${requestedGameDate}T12:00:00-04:00`).getTime();
  return [...games].sort((a, b) => {
    const aDate = a?.commence_time ? easternDateString(new Date(a.commence_time)) : "";
    const bDate = b?.commence_time ? easternDateString(new Date(b.commence_time)) : "";
    const aExact = aDate === requestedGameDate ? 0 : 1;
    const bExact = bDate === requestedGameDate ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    const aTs = a?.commence_time ? new Date(a.commence_time).getTime() : requestedTs;
    const bTs = b?.commence_time ? new Date(b.commence_time).getTime() : requestedTs;
    return Math.abs(aTs - requestedTs) - Math.abs(bTs - requestedTs);
  });
}

function normalizeEspnTeamAbbr(raw: string | null | undefined): string | null {
  const abbr = String(raw ?? "").trim().toUpperCase();
  if (!abbr) return null;
  if (abbr === "SA") return "SAS";
  if (abbr === "GS") return "GSW";
  if (abbr === "NO") return "NOP";
  if (abbr === "NY") return "NYK";
  if (abbr === "PHO") return "PHX";
  return abbr;
}

function buildTheOddsApiUrlShape(
  sport: string,
  eventId: string,
  marketParam: string,
  bookmakers = "draftkings,fanduel,betmgm,pointsbetus",
): string {
  return `https://api.the-odds-api.com/v4/sports/${sport}/events/${eventId}/odds?regions=us&markets=${marketParam}&oddsFormat=american&bookmakers=${bookmakers}&apiKey=***`;
}

function summarizeOddsApiResponseBody(body: any): {
  response_body_sample_keys: string[];
  bookmakers_count: number;
  markets_returned: string[];
  outcomes_count_by_market: Record<string, number>;
  first_bookmaker_title: string | null;
  first_market_key: string | null;
  first_outcome_sample: Record<string, unknown> | null;
} {
  const responseBodySampleKeys = body && typeof body === "object" && !Array.isArray(body)
    ? Object.keys(body).slice(0, 20)
    : [];

  const events = Array.isArray(body) ? body : body ? [body] : [];
  const marketsReturned = new Set<string>();
  const outcomesCountByMarket: Record<string, number> = {};
  let bookmakersCount = 0;
  let firstBookmakerTitle: string | null = null;
  let firstMarketKey: string | null = null;
  let firstOutcomeSample: Record<string, unknown> | null = null;

  for (const event of events) {
    for (const bookmaker of event?.bookmakers || []) {
      bookmakersCount++;
      if (!firstBookmakerTitle) {
        firstBookmakerTitle = String(bookmaker?.title ?? bookmaker?.key ?? "");
      }
      for (const market of bookmaker?.markets || []) {
        const marketKey = String(market?.key ?? "");
        if (!marketKey) continue;
        marketsReturned.add(marketKey);
        const outcomes = Array.isArray(market?.outcomes) ? market.outcomes : [];
        outcomesCountByMarket[marketKey] = (outcomesCountByMarket[marketKey] || 0) + outcomes.length;
        if (!firstMarketKey) firstMarketKey = marketKey;
        if (!firstOutcomeSample && outcomes.length > 0) {
          const firstOutcome = outcomes[0];
          firstOutcomeSample = {
            player: firstOutcome?.description ?? null,
            description: firstOutcome?.description ?? null,
            name: firstOutcome?.name ?? null,
            price: firstOutcome?.price ?? null,
            point: firstOutcome?.point ?? null,
          };
        }
      }
    }
  }

  return {
    response_body_sample_keys: responseBodySampleKeys,
    bookmakers_count: bookmakersCount,
    markets_returned: [...marketsReturned],
    outcomes_count_by_market: outcomesCountByMarket,
    first_bookmaker_title: firstBookmakerTitle,
    first_market_key: firstMarketKey,
    first_outcome_sample: firstOutcomeSample,
  };
}

async function fetchTheOddsApiEventDiagnostic(
  sport: string,
  eventId: string,
  marketParam: string,
): Promise<Record<string, unknown>> {
  const apiKey = Deno.env.get("ODDS_API_KEY");
  if (!apiKey) {
    return {
      provider_url_shape: buildTheOddsApiUrlShape(sport, eventId, marketParam),
      http_status: null,
      error_code: "ODDS_API_KEY_MISSING",
    };
  }

  const url = buildTheOddsApiUrlShape(sport, eventId, marketParam).replace("***", apiKey);
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const rawText = await response.text().catch(() => "");
  let parsedBody: any = null;
  try {
    parsedBody = rawText ? JSON.parse(rawText) : null;
  } catch {
    parsedBody = null;
  }

  return {
    provider_url_shape: buildTheOddsApiUrlShape(sport, eventId, marketParam),
    http_status: response.status,
    ...summarizeOddsApiResponseBody(parsedBody),
    raw_response_error_body_sample: response.ok
      ? null
      : (typeof parsedBody === "object" && parsedBody !== null
          ? JSON.stringify(parsedBody).slice(0, 400)
          : rawText.slice(0, 400)),
  };
}

async function fetchEspnNbaSlate(gameDate: string): Promise<EspnSlateGame[]> {
  const url =
    `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${compactDateString(gameDate)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ESPN scoreboard ${res.status}: ${body.slice(0, 300)}`);
  }

  const payload = await res.json();
  const events = Array.isArray(payload?.events) ? payload.events : [];
  const slate: EspnSlateGame[] = [];

  for (const event of events) {
    const competition = Array.isArray(event?.competitions) ? event.competitions[0] : null;
    const competitors = Array.isArray(competition?.competitors) ? competition.competitors : [];
    const home = competitors.find((c: any) => String(c?.homeAway ?? "").toLowerCase() === "home");
    const away = competitors.find((c: any) => String(c?.homeAway ?? "").toLowerCase() === "away");
    const homeAbbr = normalizeEspnTeamAbbr(home?.team?.abbreviation);
    const awayAbbr = normalizeEspnTeamAbbr(away?.team?.abbreviation);
    const eventDate = String(event?.date ?? "").trim();
    const commence = eventDate ? new Date(eventDate) : null;
    const gameTime = commence && !Number.isNaN(commence.getTime())
      ? commence.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
        timeZone: "America/New_York",
      })
      : null;
    const status =
      String(competition?.status?.type?.description ?? competition?.status?.type?.name ?? event?.status?.type?.description ?? "Scheduled");

    slate.push({
      id: String(event?.id ?? `espn_${gameDate}_${awayAbbr}_${homeAbbr}`),
      home_team_abbr: homeAbbr,
      away_team_abbr: awayAbbr,
      game_time: gameTime,
      status,
      canonical_game_key: buildCanonicalKey("NBA", gameDate, awayAbbr, homeAbbr),
      commence_time_iso: commence && !Number.isNaN(commence.getTime())
        ? commence.toISOString()
        : `${gameDate}T00:00:00.000Z`,
    });
  }

  return slate;
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
    const requestedGameDate = typeof reqBody?.game_date === "string" && reqBody.game_date.trim().length > 0
      ? reqBody.game_date.trim()
      : easternDateString();
    const manualGames = Array.isArray(reqBody?.manual_games) ? reqBody.manual_games as ManualGameInput[] : [];
    const replaceSlate = reqBody?.replace_slate === true || (sport === "NBA" && manualGames.length === 0);
    const diagnoseProps = reqBody?.diagnose_props === true;

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

    const todayStr = requestedGameDate;
    console.log(`[${sport}] Collecting line snapshots for ${todayStr}... manualGames=${manualGames.length}`);

    // ── 1. Fetch today's games via get-odds (game-level h2h) ──
    let gamesOddsResponse: any;
    let sourceGamesFetchedCount = 0;
    let normalizedGamesCount = 0;
    let activeGamesCount = 0;
    const skippedGames: Array<{ reason: string; game?: string | null; raw_home_team?: string | null; raw_away_team?: string | null }> = [];
    const canonicalKeys: string[] = [];
    const mlbTeamMappingMissingNames = new Set<string>();
    let espnGamesFetchedCount = 0;
    const espnCanonicalKeys: string[] = [];
    const oddsCanonicalKeys: string[] = [];
    const matchedKeys: string[] = [];
    const missingFromOddsKeys: string[] = [];
    const staleDeactivatedKeys: string[] = [];
    let scheduleSourceUsed = "odds_provider";
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
    sourceGamesFetchedCount = oddsData.length;

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

    const oddsByTeamPair = new Map<string, any[]>();
    for (const game of gamesData) {
      const homeAbbr = sport === "NBA" || sport === "WNBA"
        ? resolveBasketballTeamAbbr(game.home_team, cfg.teamMap)
        : resolveMlbTeamAbbr(game.home_team, cfg.teamMap);
      const awayAbbr = sport === "NBA" || sport === "WNBA"
        ? resolveBasketballTeamAbbr(game.away_team, cfg.teamMap)
        : resolveMlbTeamAbbr(game.away_team, cfg.teamMap);
      const pairKey = teamPairKey(awayAbbr, homeAbbr);
      if (pairKey) {
        if (!oddsByTeamPair.has(pairKey)) oddsByTeamPair.set(pairKey, []);
        oddsByTeamPair.get(pairKey)!.push(game);
      }
      const oddsGameDate = game.commence_time
        ? easternDateString(new Date(game.commence_time))
        : requestedGameDate;
      const oddsCanonicalKey = buildCanonicalKey(sport, oddsGameDate, awayAbbr, homeAbbr);
      if (oddsCanonicalKey) oddsCanonicalKeys.push(oddsCanonicalKey);
    }

    let espnSlateGames: EspnSlateGame[] = [];
    if (sport === "NBA" && manualGames.length === 0) {
      try {
        espnSlateGames = await fetchEspnNbaSlate(requestedGameDate);
        espnGamesFetchedCount = espnSlateGames.length;
        for (const row of espnSlateGames) {
          if (row.canonical_game_key) espnCanonicalKeys.push(row.canonical_game_key);
        }
        if (espnSlateGames.length > 0) scheduleSourceUsed = "espn_scoreboard";
        console.log(`[${sport}] ESPN scoreboard returned ${espnSlateGames.length} games for ${requestedGameDate}`);
      } catch (e) {
        console.error(`[${sport}] ESPN scoreboard fetch failed:`, e);
      }
    }

    if (manualGames.length > 0) {
      console.warn(`[${sport}] Applying manual emergency slate for ${todayStr} with ${manualGames.length} games`);
      scheduleSourceUsed = "manual_emergency";
      for (const game of manualGames) {
        const awayAbbr = String(game.away_team_abbr ?? "").trim().toUpperCase() || null;
        const homeAbbr = String(game.home_team_abbr ?? "").trim().toUpperCase() || null;
        if (!awayAbbr || !homeAbbr) {
          skippedGames.push({
            reason: "manual_missing_team_abbr",
            raw_home_team: homeAbbr,
            raw_away_team: awayAbbr,
          });
          continue;
        }
        const manualId = `manual_${sport}_${todayStr}_${awayAbbr}_${homeAbbr}`;
        const existingIndex = gamesData.findIndex((g) => g.id === manualId);
        const manualGame = {
          id: manualId,
          home_team: homeAbbr,
          away_team: awayAbbr,
          commence_time: `${todayStr}T${String(game.game_time ?? "12:00 PM")}`,
          manual: true,
          manual_source: "emergency_manual",
          manual_status: String(game.status ?? "Scheduled"),
          manual_game_time: String(game.game_time ?? "12:00 PM"),
        };
        if (existingIndex >= 0) gamesData[existingIndex] = manualGame;
        else gamesData.push(manualGame);
      }
    }

    const scheduleSeedCount =
      sport === "NBA" && manualGames.length === 0 && espnSlateGames.length > 0
        ? espnSlateGames.length
        : gamesData.length;

    if (scheduleSeedCount === 0) {
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
    if (sport === "NBA" && manualGames.length === 0 && espnSlateGames.length > 0) {
      for (const game of espnSlateGames) {
        if (!game.home_team_abbr || !game.away_team_abbr) {
          skippedGames.push({
            reason: "espn_missing_team_abbreviation",
            game: game.id,
          });
          continue;
        }
        const pairKey = teamPairKey(game.away_team_abbr, game.home_team_abbr);
        const matchedOddsGame = pairKey ? chooseOddsGameForSlateDate(oddsByTeamPair.get(pairKey), requestedGameDate) : null;
        if (matchedOddsGame && game.canonical_game_key) matchedKeys.push(game.canonical_game_key);
        if (!matchedOddsGame && game.canonical_game_key) missingFromOddsKeys.push(game.canonical_game_key);
        if (game.canonical_game_key) canonicalKeys.push(game.canonical_game_key);

        candidates.push({
          id: `espn_${game.id}`,
          sport,
          game_date: todayStr,
          home_team_abbr: game.home_team_abbr,
          away_team_abbr: game.away_team_abbr,
          game_time: game.game_time,
          status: game.status,
          commence_time_iso: game.commence_time_iso,
          source: "espn_scoreboard",
          canonical_game_key: game.canonical_game_key,
        });

        gameIdToDate.set(`espn_${game.id}`, todayStr);
        allGameDates.add(todayStr);
      }
    } else {
      for (const game of gamesData) {
        const isManualGame = game.manual === true;
        const commence = isManualGame ? null : new Date(game.commence_time);
        const gameDate = isManualGame ? todayStr : commence?.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
        const homeAbbr = isManualGame
          ? String(game.home_team ?? "").trim().toUpperCase() || null
          : sport === "NBA" || sport === "WNBA"
          ? resolveBasketballTeamAbbr(game.home_team, cfg.teamMap)
          : resolveMlbTeamAbbr(game.home_team, cfg.teamMap);
        const awayAbbr = isManualGame
          ? String(game.away_team ?? "").trim().toUpperCase() || null
          : sport === "NBA" || sport === "WNBA"
          ? resolveBasketballTeamAbbr(game.away_team, cfg.teamMap)
          : resolveMlbTeamAbbr(game.away_team, cfg.teamMap);
        const gameTime = isManualGame
          ? (String(game.manual_game_time ?? "").trim() || null)
          : commence?.toLocaleTimeString("en-US", {
            hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "America/New_York",
          }) ?? null;

        if (!gameDate) {
          skippedGames.push({
            reason: "missing_game_date",
            game: game.id,
            raw_home_team: game.home_team ?? null,
            raw_away_team: game.away_team ?? null,
          });
          continue;
        }

        if (gameDate !== todayStr) {
          skippedGames.push({
            reason: "outside_requested_game_date",
            game: game.id,
            raw_home_team: game.home_team ?? null,
            raw_away_team: game.away_team ?? null,
          });
          continue;
        }

        if (!homeAbbr || !awayAbbr) {
          if (sport === "MLB") {
            if (!homeAbbr && game.home_team) mlbTeamMappingMissingNames.add(String(game.home_team));
            if (!awayAbbr && game.away_team) mlbTeamMappingMissingNames.add(String(game.away_team));
          }
          skippedGames.push({
            reason: "missing_team_abbreviation_mapping",
            game: game.id,
            raw_home_team: game.home_team ?? null,
            raw_away_team: game.away_team ?? null,
          });
        }

        const canonicalKey = buildCanonicalKey(sport, gameDate, awayAbbr, homeAbbr);
        if (canonicalKey) canonicalKeys.push(canonicalKey);

        candidates.push({
          id: game.id,
          sport,
          game_date: gameDate,
          home_team_abbr: homeAbbr,
          away_team_abbr: awayAbbr,
          game_time: gameTime,
          status: isManualGame ? String(game.manual_status ?? "Scheduled") : "Scheduled",
          commence_time_iso: isManualGame ? `${todayStr}T00:00:00.000Z` : commence.toISOString(),
          source: isManualGame ? "manual_emergency" : `odds_api_${oddsProvider}`,
          canonical_game_key: canonicalKey,
        });

        gameIdToDate.set(game.id, gameDate);
        allGameDates.add(gameDate);
      }
    }
    normalizedGamesCount = candidates.length;

    const nbaPropTargets = sport === "NBA" && scheduleSourceUsed === "espn_scoreboard"
      ? candidates.map((candidate) => {
          const pairKey = teamPairKey(candidate.away_team_abbr, candidate.home_team_abbr);
          return {
            candidate,
            oddsEvents: pairKey ? rankOddsGamesForSlateDate(oddsByTeamPair.get(pairKey), requestedGameDate) : [],
          };
        })
      : [];

    const propSourceGames = sport === "NBA" && scheduleSourceUsed === "espn_scoreboard"
      ? nbaPropTargets.flatMap((target) => target.oddsEvents)
      : gamesData;

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

    const existingByKey = new Map<string, { id: string; verification_status: string; source_secondary: string | null }>();
    const existingById = new Map<string, { id: string; verification_status: string; source_secondary: string | null }>();
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
      let { verification_status, schedule_confidence, source_secondary } = computeVerification(winner, mismatchFlags, dupeCount, existing);
      const pairKey = teamPairKey(winner.away_team_abbr, winner.home_team_abbr);
      const oddsMatched = pairKey ? oddsByTeamPair.has(pairKey) : false;
      if (winner.source === "espn_scoreboard") {
        verification_status = oddsMatched ? "verified" : "missing_secondary";
        schedule_confidence = oddsMatched ? 95 : 80;
        source_secondary = oddsMatched ? "odds_provider" : null;
      } else if (winner.source === "manual_emergency") {
        source_secondary = oddsMatched ? "odds_provider" : source_secondary;
      }
      const { is_active, is_postponed } = deriveActiveFlags(winner.status);

      gamesTodayRows.push({
        id: existing?.id ?? winner.id,
        sport: winner.sport,
        game_date: winner.game_date,
        home_team_abbr: winner.home_team_abbr,
        away_team_abbr: winner.away_team_abbr,
        game_time: winner.game_time,
        status: winner.status,
        canonical_game_key: key,
        source_primary:
          winner.source === "manual_emergency"
            ? "manual_emergency"
            : winner.source === "espn_scoreboard"
            ? "espn_scoreboard"
            : `odds_api_${oddsProvider}`,
        source_secondary,
        verification_status,
        schedule_confidence:
          winner.source === "manual_emergency" ? Math.min(schedule_confidence, 35) : schedule_confidence,
        mismatch_flags: [
          ...(mismatchFlags.length > 0 ? mismatchFlags.map(f => ({ flag: f, detected_at: now })) : []),
          ...(winner.source === "manual_emergency"
            ? [{ flag: "manual_emergency_source", detected_at: now }]
            : winner.source === "espn_scoreboard"
            ? [{ flag: "espn_primary_schedule_source", detected_at: now }]
            : []),
        ],
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
        id: existing?.id ?? c.id,
        sport: c.sport,
        game_date: c.game_date,
        home_team_abbr: c.home_team_abbr,
        away_team_abbr: c.away_team_abbr,
        game_time: c.game_time,
        status: c.status,
        canonical_game_key: null,
        source_primary: c.source === "manual_emergency" ? "manual_emergency" : `odds_api_${oddsProvider}`,
        source_secondary,
        verification_status,
        schedule_confidence: Math.min(schedule_confidence, 40), // cap for orphans
        mismatch_flags: [
          ...flags.map(f => ({ flag: f, detected_at: now })),
          ...(c.source === "manual_emergency"
            ? [{ flag: "manual_emergency_source", detected_at: now }]
            : []),
        ],
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

    if (sport === "NBA" && replaceSlate) {
      const slateKeys = new Set(gamesTodayRows.map((row) => row.canonical_game_key).filter(Boolean));
      const { data: existingSlateRows } = await supabase
        .from("games_today")
        .select("id, canonical_game_key")
        .eq("sport", sport)
        .eq("game_date", todayStr)
        .eq("is_active", true);

      const staleIds = (existingSlateRows ?? [])
        .filter((row) => row.canonical_game_key && !slateKeys.has(row.canonical_game_key))
        .map((row) => ({ id: row.id, canonical_game_key: row.canonical_game_key as string }));

      for (const row of staleIds) staleDeactivatedKeys.push(row.canonical_game_key);

      for (let i = 0; i < staleIds.length; i += 100) {
        const slice = staleIds.slice(i, i + 100);
        if (slice.length === 0) continue;
        const { error } = await supabase
          .from("games_today")
          .update({
            is_active: false,
            is_postponed: false,
            status: "Deactivated",
            updated_at: now,
          })
          .in("id", slice.map((row) => row.id));
        if (error) console.error(`[${sport}] stale slate deactivation error:`, error);
      }
    }

    activeGamesCount = gamesTodayRows.filter((r) => r.is_active).length;

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
    let gamesAttempted = 0;
    let gamesWithProps = 0;
    let gamesWithoutProps = 0;
    let marketsAttempted = 0;
    const matchedProviderEventsByGame: Record<string, string[]> = {};
    const providerEventIdsAttempted: string[] = [];
    const marketsAttemptedByEvent: Record<string, string[]> = {};
    const providerStatusByEventMarket: Record<string, string> = {};
    const bookmakerCountByEventMarket: Record<string, number> = {};
    const providerDiagnosticsByEvent: Record<string, Record<string, unknown>> = {};
    const snapshotsWrittenByGame: Record<string, number> = {};
    const snapshotsWrittenByStatType: Record<string, number> = {};
    const providerErrorsByGame: Record<string, string[]> = {};
    let providerUnavailableReason: string | null = null;
    let mlbResolvedPlayers = 0;
    let mlbUnresolvedPlayers = 0;
    const propMarkets = cfg.propMarkets;
    const propMarketList = propMarkets.split(",").map((m) => m.trim()).filter(Boolean);

    const fetchTargets = sport === "NBA" && scheduleSourceUsed === "espn_scoreboard"
      ? nbaPropTargets.slice(0, 5).map((target) => ({
          gameDate: target.candidate.game_date || todayStr,
          targetKey: target.candidate.canonical_game_key || `${target.candidate.away_team_abbr}_${target.candidate.home_team_abbr}`,
          oddsEvents: target.oddsEvents,
          status: target.candidate.status,
          commence_time_iso: target.candidate.commence_time_iso,
        }))
      : propSourceGames.map((game) => ({
          gameDate: gameIdToDate.get(game.id) || todayStr,
          targetKey: String(game.id),
          oddsEvents: [game],
          status: "Scheduled",
          commence_time_iso: game?.commence_time || null,
        }));

    for (const target of fetchTargets) {
      gamesAttempted++;
      let wroteAnyForTarget = false;
      let sawPropsPayload = false;
      matchedProviderEventsByGame[target.targetKey] = target.oddsEvents.map((g: any) => String(g.id));

      for (const game of target.oddsEvents) {
        if (String(game.id).startsWith("manual_")) {
          console.log(`[${sport}] Skipping prop fetch for manual game ${game.id}`);
          continue;
        }
        const gameDate = target.gameDate;
        try {
          providerEventIdsAttempted.push(String(game.id));
          const marketRequests =
            (sport === "NBA" || sport === "WNBA")
              ? [propMarkets, ...propMarketList]
              : [propMarkets];
          marketsAttemptedByEvent[String(game.id)] = [];

          for (const marketRequest of marketRequests) {
            const requestedMarkets = marketRequest.split(",").map((m) => m.trim()).filter(Boolean);
            marketsAttempted += requestedMarkets.length;
            marketsAttemptedByEvent[String(game.id)].push(marketRequest);

            if (diagnoseProps) {
              providerDiagnosticsByEvent[`${game.id}:${marketRequest}`] =
                await fetchTheOddsApiEventDiagnostic(cfg.oddsApiSport, String(game.id), marketRequest);
            }

            const propsRes = await fetch(`${fnBase}/get-odds`, {
              method: "POST",
              headers: svcHeaders,
              body: JSON.stringify({
                sport: cfg.oddsApiSport,
                market: marketRequest,
                eventId: game.id,
                ttl: 120,
              }),
              signal: AbortSignal.timeout(30_000),
            });
            const propsResponse = await propsRes.json();
            const propsData = propsResponse.data || [];
            const statusKey = `${game.id}:${marketRequest}`;

            if (!propsResponse.ok && propsData.length === 0) {
              providerStatusByEventMarket[statusKey] = "no_props";
              bookmakerCountByEventMarket[statusKey] = 0;
              (providerErrorsByGame[target.targetKey] ||= []).push(`no_props:${game.id}:${marketRequest}`);
              continue;
            }

            if (propsData.length === 0) {
              providerStatusByEventMarket[statusKey] = "empty_props";
              bookmakerCountByEventMarket[statusKey] = 0;
              (providerErrorsByGame[target.targetKey] ||= []).push(`empty_props:${game.id}:${marketRequest}`);
              continue;
            }

            sawPropsPayload = true;
            providerStatusByEventMarket[statusKey] = `ok:${[...new Set(propsData.map((entry: any) => entry.marketKey))].join(",")}`;
            bookmakerCountByEventMarket[statusKey] =
              new Set(propsData.map((entry: any) => entry.bookmakerKey).filter(Boolean)).size;

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
                wroteAnyForTarget = true;
                snapshotsWrittenByGame[target.targetKey] = (snapshotsWrittenByGame[target.targetKey] || 0) + 1;
                snapshotsWrittenByStatType[statType] = (snapshotsWrittenByStatType[statType] || 0) + 1;

                latestByKey.set(dedupKey, {
                  over_odds: prop.over || null,
                  under_odds: prop.under || null,
                  threshold: prop.point,
                });
              }
            }

            if (wroteAnyForTarget) {
              gamesProcessed++;
              break;
            }
          }
          if (wroteAnyForTarget) break;
        } catch (e) {
          console.error(`Error processing game ${game.id}:`, e);
          (providerErrorsByGame[target.targetKey] ||= []).push(`error:${game.id}:${e instanceof Error ? e.message : String(e)}`);
        }
      }

      if (wroteAnyForTarget || sawPropsPayload) gamesWithProps++;
      else {
        gamesWithoutProps++;
        const statusText = String(target.status ?? "").toLowerCase();
        if (sport === "NBA" && (statusText.includes("final") || statusText.includes("progress") || statusText.includes("halftime"))) {
          providerUnavailableReason = "PROVIDER_PROPS_CLOSED_OR_UNAVAILABLE";
        }
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
    const todayET = easternDateString();

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
              : { score_all_market_players: true, sport, game_date: todayET },
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
      schedule_source_used: scheduleSourceUsed,
      espn_games_fetched_count: espnGamesFetchedCount,
      espn_canonical_keys: espnCanonicalKeys,
      odds_games_fetched_count: sourceGamesFetchedCount,
      odds_canonical_keys: oddsCanonicalKeys,
      matched_keys: matchedKeys,
      missing_from_odds_keys: missingFromOddsKeys,
      stale_deactivated_keys: staleDeactivatedKeys,
      source_games_fetched_count: sourceGamesFetchedCount,
      normalized_games_count: normalizedGamesCount,
      upserted_games_count: gamesTodayRows.length,
      active_games_count: activeGamesCount,
      skipped_games: skippedGames,
      canonical_keys: canonicalKeys,
      total_rows: gamesTodayRows.length,
      dupes_merged: dupesMerged,
      by_status: {
        verified: gamesTodayRows.filter(r => r.verification_status === "verified").length,
        unverified: gamesTodayRows.filter(r => r.verification_status === "unverified").length,
        mismatch: gamesTodayRows.filter(r => r.verification_status === "mismatch").length,
        missing_secondary: gamesTodayRows.filter(r => r.verification_status === "missing_secondary").length,
      },
    };

    if (!providerUnavailableReason && newRows.length === 0) {
      const diagnosticValues = Object.values(providerDiagnosticsByEvent);
      const has4xxOr5xx = diagnosticValues.some((value) => {
        const status = Number((value as Record<string, unknown>)?.http_status ?? 0);
        return status >= 400;
      });
      if (has4xxOr5xx) {
        providerUnavailableReason = "PROVIDER_MARKET_NOT_AVAILABLE";
      }
    }

    const result = {
      ok: insertErrors === 0,
      game_dates: [...allGameDates].sort(),
      games_processed: gamesProcessed,
      new_snapshots: newRows.length,
      snapshots_prepared_count: newRows.length,
      snapshots_inserted_count: insertErrors === 0 ? newRows.length : Math.max(0, newRows.length - insertErrors),
      new_by_date: dateCounts,
      skipped_dupes: skippedDupes,
      snapshots_skipped_duplicate_count: skippedDupes,
      total_across_dates: totalToday || 0,
      active_espn_games_count: espnSlateGames.length,
      games_attempted: gamesAttempted,
      games_with_props: gamesWithProps,
      games_without_props: gamesWithoutProps,
      matched_provider_events_by_game: matchedProviderEventsByGame,
      provider_event_ids_attempted: [...new Set(providerEventIdsAttempted)],
      markets_attempted: marketsAttempted,
      markets_attempted_by_event: marketsAttemptedByEvent,
      provider_status_by_event_market: providerStatusByEventMarket,
      bookmaker_count_by_event_market: bookmakerCountByEventMarket,
      provider_diagnostics_by_event: diagnoseProps ? providerDiagnosticsByEvent : undefined,
      snapshots_written_by_game: snapshotsWrittenByGame,
      snapshots_written_by_stat_type: snapshotsWrittenByStatType,
      provider_errors_by_game: providerErrorsByGame,
      first_provider_error_sample: Object.values(providerErrorsByGame).flat()[0] ?? null,
      provider_unavailable_reason: providerUnavailableReason,
      mlb_resolved_players: mlbResolvedPlayers,
      mlb_unresolved_players: mlbUnresolvedPlayers,
      mlb_team_mapping_missing_names: [...mlbTeamMappingMissingNames].sort(),
      games_today_mismatch_count: verificationSummary.by_status.mismatch,
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
