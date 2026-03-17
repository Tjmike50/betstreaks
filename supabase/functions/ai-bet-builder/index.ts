import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ODDS_API_BASE = "https://api.the-odds-api.com/v4";
const AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

const STAT_LABELS: Record<string, string> = {
  pts: "Points", reb: "Rebounds", ast: "Assists",
  fg3m: "3-Pointers", stl: "Steals", blk: "Blocks",
};

const MAX_CANDIDATES_PER_PLAYER = 2;
const MAX_VERIFIED_CANDIDATES_TO_LLM = 120;
const MAX_GAME_CANDIDATES_TO_LLM = 30;

// Nickname -> abbreviation mapping for Odds API team names
const TEAM_NICKNAME_TO_ABBR: Record<string, string> = {
  "HAWKS": "ATL", "CELTICS": "BOS", "NETS": "BKN", "HORNETS": "CHA",
  "BULLS": "CHI", "CAVALIERS": "CLE", "MAVERICKS": "DAL", "NUGGETS": "DEN",
  "PISTONS": "DET", "WARRIORS": "GSW", "ROCKETS": "HOU", "PACERS": "IND",
  "CLIPPERS": "LAC", "LAKERS": "LAL", "GRIZZLIES": "MEM", "HEAT": "MIA",
  "BUCKS": "MIL", "TIMBERWOLVES": "MIN", "PELICANS": "NOP", "KNICKS": "NYK",
  "THUNDER": "OKC", "MAGIC": "ORL", "76ERS": "PHI", "SUNS": "PHX",
  "BLAZERS": "POR", "KINGS": "SAC", "SPURS": "SAS", "RAPTORS": "TOR",
  "JAZZ": "UTA", "WIZARDS": "WAS",
};

/** Resolve a team name/nickname to standard NBA abbreviation */
function resolveToAbbr(name: string): string {
  const upper = name.toUpperCase();
  // Already an abbreviation?
  if (upper.length <= 3 && Object.values(TEAM_NICKNAME_TO_ABBR).includes(upper)) return upper;
  // Try nickname
  if (TEAM_NICKNAME_TO_ABBR[upper]) return TEAM_NICKNAME_TO_ABBR[upper];
  // Try last word (e.g. "Los Angeles Lakers" -> "LAKERS")
  const lastWord = upper.split(" ").pop() || upper;
  if (TEAM_NICKNAME_TO_ABBR[lastWord]) return TEAM_NICKNAME_TO_ABBR[lastWord];
  // Special cases
  if (upper.includes("TRAIL") || upper.includes("PORTLAND")) return "POR";
  if (upper.includes("THUNDER") || upper.includes("OKLAHOMA")) return "OKC";
  if (upper.includes("GOLDEN STATE")) return "GSW";
  return upper;
}

// ===== ODDS UTILITY FUNCTIONS =====

/** Convert American odds to implied probability (0-1) */
function americanToImplied(odds: string | number | null): number | null {
  if (odds == null) return null;
  const n = typeof odds === "string" ? parseInt(odds, 10) : odds;
  if (isNaN(n)) return null;
  if (n > 0) return 100 / (n + 100);
  if (n < 0) return Math.abs(n) / (Math.abs(n) + 100);
  return null;
}

/** Check if odds are within a sane range for a main line */
function isOddsSane(overOdds: string | null, underOdds: string | null, threshold: number, statType: string): { valid: boolean; reason: string | null } {
  const overNum = overOdds ? parseInt(overOdds, 10) : null;
  const underNum = underOdds ? parseInt(underOdds, 10) : null;

  const REALISTIC_THRESHOLDS: Record<string, [number, number]> = {
    Points: [5, 45], Rebounds: [2, 18], Assists: [1, 15], "3-Pointers": [0.5, 8],
    Steals: [0.5, 4], Blocks: [0.5, 5],
  };
  const range = REALISTIC_THRESHOLDS[statType];
  if (range && (threshold < range[0] || threshold > range[1])) {
    return { valid: false, reason: `Threshold ${threshold} outside realistic range for ${statType}` };
  }

  if (overNum != null && overNum < -800) return { valid: false, reason: `Over odds ${overOdds} too extreme` };
  if (underNum != null && underNum < -800) return { valid: false, reason: `Under odds ${underOdds} too extreme` };

  if (overNum != null && underNum != null) {
    const diff = Math.abs(overNum - underNum);
    if (diff > 500) return { valid: false, reason: `Odds spread too wide: ${overOdds}/${underOdds}` };
  }
  return { valid: true, reason: null };
}

interface BestLineEntry {
  player_name: string;
  stat_type: string;
  threshold: number;
  best_over_odds: string | null;
  best_over_book: string | null;
  best_under_odds: string | null;
  best_under_book: string | null;
  books_seen: string[];
  implied_over: number | null;
  implied_under: number | null;
  odds_validated: boolean;
  rejection_reason: string | null;
  is_main_line: boolean;
  consensus_line: number | null;
  market_confidence: number;
  books_with_line: number;
  odds_balance_score: number | null;
  alt_line_flag: boolean;
  edge: number | null;
}

/** Compute how balanced over/under odds are (lower = more balanced = more likely main line) */
function oddsImbalance(overOdds: string | null, underOdds: string | null): number | null {
  const overImpl = americanToImplied(overOdds);
  const underImpl = americanToImplied(underOdds);
  if (overImpl == null || underImpl == null) return null;
  return Math.abs(overImpl - underImpl);
}

/** Identify if a threshold is likely an alt line when a more balanced threshold exists */
function isLikelyAltLine(
  imbalance: number | null,
  allThresholdsForPlayerStat: { threshold: number; imbalance: number | null; booksCount: number }[],
  currentThreshold: number
): boolean {
  if (imbalance == null) return false;
  if (imbalance > 0.35) {
    const moreBalanced = allThresholdsForPlayerStat.find(t =>
      t.threshold !== currentThreshold &&
      t.imbalance != null &&
      t.imbalance < imbalance - 0.15 &&
      t.booksCount >= 1
    );
    if (moreBalanced) return true;
  }
  return false;
}

/** Aggregate live props across books with main-line detection and market confidence */
function aggregateBestLines(liveProps: { player_name: string; stat_type: string; threshold: number; over_odds: string | null; under_odds: string | null; sportsbook: string }[]): Map<string, BestLineEntry> {
  const grouped = new Map<string, typeof liveProps>();
  for (const prop of liveProps) {
    const key = `${prop.player_name.toLowerCase()}|${prop.stat_type}|${prop.threshold}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(prop);
  }

  interface ThresholdAgg {
    threshold: number;
    entries: typeof liveProps;
    booksCount: number;
    books: Set<string>;
    bestOverOdds: number | null;
    bestOverBook: string | null;
    bestUnderOdds: number | null;
    bestUnderBook: string | null;
    medianOver: number | null;
    medianUnder: number | null;
    imbalance: number | null;
  }

  const byPlayerStat = new Map<string, ThresholdAgg[]>();

  for (const [key, entries] of grouped) {
    const parts = key.split("|");
    const psKey = `${parts[0]}|${parts[1]}`;
    const threshold = Number(parts[2]);

    let bestOverOdds: number | null = null;
    let bestOverBook: string | null = null;
    let bestUnderOdds: number | null = null;
    let bestUnderBook: string | null = null;
    const booksSeen = new Set<string>();
    const overOddsList: number[] = [];
    const underOddsList: number[] = [];

    for (const e of entries) {
      booksSeen.add(e.sportsbook);
      const overNum = e.over_odds ? parseInt(e.over_odds, 10) : null;
      const underNum = e.under_odds ? parseInt(e.under_odds, 10) : null;
      if (overNum != null) {
        overOddsList.push(overNum);
        if (bestOverOdds == null || overNum > bestOverOdds) { bestOverOdds = overNum; bestOverBook = e.sportsbook; }
      }
      if (underNum != null) {
        underOddsList.push(underNum);
        if (bestUnderOdds == null || underNum > bestUnderOdds) { bestUnderOdds = underNum; bestUnderBook = e.sportsbook; }
      }
    }

    const imbalance = oddsImbalance(
      bestOverOdds != null ? String(bestOverOdds) : null,
      bestUnderOdds != null ? String(bestUnderOdds) : null
    );

    const agg: ThresholdAgg = {
      threshold, entries, booksCount: booksSeen.size, books: booksSeen,
      bestOverOdds, bestOverBook, bestUnderOdds, bestUnderBook,
      medianOver: null, medianUnder: null, imbalance,
    };

    if (!byPlayerStat.has(psKey)) byPlayerStat.set(psKey, []);
    byPlayerStat.get(psKey)!.push(agg);
  }

  const bestLines = new Map<string, BestLineEntry>();

  for (const [psKey, thresholds] of byPlayerStat) {
    const thresholdSummaries = thresholds.map(t => ({ threshold: t.threshold, imbalance: t.imbalance, booksCount: t.booksCount }));
    const mainLineCandidates = [...thresholds].sort((a, b) => {
      if (b.booksCount !== a.booksCount) return b.booksCount - a.booksCount;
      return (a.imbalance ?? 1) - (b.imbalance ?? 1);
    });
    const mainLine = mainLineCandidates[0];
    const consensusThreshold = mainLine.threshold;

    for (const t of thresholds) {
      const key = `${psKey}|${t.threshold}`;
      const firstEntry = t.entries[0];
      const isAlt = isLikelyAltLine(t.imbalance, thresholdSummaries, t.threshold);
      const isMain = t.threshold === consensusThreshold && !isAlt;

      let marketConfidence = 0;
      const booksFactor = Math.min(t.booksCount * 22, 85);
      marketConfidence += booksFactor;
      if (t.imbalance != null && t.imbalance < 0.15) marketConfidence += 15;
      else if (t.imbalance != null && t.imbalance < 0.25) marketConfidence += 8;
      if (isMain) marketConfidence += 5;
      if (isAlt) marketConfidence -= 30;
      marketConfidence = Math.max(0, Math.min(100, marketConfidence));

      const sanity = isOddsSane(
        t.bestOverOdds != null ? String(t.bestOverOdds) : null,
        t.bestUnderOdds != null ? String(t.bestUnderOdds) : null,
        t.threshold, firstEntry.stat_type
      );

      let finalValid = sanity.valid;
      let finalReason = sanity.reason;
      if (t.booksCount === 1 && t.imbalance != null && t.imbalance > 0.4) {
        finalValid = false;
        finalReason = `Single-book prop with heavy imbalance (${Math.round(t.imbalance * 100)}%)`;
      }
      if (isAlt && t.imbalance != null && t.imbalance > 0.5) {
        finalValid = false;
        finalReason = `Alt line detected: imbalance ${Math.round(t.imbalance * 100)}%, consensus main at ${consensusThreshold}`;
      }
      if (t.bestOverOdds == null && t.bestUnderOdds == null) {
        finalValid = false;
        finalReason = "No odds available for either side";
      }
      // Reject low market confidence
      if (marketConfidence < 25) {
        finalValid = false;
        finalReason = `Market confidence too low: ${marketConfidence}/100`;
      }

      bestLines.set(key, {
        player_name: firstEntry.player_name,
        stat_type: firstEntry.stat_type,
        threshold: t.threshold,
        best_over_odds: t.bestOverOdds != null ? String(t.bestOverOdds) : null,
        best_over_book: t.bestOverBook,
        best_under_odds: t.bestUnderOdds != null ? String(t.bestUnderOdds) : null,
        best_under_book: t.bestUnderBook,
        books_seen: [...t.books],
        implied_over: americanToImplied(t.bestOverOdds),
        implied_under: americanToImplied(t.bestUnderOdds),
        odds_validated: finalValid,
        rejection_reason: finalReason,
        is_main_line: isMain,
        consensus_line: consensusThreshold,
        market_confidence: marketConfidence,
        books_with_line: t.booksCount,
        odds_balance_score: t.imbalance != null ? Math.round((1 - t.imbalance) * 100) : null,
        alt_line_flag: isAlt,
        edge: null,
      });
    }
  }

  return bestLines;
}

/** Compare current odds to recent snapshots and detect extreme movement */
function detectExtremeMovement(
  currentOdds: string | null,
  snapshots: { over_odds: string | null; under_odds: string | null; snapshot_at: string }[],
  side: "over" | "under"
): string | null {
  if (!currentOdds || snapshots.length === 0) return null;
  const currentNum = parseInt(currentOdds, 10);
  if (isNaN(currentNum)) return null;
  const oldest = snapshots[snapshots.length - 1];
  const oldOdds = side === "over" ? oldest.over_odds : oldest.under_odds;
  if (!oldOdds) return null;
  const oldNum = parseInt(oldOdds, 10);
  if (isNaN(oldNum)) return null;
  const diff = Math.abs(currentNum - oldNum);
  if (diff > 300) return `Extreme odds movement: ${oldOdds} → ${currentOdds} (${diff}pt shift)`;
  return null;
}

// Normalize name for fuzzy matching
function normName(n: string): string {
  return n.toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
}

// Normalize stat type for matching
function normStat(s: string): string {
  const lower = s.toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (lower === "points" || lower === "pts") return "pts";
  if (lower === "rebounds" || lower === "reb" || lower === "totalrebounds") return "reb";
  if (lower === "assists" || lower === "ast") return "ast";
  if (lower === "3-pointers" || lower === "3pointers" || lower === "3pm" || lower === "fg3m" || lower === "threes") return "fg3m";
  if (lower === "steals" || lower === "stl") return "stl";
  if (lower === "blocks" || lower === "blk") return "blk";
  if (lower === "moneyline" || lower === "ml" || lower === "h2h") return "moneyline";
  if (lower === "spread" || lower === "spreads") return "spread";
  if (lower === "total" || lower === "totals" || lower === "ou") return "total";
  return lower;
}

// ===== Reverse stat label lookup =====
const STAT_LABEL_TO_KEY: Record<string, string> = {};
for (const [k, v] of Object.entries(STAT_LABELS)) { STAT_LABEL_TO_KEY[v] = k; }

// ===== GAME-LEVEL ODDS PARSING =====
interface GameLevelCandidate {
  type: "moneyline" | "spread" | "total";
  home_team: string; away_team: string;
  team?: string; opponent?: string;
  spread?: number; total_line?: number;
  pick?: string; odds: string; sportsbook: string;
  label: string; implied_probability: number | null;
}

function parseGameLevelOdds(gamesData: any[]): GameLevelCandidate[] {
  const bestByKey = new Map<string, GameLevelCandidate>();

  for (const game of gamesData) {
    const homeTeam = game.home_team || "";
    const awayTeam = game.away_team || "";
    const homeAbbr = homeTeam.split(" ").pop() || homeTeam;
    const awayAbbr = awayTeam.split(" ").pop() || awayTeam;

    for (const bm of game.bookmakers || []) {
      for (const market of bm.markets || []) {
        if (market.key === "h2h") {
          for (const outcome of market.outcomes || []) {
            const isHome = outcome.name === homeTeam;
            const team = isHome ? homeAbbr : awayAbbr;
            const opponent = isHome ? awayAbbr : homeAbbr;
            const odds = String(outcome.price);
            const key = `ml|${team}`;
            const implied = americanToImplied(outcome.price);
            const existing = bestByKey.get(key);
            const existingOdds = existing ? parseInt(existing.odds, 10) : -Infinity;
            if (!existing || parseInt(odds, 10) > existingOdds) {
              bestByKey.set(key, { type: "moneyline", home_team: homeAbbr, away_team: awayAbbr, team, opponent, odds, sportsbook: bm.key, label: `${team} ML`, implied_probability: implied });
            }
          }
        } else if (market.key === "spreads") {
          for (const outcome of market.outcomes || []) {
            const isHome = outcome.name === homeTeam;
            const team = isHome ? homeAbbr : awayAbbr;
            const opponent = isHome ? awayAbbr : homeAbbr;
            const spreadVal = outcome.point;
            const odds = String(outcome.price);
            const key = `spread|${team}|${spreadVal}`;
            const implied = americanToImplied(outcome.price);
            const existing = bestByKey.get(key);
            const existingOdds = existing ? parseInt(existing.odds, 10) : -Infinity;
            if (!existing || parseInt(odds, 10) > existingOdds) {
              bestByKey.set(key, { type: "spread", home_team: homeAbbr, away_team: awayAbbr, team, opponent, spread: spreadVal, odds, sportsbook: bm.key, label: `${team} ${spreadVal > 0 ? "+" : ""}${spreadVal}`, implied_probability: implied });
            }
          }
        } else if (market.key === "totals") {
          for (const outcome of market.outcomes || []) {
            const totalLine = outcome.point;
            const pick = outcome.name;
            const odds = String(outcome.price);
            const key = `total|${homeAbbr}v${awayAbbr}|${totalLine}|${pick}`;
            const implied = americanToImplied(outcome.price);
            const existing = bestByKey.get(key);
            const existingOdds = existing ? parseInt(existing.odds, 10) : -Infinity;
            if (!existing || parseInt(odds, 10) > existingOdds) {
              bestByKey.set(key, { type: "total", home_team: homeAbbr, away_team: awayAbbr, total_line: totalLine, pick, odds, sportsbook: bm.key, label: `${homeAbbr}/${awayAbbr} ${pick} ${totalLine}`, implied_probability: implied });
            }
          }
        }
      }
    }
  }
  return [...bestByKey.values()];
}

// ===== VERIFIED MARKET CANDIDATE (player props built from live markets) =====
interface VerifiedPropCandidate {
  // Market data (from bestLines)
  player_name: string;
  stat_type: string;      // e.g. "Points"
  stat_key: string;        // e.g. "pts"
  threshold: number;
  best_over_odds: string | null;
  best_over_book: string | null;
  best_under_odds: string | null;
  best_under_book: string | null;
  books_count: number;
  books_seen: string[];
  market_confidence: number;
  consensus_line: number | null;
  is_main_line: boolean;
  implied_over: number | null;
  implied_under: number | null;
  // Scoring enrichment (from player_prop_scores, if available)
  team_abbr: string | null;
  opponent_abbr: string | null;
  home_away: string | null;
  confidence_score: number | null;
  value_score: number | null;
  volatility_score: number | null;
  consistency_score: number | null;
  season_avg: number | null;
  last3_avg: number | null;
  last5_avg: number | null;
  last10_avg: number | null;
  season_hit_rate: number | null;
  last5_hit_rate: number | null;
  last10_hit_rate: number | null;
  vs_opponent_avg: number | null;
  vs_opponent_hit_rate: number | null;
  vs_opponent_games: number | null;
  home_avg: number | null;
  home_hit_rate: number | null;
  home_games: number | null;
  away_avg: number | null;
  away_hit_rate: number | null;
  away_games: number | null;
  total_games: number | null;
  reason_tags: string[];
  edge_over: number | null;
  edge_under: number | null;
}

interface MarketQualityDebug {
  before_market_filters: number;
  removed_by_verified_only: number;
  removed_by_main_lines_only: number;
  removed_by_min_books: number;
  removed_by_min_confidence: number;
  removed_by_single_book_exclude: number;
  after_market_filters: number;
  books_count_distribution: Record<string, number>;
  market_confidence_distribution: Record<string, number>;
}

interface DebugInfo {
  db_candidates_found: number;
  db_query_date: string;
  fallback_used: boolean;
  fallback_reason: string | null;
  candidates_after_diversity: number;
  candidates_passed_to_llm: number;
  unique_players_in_pool: number;
  top_candidates: { player: string; stat: string; confidence: number; value: number }[];
  excluded_candidates: { player: string; stat: string; reason: string }[];
  legs_validated: number;
  legs_rejected: number;
  rejected_legs: { player: string; stat: string; reason: string }[];
  scoring_engine_called: boolean;
  mode: string;
  live_props_found: number;
  game_level_candidates: number;
  verified_prop_candidates: number;
  verified_candidates_passed_to_llm: number;
  final_legs_accepted: number;
  final_legs_rejected_no_match: number;
  market_quality: MarketQualityDebug | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const debug: DebugInfo = {
    db_candidates_found: 0, db_query_date: "", fallback_used: false, fallback_reason: null,
    candidates_after_diversity: 0, candidates_passed_to_llm: 0, unique_players_in_pool: 0,
    top_candidates: [], excluded_candidates: [], legs_validated: 0, legs_rejected: 0,
    rejected_legs: [], scoring_engine_called: false, mode: "verified_market_first",
    live_props_found: 0, game_level_candidates: 0,
    verified_prop_candidates: 0, verified_candidates_passed_to_llm: 0,
    final_legs_accepted: 0, final_legs_rejected_no_match: 0,
    market_quality: null,
  };

  try {
    const ODDS_API_KEY = Deno.env.get("ODDS_API_KEY");
    if (!ODDS_API_KEY) throw new Error("ODDS_API_KEY not configured");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: authHeader ? { Authorization: authHeader } : {} },
    });
    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const { prompt, slipCount = 1, filters = null } = await req.json();
    if (!prompt) throw new Error("prompt is required");

    // --- Auth & usage limits ---
    const { data: { user } } = await supabase.auth.getUser();
    let isPremium = false;
    if (user) {
      const { data: flags } = await supabase.from("user_flags").select("is_premium").eq("user_id", user.id).single();
      isPremium = flags?.is_premium ?? false;
      if (!isPremium) {
        const today = new Date().toISOString().split("T")[0];
        const { data: usage } = await supabase.from("ai_usage").select("request_count").eq("user_id", user.id).eq("usage_date", today).single();
        if (usage && usage.request_count >= 1) {
          return new Response(
            JSON.stringify({ error: "free_limit_reached", message: "Free users get 1 AI slip per day. Upgrade to Premium for unlimited." }),
            { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    }

    const todayStr = new Date().toISOString().split("T")[0];
    debug.db_query_date = todayStr;

    const betType = filters?.betType || null;
    const includePlayerProps = !betType || betType === "player_props" || betType === "mixed";
    const includeGameLevel = !betType || betType === "moneyline" || betType === "spread" || betType === "totals" || betType === "mixed";

    // ===== PHASE 1: FETCH LIVE ODDS (games + player props) =====
    const BOOKMAKERS = "draftkings,fanduel,betmgm,pointsbetus";
    const featuredUrl = `${ODDS_API_BASE}/sports/basketball_nba/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h,spreads,totals&oddsFormat=american&bookmakers=${BOOKMAKERS}`;
    const featuredRes = await fetch(featuredUrl);
    let gamesData: any[] = [];
    if (featuredRes.ok) {
      gamesData = await featuredRes.json();
    } else {
      const errBody = await featuredRes.text().catch(() => "");
      console.error(`[AI-Builder] Odds API error: ${featuredRes.status} — ${errBody}`);
    }

    // Build teams playing today
    const teamsPlayingToday = new Set<string>();
    for (const game of gamesData) {
      const homeAbbr = resolveToAbbr(game.home_team || "");
      const awayAbbr = resolveToAbbr(game.away_team || "");
      if (homeAbbr) teamsPlayingToday.add(homeAbbr);
      if (awayAbbr) teamsPlayingToday.add(awayAbbr);
    }
    const { data: gamesTodayRows } = await serviceClient.from("games_today").select("id, home_team_abbr, away_team_abbr").eq("game_date", todayStr);
    for (const g of gamesTodayRows || []) {
      if (g.home_team_abbr) teamsPlayingToday.add(g.home_team_abbr.toUpperCase());
      if (g.away_team_abbr) teamsPlayingToday.add(g.away_team_abbr.toUpperCase());
    }

    // If user selected specific games, restrict teams to only those games
    let gameFilterTeams: Set<string> | null = null;
    if (filters?.includeGames?.length > 0) {
      gameFilterTeams = new Set<string>();
      for (const g of gamesTodayRows || []) {
        if (filters.includeGames.includes(g.id)) {
          if (g.home_team_abbr) gameFilterTeams.add(g.home_team_abbr.toUpperCase());
          if (g.away_team_abbr) gameFilterTeams.add(g.away_team_abbr.toUpperCase());
        }
      }
      console.log(`[AI-Builder] Game filter active — restricting to teams: ${[...gameFilterTeams].join(", ")}`);
    }

    console.log(`[AI-Builder] Teams playing today: ${[...teamsPlayingToday].join(", ")} (${teamsPlayingToday.size} teams)`);

    // Fetch live player props from multiple sportsbooks
    let livePropsCount = 0;
    const lineSnapshotRows: any[] = [];
    const allLiveProps: { player_name: string; stat_type: string; threshold: number; over_odds: string | null; under_odds: string | null; sportsbook: string; game_home_abbr?: string; game_away_abbr?: string }[] = [];

    // Map player names to their game's teams for team_abbr resolution
    const playerToGameTeams = new Map<string, { home: string; away: string }>();

    if (includePlayerProps) {
      // Filter games to only selected ones if game filter is active
      const gamesToFetchProps = gameFilterTeams && gameFilterTeams.size > 0
        ? gamesData.filter((g: any) => {
            const homeAbbr = resolveToAbbr(g.home_team || "");
            const awayAbbr = resolveToAbbr(g.away_team || "");
            return gameFilterTeams!.has(homeAbbr) || gameFilterTeams!.has(awayAbbr);
          })
        : gamesData;
      console.log(`[AI-Builder] Fetching props from ${gamesToFetchProps.length} games${gameFilterTeams ? ` (filtered from ${gamesData.length})` : ""}`);
      for (const game of gamesToFetchProps.slice(0, 5)) {
        const gameHomeAbbr = resolveToAbbr(game.home_team || "");
        const gameAwayAbbr = resolveToAbbr(game.away_team || "");
        try {
          const propsUrl = `${ODDS_API_BASE}/sports/basketball_nba/events/${game.id}/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=player_points,player_rebounds,player_assists,player_threes&oddsFormat=american&bookmakers=${BOOKMAKERS}`;
          const propsRes = await fetch(propsUrl);
          if (propsRes.ok) {
            const propsData = await propsRes.json();
            for (const bm of propsData.bookmakers || []) {
              for (const market of bm.markets || []) {
                const statMap: Record<string, string> = {
                  player_points: "Points", player_rebounds: "Rebounds",
                  player_assists: "Assists", player_threes: "3-Pointers",
                };
                const statType = statMap[market.key];
                if (!statType) continue;
                const outcomesByPlayer: Record<string, { over?: string; under?: string; point?: number; player?: string }> = {};
                for (const o of market.outcomes || []) {
                  const key = `${o.description}_${o.point}`;
                  if (!outcomesByPlayer[key]) outcomesByPlayer[key] = { player: o.description, point: o.point };
                  if (o.name === "Over") outcomesByPlayer[key].over = String(o.price);
                  if (o.name === "Under") outcomesByPlayer[key].under = String(o.price);
                }
                for (const entry of Object.values(outcomesByPlayer)) {
                  if (entry.player && entry.point != null) {
                    livePropsCount++;
                    const row = { player_name: entry.player, stat_type: statType, threshold: entry.point, over_odds: entry.over || null, under_odds: entry.under || null, sportsbook: bm.key, game_date: todayStr };
                    lineSnapshotRows.push(row);
                    allLiveProps.push(row);
                  }
                }
              }
            }
          }
        } catch (e) {
          console.error("[AI-Builder] Props fetch error:", e);
        }
      }
    }

    debug.live_props_found = livePropsCount;
    console.log(`[AI-Builder] Live props found: ${livePropsCount}`);

    // Aggregate best lines with main-line detection
    let bestLines = aggregateBestLines(allLiveProps);

    // Snapshot fallback if no live odds
    if (bestLines.size === 0 && includePlayerProps) {
      console.log("[AI-Builder] No live odds — falling back to line_snapshots...");
      const { data: snapshotFallback } = await serviceClient.from("line_snapshots")
        .select("player_name, stat_type, threshold, over_odds, under_odds, sportsbook")
        .eq("game_date", todayStr).order("snapshot_at", { ascending: false }).limit(800);
      if (snapshotFallback && snapshotFallback.length > 0) {
        const fallbackProps = snapshotFallback.map((s: any) => ({
          player_name: s.player_name, stat_type: s.stat_type, threshold: Number(s.threshold),
          over_odds: s.over_odds, under_odds: s.under_odds, sportsbook: s.sportsbook || "snapshot",
        }));
        bestLines = aggregateBestLines(fallbackProps);
        debug.fallback_used = true;
        debug.fallback_reason = `Snapshot fallback: ${bestLines.size} unique props from ${snapshotFallback.length} snapshots`;
        console.log(`[AI-Builder] Snapshot fallback: ${bestLines.size} unique props`);
      }
    }

    let mainLinesFound = 0;
    let sanityRejected = 0;
    let altLinesDetected = 0;
    for (const bl of bestLines.values()) {
      if (!bl.odds_validated) sanityRejected++;
      if (bl.alt_line_flag) altLinesDetected++;
      if (bl.is_main_line) mainLinesFound++;
    }
    console.log(`[AI-Builder] Market normalization: ${bestLines.size} unique, ${mainLinesFound} main, ${altLinesDetected} alt, ${sanityRejected} rejected`);

    // Save line snapshots (fire-and-forget)
    if (lineSnapshotRows.length > 0) {
      serviceClient.from("line_snapshots").insert(lineSnapshotRows)
        .then(({ error }) => { if (error) console.error("[AI-Builder] Line snapshot insert error:", error); });
    }

    // ===== PHASE 2: FETCH SCORING DATA FOR ENRICHMENT =====
    let scoredProps: any[] = [];
    if (includePlayerProps) {
      const { data: dbCandidates } = await serviceClient.from("player_prop_scores")
        .select("*").eq("game_date", todayStr).order("confidence_score", { ascending: false }).limit(500);
      scoredProps = dbCandidates || [];
      debug.db_candidates_found = scoredProps.length;

      if (scoredProps.length === 0) {
        const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
        const { data: yestCandidates } = await serviceClient.from("player_prop_scores")
          .select("*").eq("game_date", yesterday).order("confidence_score", { ascending: false }).limit(500);
        if (yestCandidates && yestCandidates.length > 0) {
          scoredProps = yestCandidates;
          debug.fallback_used = true;
          debug.fallback_reason = (debug.fallback_reason ? debug.fallback_reason + " | " : "") + `Scoring data from ${yesterday}`;
        }
      }
    }

    // Build scoring lookup: normName|statKey -> best scoring row (for enrichment)
    const scoringLookup = new Map<string, any>();
    for (const p of scoredProps) {
      const pKey = `${normName(p.player_name)}|${normStat(p.stat_type)}`;
      const pKeyThreshold = `${pKey}|${p.threshold}`;
      // Prefer exact threshold match; otherwise store best by confidence
      if (!scoringLookup.has(pKeyThreshold)) scoringLookup.set(pKeyThreshold, p);
      const existing = scoringLookup.get(pKey);
      if (!existing || (p.confidence_score ?? 0) > (existing.confidence_score ?? 0)) {
        scoringLookup.set(pKey, p);
      }
    }

    // ===== PHASE 3: BUILD VERIFIED MARKET-FIRST CANDIDATE POOL =====
    // Only include validated bestLine entries as candidates
    const verifiedCandidates: VerifiedPropCandidate[] = [];

    for (const bl of bestLines.values()) {
      if (!bl.odds_validated) continue; // Skip rejected lines

      const statKey = STAT_LABEL_TO_KEY[bl.stat_type] || normStat(bl.stat_type);
      const pNorm = normName(bl.player_name);

      // Find scoring enrichment
      const exactScoringKey = `${pNorm}|${statKey}|${bl.threshold}`;
      const fuzzyScoringKey = `${pNorm}|${statKey}`;
      const scoring = scoringLookup.get(exactScoringKey) || scoringLookup.get(fuzzyScoringKey) || null;

      // Compute edge
      let edgeOver: number | null = null;
      let edgeUnder: number | null = null;
      if (scoring?.season_hit_rate != null) {
        if (bl.implied_over != null) edgeOver = Math.round((scoring.season_hit_rate - bl.implied_over) * 100);
        if (bl.implied_under != null) edgeUnder = Math.round(((1 - scoring.season_hit_rate) - bl.implied_under) * 100);
      }

      verifiedCandidates.push({
        player_name: bl.player_name,
        stat_type: bl.stat_type,
        stat_key: statKey,
        threshold: bl.threshold,
        best_over_odds: bl.best_over_odds,
        best_over_book: bl.best_over_book,
        best_under_odds: bl.best_under_odds,
        best_under_book: bl.best_under_book,
        books_count: bl.books_with_line,
        books_seen: bl.books_seen,
        market_confidence: bl.market_confidence,
        consensus_line: bl.consensus_line,
        is_main_line: bl.is_main_line,
        implied_over: bl.implied_over,
        implied_under: bl.implied_under,
        // Scoring enrichment
        team_abbr: scoring?.team_abbr || null,
        opponent_abbr: scoring?.opponent_abbr || null,
        home_away: scoring?.home_away || null,
        confidence_score: scoring?.confidence_score ?? null,
        value_score: scoring?.value_score ?? null,
        volatility_score: scoring?.volatility_score ?? null,
        consistency_score: scoring?.consistency_score ?? null,
        season_avg: scoring?.season_avg ?? null,
        last3_avg: scoring?.last3_avg ?? null,
        last5_avg: scoring?.last5_avg ?? null,
        last10_avg: scoring?.last10_avg ?? null,
        season_hit_rate: scoring?.season_hit_rate ?? null,
        last5_hit_rate: scoring?.last5_hit_rate ?? null,
        last10_hit_rate: scoring?.last10_hit_rate ?? null,
        vs_opponent_avg: scoring?.vs_opponent_avg ?? null,
        vs_opponent_hit_rate: scoring?.vs_opponent_hit_rate ?? null,
        vs_opponent_games: scoring?.vs_opponent_games ?? null,
        home_avg: scoring?.home_avg ?? null,
        home_hit_rate: scoring?.home_hit_rate ?? null,
        home_games: scoring?.home_games ?? null,
        away_avg: scoring?.away_avg ?? null,
        away_hit_rate: scoring?.away_hit_rate ?? null,
        away_games: scoring?.away_games ?? null,
        total_games: scoring?.total_games ?? null,
        reason_tags: scoring?.reason_tags || [],
        edge_over: edgeOver,
        edge_under: edgeUnder,
      });
    }

    debug.verified_prop_candidates = verifiedCandidates.length;
    console.log(`[AI-Builder] Verified market candidates: ${verifiedCandidates.length} (from ${bestLines.size} total lines, ${sanityRejected} rejected)`);

    // ===== PHASE 3b: APPLY MARKET QUALITY FILTERS =====
    const mqDebug: MarketQualityDebug = {
      before_market_filters: verifiedCandidates.length,
      removed_by_verified_only: 0,
      removed_by_main_lines_only: 0,
      removed_by_min_books: 0,
      removed_by_min_confidence: 0,
      removed_by_single_book_exclude: 0,
      after_market_filters: 0,
      books_count_distribution: {},
      market_confidence_distribution: {},
    };

    // Compute distributions before filtering
    for (const c of verifiedCandidates) {
      const bBucket = `${c.books_count}_books`;
      mqDebug.books_count_distribution[bBucket] = (mqDebug.books_count_distribution[bBucket] || 0) + 1;
      const cBucket = c.market_confidence < 30 ? "0-29" : c.market_confidence < 50 ? "30-49" : c.market_confidence < 70 ? "50-69" : c.market_confidence < 90 ? "70-89" : "90-100";
      mqDebug.market_confidence_distribution[cBucket] = (mqDebug.market_confidence_distribution[cBucket] || 0) + 1;
    }

    let marketFilteredCandidates = [...verifiedCandidates];

    // Market quality filter defaults (applied even without user filters)
    const mqMinBooks = filters?.minBooksCount ?? 1;
    const mqMinConfidence = filters?.minMarketConfidence ?? 25;
    const mqVerifiedOnly = filters?.verifiedOnly ?? true;
    const mqMainLinesOnly = filters?.mainLinesOnly ?? true;
    const mqExcludeSingleBook = filters?.excludeSingleBookProps ?? false;

    if (mqVerifiedOnly) {
      const before = marketFilteredCandidates.length;
      marketFilteredCandidates = marketFilteredCandidates.filter(c => c.books_count >= 1);
      mqDebug.removed_by_verified_only = before - marketFilteredCandidates.length;
    }

    if (mqMainLinesOnly) {
      const before = marketFilteredCandidates.length;
      marketFilteredCandidates = marketFilteredCandidates.filter(c => c.is_main_line);
      mqDebug.removed_by_main_lines_only = before - marketFilteredCandidates.length;
    }

    if (mqMinBooks > 1) {
      const before = marketFilteredCandidates.length;
      marketFilteredCandidates = marketFilteredCandidates.filter(c => c.books_count >= mqMinBooks);
      mqDebug.removed_by_min_books = before - marketFilteredCandidates.length;
    }

    if (mqMinConfidence > 0) {
      const before = marketFilteredCandidates.length;
      marketFilteredCandidates = marketFilteredCandidates.filter(c => c.market_confidence >= mqMinConfidence);
      mqDebug.removed_by_min_confidence = before - marketFilteredCandidates.length;
    }

    if (mqExcludeSingleBook) {
      const before = marketFilteredCandidates.length;
      marketFilteredCandidates = marketFilteredCandidates.filter(c => c.books_count > 1);
      mqDebug.removed_by_single_book_exclude = before - marketFilteredCandidates.length;
    }

    mqDebug.after_market_filters = marketFilteredCandidates.length;
    debug.market_quality = mqDebug;
    console.log(`[AI-Builder] Market quality filters: ${verifiedCandidates.length} → ${marketFilteredCandidates.length} (removed: verified=${mqDebug.removed_by_verified_only}, mainLine=${mqDebug.removed_by_main_lines_only}, minBooks=${mqDebug.removed_by_min_books}, minConf=${mqDebug.removed_by_min_confidence}, singleBook=${mqDebug.removed_by_single_book_exclude})`);

    // ===== PHASE 3c: APPLY USER FILTERS to market-quality-filtered candidates =====
    let filteredCandidates = [...marketFilteredCandidates];
    if (filters && includePlayerProps) {
      const f = filters;
      // Game selector filter — restrict to teams from selected games
      if (gameFilterTeams && gameFilterTeams.size > 0) {
        filteredCandidates = filteredCandidates.filter(c => c.team_abbr && gameFilterTeams!.has(c.team_abbr.toUpperCase()));
      }
      if (f.statTypes?.length > 0) {
        const allowedStats = new Set(f.statTypes.map((s: string) => normStat(s)));
        filteredCandidates = filteredCandidates.filter(c => allowedStats.has(c.stat_key));
      }
      if (f.includeTeams?.length > 0) {
        const teams = new Set(f.includeTeams.map((t: string) => t.toUpperCase()));
        filteredCandidates = filteredCandidates.filter(c => c.team_abbr && teams.has(c.team_abbr.toUpperCase()));
      }
      if (f.excludeTeams?.length > 0) {
        const teams = new Set(f.excludeTeams.map((t: string) => t.toUpperCase()));
        filteredCandidates = filteredCandidates.filter(c => !c.team_abbr || !teams.has(c.team_abbr.toUpperCase()));
      }
      if (f.includePlayers?.length > 0) {
        const players = new Set(f.includePlayers.map((n: string) => normName(n)));
        filteredCandidates = filteredCandidates.filter(c => players.has(normName(c.player_name)));
      }
      if (f.excludePlayers?.length > 0) {
        const players = new Set(f.excludePlayers.map((n: string) => normName(n)));
        filteredCandidates = filteredCandidates.filter(c => !players.has(normName(c.player_name)));
      }
      if (f.minConfidence != null) {
        filteredCandidates = filteredCandidates.filter(c => (c.confidence_score ?? 0) >= f.minConfidence);
      }
      if (f.minHitRate != null) {
        filteredCandidates = filteredCandidates.filter(c => {
          const hitRate = c.season_hit_rate != null ? c.season_hit_rate * 100 : 0;
          return hitRate >= f.minHitRate;
        });
      }
      if (f.maxVolatility != null) {
        filteredCandidates = filteredCandidates.filter(c => (c.volatility_score ?? 100) <= f.maxVolatility);
      }
      if (f.minSampleSize != null) {
        filteredCandidates = filteredCandidates.filter(c => (c.total_games ?? 0) >= f.minSampleSize);
      }
      console.log(`[AI-Builder] After user filters: ${filteredCandidates.length} verified candidates`);
    }

    // Filter to teams playing today
    if (teamsPlayingToday.size > 0) {
      const before = filteredCandidates.length;
      filteredCandidates = filteredCandidates.filter(c => {
        if (!c.team_abbr) return true; // keep if no team info
        return teamsPlayingToday.has(c.team_abbr.toUpperCase());
      });
      if (filteredCandidates.length < before) {
        console.log(`[AI-Builder] Removed ${before - filteredCandidates.length} candidates from non-playing teams`);
      }
    }

    // ===== PHASE 3c: DIVERSITY CAP — max N props per player, prefer main lines =====
    // Sort: main lines first, then by market confidence desc, then confidence_score desc
    filteredCandidates.sort((a, b) => {
      if (a.is_main_line !== b.is_main_line) return a.is_main_line ? -1 : 1;
      if (b.market_confidence !== a.market_confidence) return b.market_confidence - a.market_confidence;
      return (b.confidence_score ?? 0) - (a.confidence_score ?? 0);
    });

    const playerPropCount = new Map<string, number>();
    const diversifiedCandidates: VerifiedPropCandidate[] = [];
    for (const c of filteredCandidates) {
      const pKey = normName(c.player_name);
      const count = playerPropCount.get(pKey) || 0;
      if (count >= MAX_CANDIDATES_PER_PLAYER) {
        debug.excluded_candidates.push({ player: c.player_name, stat: `${c.stat_type} ${c.threshold}`, reason: `Diversity cap` });
        continue;
      }
      playerPropCount.set(pKey, count + 1);
      diversifiedCandidates.push(c);
    }

    debug.candidates_after_diversity = diversifiedCandidates.length;
    const uniquePlayers = new Set(diversifiedCandidates.map(c => normName(c.player_name)));
    debug.unique_players_in_pool = uniquePlayers.size;
    console.log(`[AI-Builder] After diversity: ${diversifiedCandidates.length} from ${uniquePlayers.size} players`);

    // ===== PHASE 3d: GAME-LEVEL CANDIDATES =====
    let gameLevelCandidates = includeGameLevel ? parseGameLevelOdds(gamesData) : [];
    if (betType && betType !== "mixed") {
      if (betType === "moneyline") gameLevelCandidates = gameLevelCandidates.filter(c => c.type === "moneyline");
      else if (betType === "spread") gameLevelCandidates = gameLevelCandidates.filter(c => c.type === "spread");
      else if (betType === "totals") gameLevelCandidates = gameLevelCandidates.filter(c => c.type === "total");
      else if (betType === "player_props") gameLevelCandidates = [];
    }
    if (gameFilterTeams && gameFilterTeams.size > 0) {
      gameLevelCandidates = gameLevelCandidates.filter(c =>
        gameFilterTeams!.has(resolveToAbbr(c.home_team)) || gameFilterTeams!.has(resolveToAbbr(c.away_team))
      );
    }
    if (filters?.includeTeams?.length > 0) {
      const teams = new Set(filters.includeTeams.map((t: string) => t.toUpperCase()));
      gameLevelCandidates = gameLevelCandidates.filter(c =>
        teams.has(c.home_team.toUpperCase()) || teams.has(c.away_team.toUpperCase()) || (c.team && teams.has(c.team.toUpperCase()))
      );
    }
    if (filters?.excludeTeams?.length > 0) {
      const teams = new Set(filters.excludeTeams.map((t: string) => t.toUpperCase()));
      gameLevelCandidates = gameLevelCandidates.filter(c => !teams.has(c.home_team.toUpperCase()) && !teams.has(c.away_team.toUpperCase()));
    }
    debug.game_level_candidates = gameLevelCandidates.length;

    // Save game odds snapshots (fire-and-forget)
    if (gameLevelCandidates.length > 0) {
      const snapshotRows = gameLevelCandidates.map(c => ({
        game_date: todayStr, home_team: c.home_team, away_team: c.away_team,
        market_type: c.type === "moneyline" ? "h2h" : c.type,
        line: c.type === "spread" ? c.spread : c.type === "total" ? c.total_line : null,
        home_odds: c.type === "moneyline" && c.team === c.home_team ? c.odds : null,
        away_odds: c.type === "moneyline" && c.team === c.away_team ? c.odds : null,
        over_odds: c.type === "total" && c.pick === "Over" ? c.odds : null,
        under_odds: c.type === "total" && c.pick === "Under" ? c.odds : null,
        sportsbook: c.sportsbook,
      }));
      serviceClient.from("game_odds_snapshots").insert(snapshotRows)
        .then(({ error }) => { if (error) console.error("[AI-Builder] Game odds snapshot error:", error); });
    }

    // Check we have SOMETHING
    if (diversifiedCandidates.length === 0 && gameLevelCandidates.length === 0) {
      return new Response(
        JSON.stringify({
          error: "No verified market candidates available for today's games. Live sportsbook odds may not be available yet. Try again later or switch to game-level bets.",
          debug,
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch player availability for rejection
    const availabilityMap = new Map<string, { status: string; reason: string | null }>();
    {
      const { data: availRows } = await serviceClient.from("player_availability")
        .select("player_name, status, reason").eq("game_date", todayStr);
      for (const row of availRows || []) {
        availabilityMap.set(normName(row.player_name), { status: row.status, reason: row.reason });
      }
    }

    // Remove "out" players from candidates
    const preAvailCount = diversifiedCandidates.length;
    const finalCandidates = diversifiedCandidates.filter(c => {
      const avail = availabilityMap.get(normName(c.player_name));
      if (avail && avail.status === "out") {
        debug.excluded_candidates.push({ player: c.player_name, stat: `${c.stat_type} ${c.threshold}`, reason: `Player OUT: ${avail.reason || "injury"}` });
        return false;
      }
      return true;
    });
    if (finalCandidates.length < preAvailCount) {
      console.log(`[AI-Builder] Removed ${preAvailCount - finalCandidates.length} OUT players from candidates`);
    }

    // Fetch recent snapshots for movement detection
    const { data: recentSnapshots } = await serviceClient.from("line_snapshots")
      .select("player_name, stat_type, threshold, over_odds, under_odds, snapshot_at")
      .eq("game_date", todayStr).order("snapshot_at", { ascending: false }).limit(500);
    const snapshotsByProp = new Map<string, { over_odds: string | null; under_odds: string | null; snapshot_at: string }[]>();
    for (const s of recentSnapshots || []) {
      const key = `${s.player_name.toLowerCase()}|${s.stat_type}|${s.threshold}`;
      if (!snapshotsByProp.has(key)) snapshotsByProp.set(key, []);
      snapshotsByProp.get(key)!.push(s);
    }

    // ===== PHASE 4: BUILD LLM PROMPT WITH EXACT VERIFIED MARKET ENTRIES =====
    const candidatesToSend = finalCandidates.slice(0, MAX_VERIFIED_CANDIDATES_TO_LLM);
    debug.verified_candidates_passed_to_llm = candidatesToSend.length;
    debug.candidates_passed_to_llm = candidatesToSend.length;

    // Build EXACT-MATCH validation lookup keyed on normalized player|stat|threshold
    const verifiedCandidateByKey = new Map<string, VerifiedPropCandidate>();
    for (const c of candidatesToSend) {
      const key = `${normName(c.player_name)}|${normStat(c.stat_type)}|${c.threshold}`;
      verifiedCandidateByKey.set(key, c);
    }

    // Build the candidate summary — exact market entries with odds
    const candidateSummary = candidatesToSend.map(c => {
      const overLabel = c.best_over_odds ? `Over ${c.threshold} at ${c.best_over_book} ${c.best_over_odds}` : null;
      const underLabel = c.best_under_odds ? `Under ${c.threshold} at ${c.best_under_book} ${c.best_under_odds}` : null;
      return {
        player: c.player_name,
        team: c.team_abbr,
        opponent: c.opponent_abbr,
        stat: c.stat_type,
        stat_key: c.stat_key,
        threshold: c.threshold,
        over: overLabel,
        under: underLabel,
        books_count: c.books_count,
        books: c.books_seen,
        market_confidence: c.market_confidence,
        is_main_line: c.is_main_line,
        consensus_line: c.consensus_line,
        // Scoring context
        confidence: c.confidence_score,
        value: c.value_score,
        season_avg: c.season_avg,
        last5_avg: c.last5_avg,
        last10_avg: c.last10_avg,
        season_hit_rate: c.season_hit_rate != null ? `${Math.round(c.season_hit_rate * 100)}%` : null,
        last10_hit_rate: c.last10_hit_rate != null ? `${Math.round(c.last10_hit_rate * 100)}%` : null,
        last5_hit_rate: c.last5_hit_rate != null ? `${Math.round(c.last5_hit_rate * 100)}%` : null,
        vs_opponent: c.vs_opponent_games && c.vs_opponent_games > 0 ? {
          avg: c.vs_opponent_avg, hit_rate: c.vs_opponent_hit_rate != null ? `${Math.round(c.vs_opponent_hit_rate * 100)}%` : null, games: c.vs_opponent_games,
        } : null,
        home_away: c.home_away,
        total_games: c.total_games,
        tags: c.reason_tags,
        edge_over: c.edge_over,
        edge_under: c.edge_under,
      };
    });

    // Game-level candidates
    const gameCandidatesToSend = gameLevelCandidates.slice(0, MAX_GAME_CANDIDATES_TO_LLM);
    const gameCandidateByKey = new Map<string, GameLevelCandidate>();
    for (const gc of gameCandidatesToSend) {
      if (gc.type === "moneyline" && gc.team) gameCandidateByKey.set(`${gc.team.toLowerCase()}::moneyline`, gc);
      else if (gc.type === "spread" && gc.team) {
        gameCandidateByKey.set(`${gc.team.toLowerCase()}::spread::${gc.spread}`, gc);
        gameCandidateByKey.set(`${gc.team.toLowerCase()}::spread`, gc);
      } else if (gc.type === "total" && gc.pick) {
        gameCandidateByKey.set(`${gc.home_team.toLowerCase()}/${gc.away_team.toLowerCase()}::total::${gc.total_line}::${gc.pick.toLowerCase()}`, gc);
        gameCandidateByKey.set(`${gc.home_team.toLowerCase()}/${gc.away_team.toLowerCase()}::total::${gc.pick.toLowerCase()}`, gc);
      }
    }
    const gameCandidateSummary = gameCandidatesToSend.map(gc => ({
      type: gc.type, label: gc.label, home_team: gc.home_team, away_team: gc.away_team,
      team: gc.team || null, opponent: gc.opponent || null, spread: gc.spread ?? null,
      total_line: gc.total_line ?? null, pick: gc.pick || null, odds: gc.odds,
      implied_probability: gc.implied_probability != null ? `${Math.round(gc.implied_probability * 100)}%` : null,
      sportsbook: gc.sportsbook,
    }));

    debug.top_candidates = candidateSummary.slice(0, 20).map(c => ({
      player: c.player, stat: `${c.stat} ${c.threshold}`, confidence: c.confidence ?? 0, value: c.value ?? 0,
    }));

    console.log(`[AI-Builder] Passing ${candidateSummary.length} verified prop candidates + ${gameCandidateSummary.length} game candidates to LLM`);

    const oddsSummary = gamesData.slice(0, 8).map((game: any) => ({
      home: game.home_team, away: game.away_team, commence: game.commence_time,
    }));

    // ===== PHASE 4b: LLM PROMPT =====
    const diversityInstruction = slipCount > 1
      ? `\n\nIMPORTANT DIVERSITY RULE: Each slip MUST use a DIFFERENT set of players. Maximize player variety across slips.`
      : "";

    let candidateSection = "";
    if (candidateSummary.length > 0) {
      candidateSection = `\nVERIFIED PLAYER PROP MARKETS (${candidateSummary.length} exact entries — each is a real sportsbook market):
${JSON.stringify(candidateSummary, null, 1)}`;
    }

    let gameCandidateSection = "";
    if (gameCandidateSummary.length > 0) {
      gameCandidateSection = `\nGAME-LEVEL CANDIDATES (${gameCandidateSummary.length}):
${JSON.stringify(gameCandidateSummary, null, 1)}`;
    }

    const statTypeInstruction = gameCandidateSummary.length > 0
      ? `"stat_type": "Points" | "Rebounds" | "Assists" | "3-Pointers" | "Steals" | "Blocks" | "Moneyline" | "Spread" | "Total"`
      : `"stat_type": "Points" | "Rebounds" | "Assists" | "3-Pointers" | "Steals" | "Blocks"`;

    const gameRules = gameCandidateSummary.length > 0
      ? `
- For GAME-LEVEL legs (Moneyline, Spread, Total):
  - Set "player_name" to the TEAM NAME
  - Set "stat_type" to "Moneyline", "Spread", or "Total"
  - Set "line" to the pick description (e.g. "Celtics ML", "Celtics -4.5", "Over 220.5")
  - Set "pick" to the side (team name for ML, team name for spread, "Over"/"Under" for totals)
  - Set "odds" from the game candidate data
  - Set "bet_type" to "moneyline", "spread", or "total"
- You can MIX player props and game-level bets in the same slip`
      : "";

    const systemPrompt = `You are an NBA betting analyst for BetStreaks. You build structured bet slips using ONLY the verified market entries provided below.

CRITICAL RULES FOR PLAYER PROPS:
- You MUST select player props ONLY from the VERIFIED PLAYER PROP MARKETS list
- Each entry represents a REAL sportsbook market with verified odds
- You MUST use the EXACT player_name, stat_type, and threshold from the verified entry
- You MUST use the EXACT odds from the verified entry (the "over" or "under" field)
- Do NOT invent thresholds — the threshold must EXACTLY match a verified entry
- Do NOT modify or round thresholds
- For the "line" field, write "Over X.5" or "Under X.5" using the exact threshold from the verified entry
- For "odds", use the exact odds value from the entry's "over" or "under" field
- For "odds_source", use the sportsbook name from the entry
- Copy scoring data (season_avg, confidence, etc.) directly from the entry
- Never say "lock", "guaranteed", or "sure thing"
- Each slip has a risk_label: "safe", "balanced", or "aggressive"
- Do NOT use the same player more than once within a single slip${gameRules}${diversityInstruction}
${candidateSection}
${gameCandidateSection}

CURRENT GAMES:
${JSON.stringify(oddsSummary)}

Respond with ONLY valid JSON:
{
  "slips": [
    {
      "slip_name": "string",
      "risk_label": "safe" | "balanced" | "aggressive",
      "estimated_odds": "+150",
      "reasoning": "Brief overall reasoning",
      "legs": [
        {
          "player_name": "EXACT name from verified entry",
          "team_abbr": "string",
          ${statTypeInstruction},
          "line": "Over 24.5 (EXACT threshold from verified entry)",
          "pick": "Over" | "Under",
          "odds": "-110 (EXACT odds from verified entry)",
          "reasoning": "Reference actual data",
          "bet_type": "player_prop" | "moneyline" | "spread" | "total",
          "odds_source": "sportsbook name from verified entry",
          "data_context": {
            "season_avg": number from entry,
            "last5_avg": number from entry,
            "last10_hit_rate": "X%" from entry,
            "confidence_score": number from entry,
            "value_score": number from entry,
            "sample_size": total_games from entry,
            "odds_validated": true
          }
        }
      ]
    }
  ]
}`;

    let filterConstraints = "";
    if (filters) {
      const parts: string[] = [];
      if (filters.targetOdds) parts.push(`Target combined odds: ${filters.targetOdds}`);
      if (filters.legCount) parts.push(`Exactly ${filters.legCount} legs per slip`);
      if (filters.riskLevel) parts.push(`All slips must be risk_label: "${filters.riskLevel}"`);
      if (filters.overUnder === "over") parts.push("Use ONLY Over picks");
      if (filters.overUnder === "under") parts.push("Use ONLY Under picks");
      if (filters.sameGameOnly) parts.push("All legs must be from the SAME game");
      if (filters.crossGameOnly) parts.push("Each leg must be from a DIFFERENT game");
      if (filters.noRepeatPlayers) parts.push("Do NOT use the same player in multiple slips");
      if (filters.maxOnePerPlayer) parts.push("Max one leg per player in each slip");
      if (filters.maxOnePerTeam) parts.push("Max one leg per team in each slip");
      if (filters.diversifySlips) parts.push("Maximize diversity across slips");
      if (betType === "moneyline") parts.push("Use ONLY moneyline bets");
      if (betType === "spread") parts.push("Use ONLY spread bets");
      if (betType === "totals") parts.push("Use ONLY game totals bets");
      if (betType === "mixed") parts.push("Mix player props with game-level bets for combo parlays");
      if (parts.length > 0) filterConstraints = `\n\nUSER FILTER CONSTRAINTS (MUST follow):\n${parts.map(p => `- ${p}`).join("\n")}`;
    }

    const userPrompt = `Generate ${Math.min(slipCount, 5)} NBA bet slip(s) for: "${prompt}"

Use ONLY players/stats/thresholds from the verified market entries. Each slip should have ${filters?.legCount ? filters.legCount : "2-4"} legs.${filterConstraints}`;

    const aiRes = await fetch(AI_GATEWAY, {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!aiRes.ok) {
      if (aiRes.status === 429 || aiRes.status === 402) {
        console.log(`[AI-Builder] AI gateway ${aiRes.status} — building deterministic fallback slips`);

        // ===== DETERMINISTIC FALLBACK: build slips from scored candidates without LLM =====
        const legCount = filters?.legCount || 3;
        const requestedSlipCount = Math.min(slipCount, 5);

        // Sort candidates: confidence desc, then market_confidence desc
        const sortedCandidates = [...finalCandidates].sort((a, b) => {
          const confDiff = (b.confidence_score ?? 0) - (a.confidence_score ?? 0);
          if (confDiff !== 0) return confDiff;
          return b.market_confidence - a.market_confidence;
        });

        // Add game-level candidates sorted by implied probability
        const sortedGameCandidates = [...gameLevelCandidates].sort((a, b) =>
          (b.implied_probability ?? 0) - (a.implied_probability ?? 0)
        );

        const fallbackSlips: any[] = [];
        const usedPlayers = new Set<string>();

        for (let s = 0; s < requestedSlipCount && (sortedCandidates.length > 0 || sortedGameCandidates.length > 0); s++) {
          const slipLegs: any[] = [];
          const slipPlayers = new Set<string>();

          // Fill with player props first
          for (const c of sortedCandidates) {
            if (slipLegs.length >= legCount) break;
            const pKey = normName(c.player_name);
            if (slipPlayers.has(pKey)) continue;
            // For multi-slip diversity, skip players used in previous slips
            if (requestedSlipCount > 1 && usedPlayers.has(pKey) && sortedCandidates.length > legCount * requestedSlipCount) continue;

            // Pick the better side based on edge
            const pickOver = (c.edge_over ?? -999) >= (c.edge_under ?? -999);
            const pick = pickOver ? "Over" : "Under";
            const odds = pickOver ? c.best_over_odds : c.best_under_odds;

            const realContext: Record<string, any> = {
              season_avg: c.season_avg, last5_avg: c.last5_avg,
              confidence_score: c.confidence_score, value_score: c.value_score,
              sample_size: c.total_games, tags: c.reason_tags,
              odds_validated: true,
              odds_source: pickOver ? c.best_over_book : c.best_under_book,
              implied_probability: pickOver
                ? (c.implied_over != null ? Math.round(c.implied_over * 100) : null)
                : (c.implied_under != null ? Math.round(c.implied_under * 100) : null),
              best_over_odds: c.best_over_odds, best_under_odds: c.best_under_odds,
              market_confidence: c.market_confidence, consensus_line: c.consensus_line,
              books_count: c.books_count, is_main_line: c.is_main_line,
              edge: pickOver ? c.edge_over : c.edge_under,
              market_threshold: c.threshold,
            };
            if (c.last10_hit_rate != null) realContext.last10_hit_rate = `${Math.round(c.last10_hit_rate * 100)}%`;
            if (c.season_hit_rate != null) realContext.line_hit_rate = `${Math.round(c.season_hit_rate * 100)}% over ${c.total_games || "?"} games`;
            if (c.volatility_score != null) {
              realContext.volatility_label = c.volatility_score <= 30 ? "low" : c.volatility_score <= 60 ? "medium" : "high";
            }
            if (c.vs_opponent_games && c.vs_opponent_games > 0 && c.vs_opponent_hit_rate != null) {
              realContext.vs_opponent = `${Math.round(c.vs_opponent_hit_rate * 100)}% in ${c.vs_opponent_games} games`;
              realContext.vs_opponent_sample = c.vs_opponent_games;
            }

            slipLegs.push({
              player_name: c.player_name, team_abbr: c.team_abbr, stat_type: c.stat_type,
              line: `${pick} ${c.threshold}`, pick, odds: odds || null,
              reasoning: `Top-ranked by scoring engine (confidence: ${c.confidence_score ?? "N/A"}, market confidence: ${c.market_confidence}).`,
              bet_type: "player_prop", data_context: realContext,
            });
            slipPlayers.add(pKey);
            usedPlayers.add(pKey);
          }

          // Fill remaining with game-level candidates if needed
          if (slipLegs.length < legCount) {
            for (const gc of sortedGameCandidates) {
              if (slipLegs.length >= legCount) break;
              const gcKey = `${gc.type}|${gc.team || gc.home_team}`;
              if (slipPlayers.has(gcKey)) continue;
              slipLegs.push({
                player_name: gc.team || gc.home_team, team_abbr: gc.team || gc.home_team,
                stat_type: gc.type === "moneyline" ? "Moneyline" : gc.type === "spread" ? "Spread" : "Total",
                line: gc.label, pick: gc.pick || gc.team || gc.home_team, odds: gc.odds,
                reasoning: `Game-level pick from verified odds.`,
                bet_type: gc.type, data_context: {
                  odds_source: gc.sportsbook, implied_probability: gc.implied_probability != null ? Math.round(gc.implied_probability * 100) : null,
                  odds_validated: true, tags: [], home_team: gc.home_team, away_team: gc.away_team,
                  spread: gc.spread, total_line: gc.total_line, pick_side: gc.pick,
                },
              });
              slipPlayers.add(gcKey);
            }
          }

          if (slipLegs.length === 0) break;

          // Compute combined odds & risk label
          let combinedImplied = 1;
          for (const leg of slipLegs) {
            const impl = americanToImplied(leg.odds);
            if (impl) combinedImplied *= impl;
          }
          const americanOdds = combinedImplied > 0 && combinedImplied < 1
            ? (combinedImplied >= 0.5 ? `${Math.round(-100 * combinedImplied / (1 - combinedImplied))}` : `+${Math.round(100 * (1 - combinedImplied) / combinedImplied)}`)
            : null;

          const avgConf = slipLegs.reduce((sum, l) => sum + (l.data_context?.confidence_score ?? 50), 0) / slipLegs.length;
          const riskLabel = avgConf >= 60 ? "safe" : avgConf >= 40 ? "balanced" : "aggressive";

          fallbackSlips.push({
            slip_name: `Data-Driven Picks${requestedSlipCount > 1 ? ` #${s + 1}` : ""}`,
            risk_label: riskLabel, estimated_odds: americanOdds,
            reasoning: "Built from top-scored candidates using the scoring engine. AI formatting was temporarily unavailable.",
            legs: slipLegs,
          });
        }

        if (fallbackSlips.length === 0) {
          return new Response(JSON.stringify({ error: "AI service temporarily unavailable and no candidates available for fallback.", debug }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // Save fallback slips to DB (same as LLM path)
        const savedFallbackSlips = [];
        for (const slip of fallbackSlips) {
          const { data: slipRow, error: slipErr } = await supabase.from("ai_slips").insert({
            user_id: user?.id || null, prompt, slip_name: slip.slip_name,
            risk_label: slip.risk_label, estimated_odds: slip.estimated_odds, reasoning: slip.reasoning,
          }).select().single();
          if (slipErr) { console.error("[AI-Builder] Error saving fallback slip:", slipErr); continue; }

          const legs = slip.legs.map((leg: any, idx: number) => ({
            slip_id: slipRow.id, player_name: leg.player_name, team_abbr: leg.team_abbr,
            stat_type: leg.stat_type, line: leg.line, pick: leg.pick,
            odds: leg.odds, reasoning: leg.reasoning, leg_order: idx,
          }));
          const { data: legRows, error: legErr } = await supabase.from("ai_slip_legs").insert(legs).select();
          if (legErr) console.error("[AI-Builder] Error saving fallback legs:", legErr);

          const legsWithContext = (legRows || legs).map((lr: any, idx: number) => ({
            ...lr, data_context: slip.legs[idx]?.data_context || null,
            bet_type: slip.legs[idx]?.bet_type || "player_prop",
          }));
          savedFallbackSlips.push({ ...slipRow, legs: legsWithContext });
        }

        // Track usage
        if (user && !isPremium) {
          const today = new Date().toISOString().split("T")[0];
          supabase.from("ai_usage").upsert({ user_id: user.id, usage_date: today, request_count: 1 }, { onConflict: "user_id,usage_date" }).then(() => {});
        }

        console.log(`[AI-Builder] Fallback: built ${savedFallbackSlips.length} slips from scored candidates`);

        return new Response(JSON.stringify({
          slips: savedFallbackSlips, fallback: true, debug,
          scoring_metadata: {
            verified_prop_candidates: debug.verified_prop_candidates,
            verified_candidates_passed_to_llm: debug.verified_candidates_passed_to_llm,
            candidates_after_diversity: debug.candidates_after_diversity,
            unique_players: debug.unique_players_in_pool,
            legs_validated: savedFallbackSlips.reduce((s, sl) => s + sl.legs.length, 0),
            legs_rejected: 0, final_legs_accepted: savedFallbackSlips.reduce((s, sl) => s + sl.legs.length, 0),
            final_legs_rejected_no_match: 0,
            games_today: gamesData.length, live_props_found: livePropsCount,
            game_level_candidates: debug.game_level_candidates,
            mode: "deterministic_fallback", fallback_used: true,
            scoring_data_available: scoredProps.length,
          },
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const errText = await aiRes.text();
      console.error("[AI-Builder] AI gateway error:", aiRes.status, errText);
      throw new Error("AI generation failed");
    }

    const aiData = await aiRes.json();
    let content = aiData.choices?.[0]?.message?.content || "";
    content = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let parsed: { slips: any[] };
    try {
      parsed = JSON.parse(content);
    } catch {
      console.error("[AI-Builder] Failed to parse AI response:", content.substring(0, 500));
      throw new Error("AI returned invalid format");
    }

    // ===== PHASE 5: VALIDATE & ENRICH (strict exact-market matching for player props) =====
    const playersUsedAcrossSlips = new Map<string, number>();

    for (const slip of parsed.slips) {
      const validLegs: any[] = [];
      const playersInThisSlip = new Set<string>();

      for (const leg of slip.legs || []) {
        const legBetType = leg.bet_type || "player_prop";
        const isGameLevel = legBetType === "moneyline" || legBetType === "spread" || legBetType === "total";

        if (isGameLevel) {
          // ===== GAME-LEVEL VALIDATION (unchanged) =====
          const statNorm = normStat(leg.stat_type || "");
          let gameCand: GameLevelCandidate | undefined;

          const fuzzyFindGame = (marketType: string): GameLevelCandidate | undefined => {
            const identifiers = [leg.team_abbr, leg.player_name].filter(Boolean).map(s => s!.toLowerCase());
            for (const id of identifiers) {
              const exact = gameCandidateByKey.get(`${id}::${marketType}`);
              if (exact) return exact;
              const lastWord = id.split(" ").pop() || id;
              for (const [k, v] of gameCandidateByKey.entries()) {
                if (!k.includes(marketType)) continue;
                const keyTeam = k.split("::")[0];
                if (keyTeam === id || keyTeam === lastWord || keyTeam.includes(lastWord) || lastWord.includes(keyTeam)) return v;
              }
            }
            return undefined;
          };

          if (statNorm === "moneyline") gameCand = fuzzyFindGame("moneyline");
          else if (statNorm === "spread") gameCand = fuzzyFindGame("spread");
          else if (statNorm === "total") {
            gameCand = fuzzyFindGame("total");
            if (!gameCand) {
              for (const [k, v] of gameCandidateByKey.entries()) { if (k.includes("total")) { gameCand = v; break; } }
            }
          }

          if (!gameCand) {
            debug.legs_rejected++;
            debug.rejected_legs.push({ player: leg.player_name || "unknown", stat: leg.stat_type || "unknown", reason: `Game-level bet not found in candidates` });
            continue;
          }

          debug.legs_validated++;
          const realContext: Record<string, any> = {
            odds_source: gameCand.sportsbook,
            implied_probability: gameCand.implied_probability != null ? Math.round(gameCand.implied_probability * 100) : null,
            odds_validated: true, tags: [],
            home_team: gameCand.home_team, away_team: gameCand.away_team,
            opponent: gameCand.opponent || (gameCand.team === gameCand.home_team ? gameCand.away_team : gameCand.home_team),
            is_home: gameCand.team === gameCand.home_team,
            spread: gameCand.spread, total_line: gameCand.total_line, pick_side: gameCand.pick,
          };
          leg.data_context = realContext;
          leg.odds = gameCand.odds;
          leg.bet_type = legBetType;
          leg.team_abbr = leg.team_abbr || gameCand.team || gameCand.home_team;
          validLegs.push(leg);
          debug.final_legs_accepted++;
          continue;
        }

        // ===== PLAYER PROP VALIDATION — EXACT VERIFIED MARKET MATCH =====
        const playerNorm = normName(leg.player_name || "");
        const statNorm = normStat(leg.stat_type || "");

        // Skip duplicate player within same slip
        if (playersInThisSlip.has(playerNorm)) {
          debug.legs_rejected++;
          debug.rejected_legs.push({ player: leg.player_name || "unknown", stat: leg.stat_type || "unknown", reason: "Duplicate player within same slip" });
          continue;
        }

        // Parse threshold from leg.line (e.g. "Over 24.5" -> 24.5)
        const lineMatch = (leg.line || "").match(/([\d.]+)/);
        const legThreshold = lineMatch ? parseFloat(lineMatch[1]) : null;

        // Try exact key match first
        let verifiedCandidate: VerifiedPropCandidate | undefined;
        if (legThreshold != null) {
          const exactKey = `${playerNorm}|${statNorm}|${legThreshold}`;
          verifiedCandidate = verifiedCandidateByKey.get(exactKey);
        }

        // If no exact match, try with stat label
        if (!verifiedCandidate && legThreshold != null) {
          const statLabel = STAT_LABELS[statNorm] || leg.stat_type || "";
          const altKey = `${playerNorm}|${normStat(statLabel)}|${legThreshold}`;
          verifiedCandidate = verifiedCandidateByKey.get(altKey);
        }

        // If still no match, try fuzzy: same player + stat, closest threshold
        if (!verifiedCandidate) {
          let closestDist = Infinity;
          for (const [k, c] of verifiedCandidateByKey.entries()) {
            const parts = k.split("|");
            if (parts[0] === playerNorm && (parts[1] === statNorm || parts[1] === normStat(STAT_LABELS[statNorm] || ""))) {
              const dist = legThreshold != null ? Math.abs(c.threshold - legThreshold) : Infinity;
              if (dist <= 1.0 && dist < closestDist) { // Allow up to 1.0 threshold tolerance for rounding
                closestDist = dist;
                verifiedCandidate = c;
              }
            }
          }
          if (verifiedCandidate && closestDist > 0) {
            console.log(`[AI-Builder] Fuzzy threshold match: ${leg.player_name} ${leg.stat_type} ${legThreshold} → ${verifiedCandidate.threshold} (dist: ${closestDist})`);
          }
        }

        if (!verifiedCandidate) {
          debug.legs_rejected++;
          debug.final_legs_rejected_no_match++;
          debug.rejected_legs.push({
            player: leg.player_name || "unknown",
            stat: `${leg.stat_type || "unknown"} ${legThreshold ?? "?"}`,
            reason: `No exact verified market match found. Player prop requires a verified sportsbook entry with matching player/stat/threshold.`,
          });
          console.warn(`[AI-Builder] REJECTED (no verified market): ${leg.player_name} ${leg.stat_type} ${legThreshold}`);
          continue;
        }

        debug.legs_validated++;
        playersInThisSlip.add(playerNorm);
        playersUsedAcrossSlips.set(playerNorm, (playersUsedAcrossSlips.get(playerNorm) || 0) + 1);

        // Build data_context from verified candidate
        const pick = (leg.pick || "").toLowerCase();
        const overOdds = verifiedCandidate.best_over_odds;
        const underOdds = verifiedCandidate.best_under_odds;

        // Force odds from verified market (never use LLM odds)
        if (pick === "over" && overOdds) {
          leg.odds = overOdds;
        } else if (pick === "under" && underOdds) {
          leg.odds = underOdds;
        } else if (overOdds) {
          leg.odds = overOdds; // default to over
        }

        // Force threshold from verified market
        leg.line = `${pick === "under" ? "Under" : "Over"} ${verifiedCandidate.threshold}`;

        const realContext: Record<string, any> = {
          season_avg: verifiedCandidate.season_avg,
          last5_avg: verifiedCandidate.last5_avg,
          confidence_score: verifiedCandidate.confidence_score,
          value_score: verifiedCandidate.value_score,
          sample_size: verifiedCandidate.total_games,
          tags: verifiedCandidate.reason_tags,
          odds_validated: true,
          odds_source: pick === "under" ? verifiedCandidate.best_under_book : verifiedCandidate.best_over_book,
          implied_probability: pick === "under"
            ? (verifiedCandidate.implied_under != null ? Math.round(verifiedCandidate.implied_under * 100) : null)
            : (verifiedCandidate.implied_over != null ? Math.round(verifiedCandidate.implied_over * 100) : null),
          best_over_odds: verifiedCandidate.best_over_odds,
          best_under_odds: verifiedCandidate.best_under_odds,
          market_confidence: verifiedCandidate.market_confidence,
          consensus_line: verifiedCandidate.consensus_line,
          books_count: verifiedCandidate.books_count,
          is_main_line: verifiedCandidate.is_main_line,
          edge: pick === "under" ? verifiedCandidate.edge_under : verifiedCandidate.edge_over,
          market_threshold: verifiedCandidate.threshold,
        };

        if (verifiedCandidate.last10_hit_rate != null) realContext.last10_hit_rate = `${Math.round(verifiedCandidate.last10_hit_rate * 100)}%`;
        if (verifiedCandidate.season_hit_rate != null) realContext.line_hit_rate = `${Math.round(verifiedCandidate.season_hit_rate * 100)}% over ${verifiedCandidate.total_games || "?"} games`;

        if (verifiedCandidate.volatility_score != null) {
          realContext.volatility_label = verifiedCandidate.volatility_score <= 30 ? "low" : verifiedCandidate.volatility_score <= 60 ? "medium" : "high";
        }
        if (verifiedCandidate.vs_opponent_games && verifiedCandidate.vs_opponent_games > 0 && verifiedCandidate.vs_opponent_hit_rate != null) {
          realContext.vs_opponent = `${Math.round(verifiedCandidate.vs_opponent_hit_rate * 100)}% in ${verifiedCandidate.vs_opponent_games} games`;
          realContext.vs_opponent_sample = verifiedCandidate.vs_opponent_games;
        }
        if (verifiedCandidate.home_away === "home" && verifiedCandidate.home_hit_rate != null) {
          realContext.home_away_split = `${Math.round(verifiedCandidate.home_hit_rate * 100)}% at home in ${verifiedCandidate.home_games || "?"} games`;
          realContext.home_away_sample = verifiedCandidate.home_games;
        } else if (verifiedCandidate.away_hit_rate != null) {
          realContext.home_away_split = `${Math.round(verifiedCandidate.away_hit_rate * 100)}% away in ${verifiedCandidate.away_games || "?"} games`;
          realContext.home_away_sample = verifiedCandidate.away_games;
        }

        // Movement detection
        const snapKey = `${normName(verifiedCandidate.player_name)}|${verifiedCandidate.stat_type}|${verifiedCandidate.threshold}`;
        const propSnapshots = snapshotsByProp.get(snapKey) || [];
        const movementWarning = detectExtremeMovement(
          pick === "over" ? verifiedCandidate.best_over_odds : verifiedCandidate.best_under_odds,
          propSnapshots, pick === "over" ? "over" : "under"
        );
        if (movementWarning) realContext.market_note = movementWarning;

        if (verifiedCandidate.alt_line_flag) {
          realContext.market_note = (realContext.market_note ? realContext.market_note + " | " : "") +
            `⚠ Possible alt line — consensus main at ${verifiedCandidate.consensus_line}`;
        }

        leg.data_context = realContext;
        leg.team_abbr = leg.team_abbr || verifiedCandidate.team_abbr;
        leg.bet_type = "player_prop";

        validLegs.push(leg);
        debug.final_legs_accepted++;
      }

      slip.legs = validLegs;
    }

    // Remove slips with 0 valid legs
    parsed.slips = parsed.slips.filter((s: any) => s.legs && s.legs.length > 0);

    console.log(`[AI-Builder] Validation complete: ${debug.legs_validated} passed, ${debug.legs_rejected} rejected, ${debug.final_legs_rejected_no_match} no verified match`);
    if (debug.rejected_legs.length > 0) console.log(`[AI-Builder] Rejected:`, JSON.stringify(debug.rejected_legs));

    if (parsed.slips.length === 0) {
      const marketRejections = debug.rejected_legs.filter(r =>
        r.reason.includes("No exact verified market") || r.reason.includes("No live sportsbook") || r.reason.includes("Market")
      );
      const isMarketIssue = marketRejections.length > debug.rejected_legs.length * 0.5;
      const errorMsg = isMarketIssue
        ? `Live market verification was not available for enough player props to build a slip. ${marketRejections.length} prop(s) were rejected because no matching verified sportsbook market was found. Try again later when markets are open, or switch to game-level bets.`
        : "AI could not build valid slips from today's verified candidates. Try a different prompt or adjust your filters.";

      return new Response(
        JSON.stringify({ error: errorMsg, debug }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ===== PHASE 6: Save to database =====
    const savedSlips = [];
    for (const slip of parsed.slips) {
      const { data: slipRow, error: slipErr } = await supabase.from("ai_slips").insert({
        user_id: user?.id || null, prompt, slip_name: slip.slip_name,
        risk_label: slip.risk_label, estimated_odds: slip.estimated_odds, reasoning: slip.reasoning,
      }).select().single();

      if (slipErr) { console.error("[AI-Builder] Error saving slip:", slipErr); continue; }

      const legs = (slip.legs || []).map((leg: any, idx: number) => ({
        slip_id: slipRow.id, player_name: leg.player_name, team_abbr: leg.team_abbr,
        stat_type: leg.stat_type, line: leg.line, pick: leg.pick,
        odds: leg.odds, reasoning: leg.reasoning, leg_order: idx,
      }));

      const { data: legRows, error: legErr } = await supabase.from("ai_slip_legs").insert(legs).select();
      if (legErr) console.error("[AI-Builder] Error saving legs:", legErr);

      const legsWithContext = (legRows || legs).map((lr: any, idx: number) => ({
        ...lr, data_context: slip.legs?.[idx]?.data_context || null,
        bet_type: slip.legs?.[idx]?.bet_type || "player_prop",
      }));

      savedSlips.push({ ...slipRow, legs: legsWithContext });
    }

    // Track usage
    if (user && !isPremium) {
      const today = new Date().toISOString().split("T")[0];
      supabase.from("ai_usage").upsert({ user_id: user.id, usage_date: today, request_count: 1 }, { onConflict: "user_id,usage_date" }).then(() => {});
    }

    return new Response(JSON.stringify({
      slips: savedSlips,
      debug,
      scoring_metadata: {
        verified_prop_candidates: debug.verified_prop_candidates,
        verified_candidates_passed_to_llm: debug.verified_candidates_passed_to_llm,
        candidates_after_diversity: debug.candidates_after_diversity,
        unique_players: debug.unique_players_in_pool,
        legs_validated: debug.legs_validated,
        legs_rejected: debug.legs_rejected,
        final_legs_accepted: debug.final_legs_accepted,
        final_legs_rejected_no_match: debug.final_legs_rejected_no_match,
        games_today: gamesData.length,
        live_props_found: livePropsCount,
        game_level_candidates: debug.game_level_candidates,
        mode: debug.mode,
        fallback_used: debug.fallback_used,
        scoring_data_available: scoredProps.length,
      },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[AI-Builder] Error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error", debug }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
