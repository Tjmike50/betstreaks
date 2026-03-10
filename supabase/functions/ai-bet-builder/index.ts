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
const MAX_CANDIDATES_TO_LLM = 100;
const MAX_GAME_CANDIDATES_TO_LLM = 30;

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

  if (overNum != null && overNum < -800) {
    return { valid: false, reason: `Over odds ${overOdds} too extreme — likely alt line` };
  }
  if (underNum != null && underNum < -800) {
    return { valid: false, reason: `Under odds ${underOdds} too extreme — likely alt line` };
  }

  if (overNum != null && underNum != null) {
    const diff = Math.abs(overNum - underNum);
    if (diff > 500) {
      return { valid: false, reason: `Odds spread too wide: ${overOdds}/${underOdds} (diff ${diff})` };
    }
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
  // Market normalization fields
  is_main_line: boolean;
  consensus_line: number | null;
  market_confidence: number;         // 0-100
  books_with_line: number;
  odds_balance_score: number | null;  // how close over/under are to balanced
  alt_line_flag: boolean;
  edge: number | null;               // % edge vs implied probability
}

/** Compute how balanced over/under odds are (lower = more balanced = more likely main line) */
function oddsImbalance(overOdds: string | null, underOdds: string | null): number | null {
  const overImpl = americanToImplied(overOdds);
  const underImpl = americanToImplied(underOdds);
  if (overImpl == null || underImpl == null) return null;
  // Perfect balanced line: both ~0.5 implied. Imbalance = distance from equal split.
  return Math.abs(overImpl - underImpl);
}

/** Identify if a threshold is likely an alt line when a more balanced threshold exists */
function isLikelyAltLine(
  imbalance: number | null,
  allThresholdsForPlayerStat: { threshold: number; imbalance: number | null; booksCount: number }[],
  currentThreshold: number
): boolean {
  if (imbalance == null) return false;
  // If this line is very imbalanced (one side heavy favorite)
  if (imbalance > 0.35) {
    // Check if a more balanced line exists for same player/stat
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
  // Step 1: Group by player|stat|threshold
  const grouped = new Map<string, typeof liveProps>();
  for (const prop of liveProps) {
    const key = `${prop.player_name.toLowerCase()}|${prop.stat_type}|${prop.threshold}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(prop);
  }

  // Step 2: Build per-threshold aggregates
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

  // Group by player|stat to compare thresholds
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
        if (bestOverOdds == null || overNum > bestOverOdds) {
          bestOverOdds = overNum;
          bestOverBook = e.sportsbook;
        }
      }
      if (underNum != null) {
        underOddsList.push(underNum);
        if (bestUnderOdds == null || underNum > bestUnderOdds) {
          bestUnderOdds = underNum;
          bestUnderBook = e.sportsbook;
        }
      }
    }

    // Compute median odds
    const median = (arr: number[]) => {
      if (arr.length === 0) return null;
      const sorted = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
    };

    const imbalance = oddsImbalance(
      bestOverOdds != null ? String(bestOverOdds) : null,
      bestUnderOdds != null ? String(bestUnderOdds) : null
    );

    const agg: ThresholdAgg = {
      threshold,
      entries,
      booksCount: booksSeen.size,
      books: booksSeen,
      bestOverOdds,
      bestOverBook,
      bestUnderOdds,
      bestUnderBook,
      medianOver: median(overOddsList),
      medianUnder: median(underOddsList),
      imbalance,
    };

    if (!byPlayerStat.has(psKey)) byPlayerStat.set(psKey, []);
    byPlayerStat.get(psKey)!.push(agg);
  }

  // Step 3: For each player/stat, detect main line and compute market confidence
  const bestLines = new Map<string, BestLineEntry>();

  for (const [psKey, thresholds] of byPlayerStat) {
    // Sort by: books count desc, then imbalance asc (most balanced first)
    const thresholdSummaries = thresholds.map(t => ({
      threshold: t.threshold,
      imbalance: t.imbalance,
      booksCount: t.booksCount,
    }));

    // Find the consensus main line: most books offering it, with most balanced odds
    const mainLineCandidates = [...thresholds].sort((a, b) => {
      // Primary: more books = more likely main
      if (b.booksCount !== a.booksCount) return b.booksCount - a.booksCount;
      // Secondary: more balanced odds = more likely main
      const aImb = a.imbalance ?? 1;
      const bImb = b.imbalance ?? 1;
      return aImb - bImb;
    });

    const mainLine = mainLineCandidates[0];
    const consensusThreshold = mainLine.threshold;

    for (const t of thresholds) {
      const key = `${psKey}|${t.threshold}`;
      const firstEntry = t.entries[0];

      // Determine if this threshold is an alt line
      const isAlt = isLikelyAltLine(t.imbalance, thresholdSummaries, t.threshold);
      const isMain = t.threshold === consensusThreshold && !isAlt;

      // Compute market confidence (0-100)
      let marketConfidence = 0;
      // Books factor: 1 book = 20, 2 = 45, 3 = 70, 4+ = 85
      const booksFactor = Math.min(t.booksCount * 22, 85);
      marketConfidence += booksFactor;
      // Balance factor: well-balanced odds = +15
      if (t.imbalance != null && t.imbalance < 0.15) marketConfidence += 15;
      else if (t.imbalance != null && t.imbalance < 0.25) marketConfidence += 8;
      // Main line bonus
      if (isMain) marketConfidence += 5;
      // Penalty for likely alt
      if (isAlt) marketConfidence -= 30;
      // Cap at 100
      marketConfidence = Math.max(0, Math.min(100, marketConfidence));

      // Sanity check
      const sanity = isOddsSane(
        t.bestOverOdds != null ? String(t.bestOverOdds) : null,
        t.bestUnderOdds != null ? String(t.bestUnderOdds) : null,
        t.threshold,
        firstEntry.stat_type
      );

      // Additional sanity: reject if only 1 book AND very imbalanced (strong alt signal)
      let finalValid = sanity.valid;
      let finalReason = sanity.reason;
      if (t.booksCount === 1 && t.imbalance != null && t.imbalance > 0.4) {
        finalValid = false;
        finalReason = `Single-book prop with heavy imbalance (${Math.round(t.imbalance * 100)}%) — likely alt line`;
      }
      // Reject if flagged as alt line with extreme juice
      if (isAlt && t.imbalance != null && t.imbalance > 0.5) {
        finalValid = false;
        finalReason = `Alt line detected: imbalance ${Math.round(t.imbalance * 100)}%, consensus main at ${consensusThreshold}`;
      }
      // Reject if missing one side of over/under
      if (t.bestOverOdds == null && t.bestUnderOdds == null) {
        finalValid = false;
        finalReason = "No odds available for either side";
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
        edge: null, // computed during validation
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
  if (diff > 300) {
    return `Extreme odds movement: ${oldOdds} → ${currentOdds} (${diff}pt shift)`;
  }
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

// ===== GAME-LEVEL ODDS PARSING =====

interface GameLevelCandidate {
  type: "moneyline" | "spread" | "total";
  home_team: string;
  away_team: string;
  team?: string;        // for ML & spread: which side
  opponent?: string;    // the other side
  spread?: number;      // for spread
  total_line?: number;  // for totals
  pick?: string;        // "Over" | "Under" for totals
  odds: string;
  sportsbook: string;
  label: string;        // human-readable label
  implied_probability: number | null;
}

function parseGameLevelOdds(gamesData: any[]): GameLevelCandidate[] {
  const candidates: GameLevelCandidate[] = [];
  // Track best odds per unique bet for dedup across books
  const bestByKey = new Map<string, GameLevelCandidate>();

  for (const game of gamesData) {
    const homeTeam = game.home_team || "";
    const awayTeam = game.away_team || "";
    // Extract short abbreviations
    const homeAbbr = homeTeam.split(" ").pop() || homeTeam;
    const awayAbbr = awayTeam.split(" ").pop() || awayTeam;

    for (const bm of game.bookmakers || []) {
      for (const market of bm.markets || []) {
        if (market.key === "h2h") {
          // Moneyline
          for (const outcome of market.outcomes || []) {
            const isHome = outcome.name === homeTeam;
            const team = isHome ? homeAbbr : awayAbbr;
            const opponent = isHome ? awayAbbr : homeAbbr;
            const odds = String(outcome.price);
            const key = `ml|${team}`;
            const implied = americanToImplied(outcome.price);
            const existing = bestByKey.get(key);
            const existingOdds = existing ? parseInt(existing.odds, 10) : -Infinity;
            const newOdds = parseInt(odds, 10);
            if (!existing || newOdds > existingOdds) {
              bestByKey.set(key, {
                type: "moneyline",
                home_team: homeAbbr,
                away_team: awayAbbr,
                team,
                opponent,
                odds,
                sportsbook: bm.key,
                label: `${team} ML`,
                implied_probability: implied,
              });
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
            const newOdds = parseInt(odds, 10);
            if (!existing || newOdds > existingOdds) {
              bestByKey.set(key, {
                type: "spread",
                home_team: homeAbbr,
                away_team: awayAbbr,
                team,
                opponent,
                spread: spreadVal,
                odds,
                sportsbook: bm.key,
                label: `${team} ${spreadVal > 0 ? "+" : ""}${spreadVal}`,
                implied_probability: implied,
              });
            }
          }
        } else if (market.key === "totals") {
          for (const outcome of market.outcomes || []) {
            const totalLine = outcome.point;
            const pick = outcome.name; // "Over" or "Under"
            const odds = String(outcome.price);
            const key = `total|${homeAbbr}v${awayAbbr}|${totalLine}|${pick}`;
            const implied = americanToImplied(outcome.price);
            const existing = bestByKey.get(key);
            const existingOdds = existing ? parseInt(existing.odds, 10) : -Infinity;
            const newOdds = parseInt(odds, 10);
            if (!existing || newOdds > existingOdds) {
              bestByKey.set(key, {
                type: "total",
                home_team: homeAbbr,
                away_team: awayAbbr,
                total_line: totalLine,
                pick,
                odds,
                sportsbook: bm.key,
                label: `${homeAbbr}/${awayAbbr} ${pick} ${totalLine}`,
                implied_probability: implied,
              });
            }
          }
        }
      }
    }
  }

  return [...bestByKey.values()];
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
  mode: "scored_candidates" | "fallback_mode";
  live_props_found: number;
  game_level_candidates: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const debug: DebugInfo = {
    db_candidates_found: 0,
    db_query_date: "",
    fallback_used: false,
    fallback_reason: null,
    candidates_after_diversity: 0,
    candidates_passed_to_llm: 0,
    unique_players_in_pool: 0,
    top_candidates: [],
    excluded_candidates: [],
    legs_validated: 0,
    legs_rejected: 0,
    rejected_legs: [],
    scoring_engine_called: false,
    mode: "scored_candidates",
    live_props_found: 0,
    game_level_candidates: 0,
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
      const { data: flags } = await supabase
        .from("user_flags")
        .select("is_premium")
        .eq("user_id", user.id)
        .single();
      isPremium = flags?.is_premium ?? false;

      if (!isPremium) {
        const today = new Date().toISOString().split("T")[0];
        const { data: usage } = await supabase
          .from("ai_usage")
          .select("request_count")
          .eq("user_id", user.id)
          .eq("usage_date", today)
          .single();

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

    // Determine which bet types to include based on filter
    const betType = filters?.betType || null;
    const includePlayerProps = !betType || betType === "player_props" || betType === "mixed";
    const includeGameLevel = !betType || betType === "moneyline" || betType === "spread" || betType === "totals" || betType === "mixed";

    // ===== PHASE 1: Get pre-scored candidates from player_prop_scores =====
    let scoredProps: any[] = [];
    
    if (includePlayerProps) {
      console.log(`[AI-Builder] Fetching scored candidates for ${todayStr}...`);
      
      const { data: dbCandidates, error: dbErr } = await serviceClient
        .from("player_prop_scores")
        .select("*")
        .eq("game_date", todayStr)
        .order("confidence_score", { ascending: false })
        .limit(200);

      if (dbErr) {
        console.error("[AI-Builder] DB candidates error:", dbErr);
      }

      scoredProps = dbCandidates || [];
      debug.db_candidates_found = scoredProps.length;
      console.log(`[AI-Builder] Found ${scoredProps.length} raw candidates for ${todayStr}`);

      // If no DB candidates for today, try yesterday
      if (scoredProps.length === 0) {
        const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
        console.log(`[AI-Builder] No candidates for today, trying ${yesterday}...`);
        
        const { data: yestCandidates } = await serviceClient
          .from("player_prop_scores")
          .select("*")
          .eq("game_date", yesterday)
          .order("confidence_score", { ascending: false })
          .limit(200);
        
        if (yestCandidates && yestCandidates.length > 0) {
          scoredProps = yestCandidates;
          debug.fallback_used = true;
          debug.fallback_reason = `No candidates for ${todayStr}, using ${yestCandidates.length} from ${yesterday}`;
          debug.mode = "fallback_mode";
          console.log(`[AI-Builder] Fallback: ${scoredProps.length} candidates from yesterday`);
        }
      }

      // If still none, call scoring engine
      if (scoredProps.length === 0) {
        console.log("[AI-Builder] No DB candidates — calling scoring engine...");
        debug.scoring_engine_called = true;
        
        try {
          const scoringRes = await fetch(`${SUPABASE_URL}/functions/v1/prop-scoring-engine`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            },
            body: JSON.stringify({ top_n: 60 }),
          });
          
          if (scoringRes.ok) {
            const scoringData = await scoringRes.json();
            scoredProps = scoringData.scored_props || [];
            debug.fallback_used = true;
            debug.fallback_reason = `Called scoring engine, got ${scoredProps.length} props`;
            debug.mode = "fallback_mode";
          } else {
            console.error("[AI-Builder] Scoring engine error:", scoringRes.status);
          }
        } catch (e) {
          console.error("[AI-Builder] Scoring engine failed:", e);
        }
      }
    }

    // ===== PHASE 1b: APPLY USER FILTERS before diversity cap =====
    let filteredProps = [...scoredProps];

    if (filters && includePlayerProps) {
      const f = filters;

      if (f.statTypes && f.statTypes.length > 0) {
        const allowedStats = new Set(f.statTypes.map((s: string) => normStat(s)));
        filteredProps = filteredProps.filter((p: any) => allowedStats.has(normStat(p.stat_type)));
        console.log(`[AI-Builder] After stat filter: ${filteredProps.length}`);
      }

      if (f.includeTeams && f.includeTeams.length > 0) {
        const teams = new Set(f.includeTeams.map((t: string) => t.toUpperCase()));
        filteredProps = filteredProps.filter((p: any) => teams.has((p.team_abbr || "").toUpperCase()));
      }
      if (f.excludeTeams && f.excludeTeams.length > 0) {
        const teams = new Set(f.excludeTeams.map((t: string) => t.toUpperCase()));
        filteredProps = filteredProps.filter((p: any) => !teams.has((p.team_abbr || "").toUpperCase()));
      }

      if (f.includePlayers && f.includePlayers.length > 0) {
        const players = new Set(f.includePlayers.map((n: string) => normName(n)));
        filteredProps = filteredProps.filter((p: any) => players.has(normName(p.player_name)));
      }
      if (f.excludePlayers && f.excludePlayers.length > 0) {
        const players = new Set(f.excludePlayers.map((n: string) => normName(n)));
        filteredProps = filteredProps.filter((p: any) => !players.has(normName(p.player_name)));
      }

      if (f.minConfidence != null) {
        filteredProps = filteredProps.filter((p: any) => (p.confidence_score ?? 0) >= f.minConfidence);
      }
      if (f.minHitRate != null) {
        filteredProps = filteredProps.filter((p: any) => {
          const hitRate = p.season_hit_rate != null ? p.season_hit_rate * 100 : 0;
          return hitRate >= f.minHitRate;
        });
      }
      if (f.maxVolatility != null) {
        filteredProps = filteredProps.filter((p: any) => (p.volatility_score ?? 100) <= f.maxVolatility);
      }
      if (f.minSampleSize != null) {
        filteredProps = filteredProps.filter((p: any) => (p.total_games ?? 0) >= f.minSampleSize);
      }
      if (f.startersOnly) {
        filteredProps = filteredProps.filter((p: any) => {
          const tags = p.reason_tags || [];
          return tags.some((t: string) => t.toLowerCase().includes("starter") || t.toLowerCase().includes("high_usage"));
        });
      }
      if (f.avoidUncertainLineups) {
        filteredProps = filteredProps.filter((p: any) => {
          const tags = p.reason_tags || [];
          return !tags.some((t: string) => t.toLowerCase().includes("uncertain") || t.toLowerCase().includes("questionable"));
        });
      }

      console.log(`[AI-Builder] After user filters: ${filteredProps.length} candidates`);
    }

    // ===== PHASE 1c: DIVERSITY CAP — max N props per player =====
    const playerPropCount = new Map<string, number>();
    const diversifiedProps: any[] = [];

    for (const p of filteredProps) {
      const pKey = normName(p.player_name);
      const count = playerPropCount.get(pKey) || 0;
      if (count >= MAX_CANDIDATES_PER_PLAYER) {
        debug.excluded_candidates.push({
          player: p.player_name,
          stat: `${p.stat_type} ${p.threshold}`,
          reason: `Diversity cap: already have ${MAX_CANDIDATES_PER_PLAYER} props for this player`,
        });
        continue;
      }
      playerPropCount.set(pKey, count + 1);
      diversifiedProps.push(p);
    }

    debug.candidates_after_diversity = diversifiedProps.length;
    const uniquePlayers = new Set(diversifiedProps.map(p => normName(p.player_name)));
    debug.unique_players_in_pool = uniquePlayers.size;

    console.log(`[AI-Builder] After diversity cap: ${diversifiedProps.length} candidates from ${uniquePlayers.size} unique players (was ${filteredProps.length})`);

    // ===== PHASE 2: Fetch live odds for market context (MULTI-BOOK) =====
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

    // ===== PHASE 2b: Parse game-level odds (ML, spread, totals) =====
    let gameLevelCandidates = parseGameLevelOdds(gamesData);

    // Filter game-level candidates by betType
    if (betType && betType !== "mixed") {
      if (betType === "moneyline") {
        gameLevelCandidates = gameLevelCandidates.filter(c => c.type === "moneyline");
      } else if (betType === "spread") {
        gameLevelCandidates = gameLevelCandidates.filter(c => c.type === "spread");
      } else if (betType === "totals") {
        gameLevelCandidates = gameLevelCandidates.filter(c => c.type === "total");
      } else if (betType === "player_props") {
        gameLevelCandidates = []; // No game-level for props-only
      }
    }

    // Apply team filters to game-level candidates too
    if (filters?.includeTeams?.length > 0) {
      const teams = new Set(filters.includeTeams.map((t: string) => t.toUpperCase()));
      gameLevelCandidates = gameLevelCandidates.filter(c => 
        teams.has(c.home_team.toUpperCase()) || teams.has(c.away_team.toUpperCase()) ||
        (c.team && teams.has(c.team.toUpperCase()))
      );
    }
    if (filters?.excludeTeams?.length > 0) {
      const teams = new Set(filters.excludeTeams.map((t: string) => t.toUpperCase()));
      gameLevelCandidates = gameLevelCandidates.filter(c => 
        !teams.has(c.home_team.toUpperCase()) && !teams.has(c.away_team.toUpperCase())
      );
    }

    debug.game_level_candidates = gameLevelCandidates.length;
    console.log(`[AI-Builder] Game-level candidates: ${gameLevelCandidates.length} (betType: ${betType || "any"})`);

    // Save game odds snapshots (fire-and-forget)
    if (gameLevelCandidates.length > 0) {
      const snapshotRows = gameLevelCandidates.map(c => ({
        game_date: todayStr,
        home_team: c.home_team,
        away_team: c.away_team,
        market_type: c.type === "moneyline" ? "h2h" : c.type,
        line: c.type === "spread" ? c.spread : c.type === "total" ? c.total_line : null,
        home_odds: c.type === "moneyline" && c.team === c.home_team ? c.odds : null,
        away_odds: c.type === "moneyline" && c.team === c.away_team ? c.odds : null,
        over_odds: c.type === "total" && c.pick === "Over" ? c.odds : null,
        under_odds: c.type === "total" && c.pick === "Under" ? c.odds : null,
        sportsbook: c.sportsbook,
      }));
      serviceClient
        .from("game_odds_snapshots")
        .insert(snapshotRows)
        .then(({ error }) => { if (error) console.error("[AI-Builder] Game odds snapshot error:", error); });
    }

    // Check we have SOMETHING to work with
    if (diversifiedProps.length === 0 && gameLevelCandidates.length === 0) {
      return new Response(
        JSON.stringify({ 
          error: "No candidates available for today's games. Data may not have been refreshed yet.",
          debug,
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch player props from multiple sportsbooks
    let livePropsCount = 0;
    const lineSnapshotRows: any[] = [];
    const allLiveProps: { player_name: string; stat_type: string; threshold: number; over_odds: string | null; under_odds: string | null; sportsbook: string }[] = [];

    if (includePlayerProps) {
      for (const game of gamesData.slice(0, 5)) {
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
                    const row = {
                      player_name: entry.player,
                      stat_type: statType,
                      threshold: entry.point,
                      over_odds: entry.over || null,
                      under_odds: entry.under || null,
                      sportsbook: bm.key,
                      game_date: todayStr,
                    };
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
    console.log(`[AI-Builder] Live props found: ${livePropsCount} across ${BOOKMAKERS}`);

    // Aggregate best lines across books
    let bestLines = aggregateBestLines(allLiveProps);
    let sanityRejected = 0;
    for (const bl of bestLines.values()) {
      if (!bl.odds_validated) sanityRejected++;
    }
    console.log(`[AI-Builder] Best lines: ${bestLines.size} unique props, ${sanityRejected} failed sanity check`);

    // ===== SNAPSHOT FALLBACK: If live odds fetch failed, use line_snapshots =====
    if (bestLines.size === 0 && includePlayerProps) {
      console.log("[AI-Builder] No live odds — falling back to line_snapshots...");
      const { data: snapshotFallback } = await serviceClient
        .from("line_snapshots")
        .select("player_name, stat_type, threshold, over_odds, under_odds, sportsbook")
        .eq("game_date", todayStr)
        .order("snapshot_at", { ascending: false })
        .limit(800);

      if (snapshotFallback && snapshotFallback.length > 0) {
        const fallbackProps = snapshotFallback.map((s: any) => ({
          player_name: s.player_name,
          stat_type: s.stat_type,
          threshold: Number(s.threshold),
          over_odds: s.over_odds,
          under_odds: s.under_odds,
          sportsbook: s.sportsbook || "snapshot",
        }));
        bestLines = aggregateBestLines(fallbackProps);
        console.log(`[AI-Builder] Snapshot fallback: ${bestLines.size} unique props from ${snapshotFallback.length} snapshots`);
      }
    }

    // Build secondary index: player|stat (no threshold) -> BestLineEntry[] for fuzzy matching
    const bestLinesByPlayerStat = new Map<string, BestLineEntry[]>();
    for (const bl of bestLines.values()) {
      const psKey = `${bl.player_name.toLowerCase()}|${bl.stat_type}`;
      if (!bestLinesByPlayerStat.has(psKey)) bestLinesByPlayerStat.set(psKey, []);
      bestLinesByPlayerStat.get(psKey)!.push(bl);
    }

    // Fetch recent snapshots for movement detection
    const { data: recentSnapshots } = await serviceClient
      .from("line_snapshots")
      .select("player_name, stat_type, threshold, over_odds, under_odds, snapshot_at")
      .eq("game_date", todayStr)
      .order("snapshot_at", { ascending: false })
      .limit(500);

    const snapshotsByProp = new Map<string, { over_odds: string | null; under_odds: string | null; snapshot_at: string }[]>();
    for (const s of recentSnapshots || []) {
      const key = `${s.player_name.toLowerCase()}|${s.stat_type}|${s.threshold}`;
      if (!snapshotsByProp.has(key)) snapshotsByProp.set(key, []);
      snapshotsByProp.get(key)!.push(s);
    }

    // Save line snapshots (fire-and-forget)
    if (lineSnapshotRows.length > 0) {
      serviceClient
        .from("line_snapshots")
        .insert(lineSnapshotRows)
        .then(({ error }) => { if (error) console.error("[AI-Builder] Line snapshot insert error:", error); });
    }

    const oddsSummary = gamesData.slice(0, 8).map((game: any) => ({
      home: game.home_team,
      away: game.away_team,
      commence: game.commence_time,
    }));

    // ===== PHASE 3: Build candidate summary for LLM =====
    const candidatesToSend = diversifiedProps.slice(0, MAX_CANDIDATES_TO_LLM);

    // Build validation lookup keyed on normalized player+stat
    const candidateByKey = new Map<string, any>();

    const candidateSummary = candidatesToSend.map((p: any) => {
      const statLabel = STAT_LABELS[p.stat_type] || p.stat_type;
      const normPlayer = normName(p.player_name);
      const normStatKey = normStat(p.stat_type);
      
      const key1 = `${normPlayer}::${normStatKey}`;
      const key2 = `${normPlayer}::${statLabel.toLowerCase()}`;
      const key3 = `${normPlayer}::${normStatKey}::${p.threshold}`;
      candidateByKey.set(key1, p);
      candidateByKey.set(key2, p);
      candidateByKey.set(key3, p);

      return {
        player: p.player_name,
        team: p.team_abbr,
        opponent: p.opponent_abbr,
        home_away: p.home_away,
        stat: statLabel,
        stat_key: p.stat_type,
        line: p.threshold,
        confidence: p.confidence_score,
        value: p.value_score,
        volatility: p.volatility_score,
        consistency: p.consistency_score,
        season_avg: p.season_avg,
        last3_avg: p.last3_avg,
        last5_avg: p.last5_avg,
        last10_avg: p.last10_avg,
        season_hit_rate: p.season_hit_rate != null ? `${Math.round(p.season_hit_rate * 100)}%` : null,
        last10_hit_rate: p.last10_hit_rate != null ? `${Math.round(p.last10_hit_rate * 100)}%` : null,
        last5_hit_rate: p.last5_hit_rate != null ? `${Math.round(p.last5_hit_rate * 100)}%` : null,
        vs_opponent: p.vs_opponent_games > 0 ? {
          avg: p.vs_opponent_avg,
          hit_rate: p.vs_opponent_hit_rate != null ? `${Math.round(p.vs_opponent_hit_rate * 100)}%` : null,
          games: p.vs_opponent_games,
        } : null,
        home_away_split: p.home_away === "home" ? {
          avg: p.home_avg,
          hit_rate: p.home_hit_rate != null ? `${Math.round(p.home_hit_rate * 100)}%` : null,
          games: p.home_games,
        } : {
          avg: p.away_avg,
          hit_rate: p.away_hit_rate != null ? `${Math.round(p.away_hit_rate * 100)}%` : null,
          games: p.away_games,
        },
        tags: p.reason_tags || [],
        total_games: p.total_games,
      };
    });

    // Build game-level candidate summary for LLM
    const gameCandidatesToSend = gameLevelCandidates.slice(0, MAX_GAME_CANDIDATES_TO_LLM);

    // Build validation lookup for game-level candidates
    const gameCandidateByKey = new Map<string, GameLevelCandidate>();
    for (const gc of gameCandidatesToSend) {
      if (gc.type === "moneyline" && gc.team) {
        gameCandidateByKey.set(`${gc.team.toLowerCase()}::moneyline`, gc);
      } else if (gc.type === "spread" && gc.team) {
        gameCandidateByKey.set(`${gc.team.toLowerCase()}::spread::${gc.spread}`, gc);
        gameCandidateByKey.set(`${gc.team.toLowerCase()}::spread`, gc); // fuzzy
      } else if (gc.type === "total" && gc.pick) {
        gameCandidateByKey.set(`${gc.home_team.toLowerCase()}/${gc.away_team.toLowerCase()}::total::${gc.total_line}::${gc.pick.toLowerCase()}`, gc);
        gameCandidateByKey.set(`${gc.home_team.toLowerCase()}/${gc.away_team.toLowerCase()}::total::${gc.pick.toLowerCase()}`, gc); // fuzzy
      }
    }

    const gameCandidateSummary = gameCandidatesToSend.map(gc => ({
      type: gc.type,
      label: gc.label,
      home_team: gc.home_team,
      away_team: gc.away_team,
      team: gc.team || null,
      opponent: gc.opponent || null,
      spread: gc.spread ?? null,
      total_line: gc.total_line ?? null,
      pick: gc.pick || null,
      odds: gc.odds,
      implied_probability: gc.implied_probability != null ? `${Math.round(gc.implied_probability * 100)}%` : null,
      sportsbook: gc.sportsbook,
    }));

    debug.candidates_passed_to_llm = candidateSummary.length;
    debug.top_candidates = candidateSummary.slice(0, 20).map(c => ({
      player: c.player,
      stat: `${c.stat} ${c.line}`,
      confidence: c.confidence ?? 0,
      value: c.value ?? 0,
    }));

    console.log(`[AI-Builder] Passing ${candidateSummary.length} prop candidates + ${gameCandidateSummary.length} game candidates to LLM`);

    // ===== PHASE 4: LLM generation =====
    const diversityInstruction = slipCount > 1
      ? `\n\nIMPORTANT DIVERSITY RULE: Each slip MUST use a DIFFERENT set of players. Do NOT repeat the same player across multiple slips unless the candidate pool has fewer than ${slipCount * 3} unique players. Maximize player variety across slips.`
      : "";

    // Build the scored candidates section
    let candidateSection = "";
    if (candidateSummary.length > 0) {
      candidateSection = `\nSCORED PLAYER PROP CANDIDATES (${candidateSummary.length} candidates):
${JSON.stringify(candidateSummary, null, 1)}`;
    }

    // Build game-level candidates section
    let gameCandidateSection = "";
    if (gameCandidateSummary.length > 0) {
      gameCandidateSection = `\nGAME-LEVEL CANDIDATES (${gameCandidateSummary.length} — moneylines, spreads, totals):
${JSON.stringify(gameCandidateSummary, null, 1)}`;
    }

    // Build stat_type instruction based on what's available
    const statTypeInstruction = gameCandidateSummary.length > 0
      ? `"stat_type": "Points" | "Rebounds" | "Assists" | "3-Pointers" | "Steals" | "Blocks" | "Moneyline" | "Spread" | "Total"`
      : `"stat_type": "Points" | "Rebounds" | "Assists" | "3-Pointers" | "Steals" | "Blocks"`;

    const gameRules = gameCandidateSummary.length > 0
      ? `
- For GAME-LEVEL legs (Moneyline, Spread, Total):
  - Set "player_name" to the TEAM NAME (e.g. "Celtics" for ML/spread) or "Game Total" for totals
  - Set "team_abbr" to the team abbreviation
  - Set "stat_type" to "Moneyline", "Spread", or "Total"
  - Set "line" to the pick description (e.g. "Celtics ML", "Celtics -4.5", "Over 220.5")
  - Set "pick" to the side (team name for ML, team name for spread, "Over"/"Under" for totals)
  - Set "odds" from the game candidate data
  - Set "bet_type" to "moneyline", "spread", or "total"
  - For data_context, set odds_source, implied_probability, and odds_validated from the candidate data
- You can MIX player props and game-level bets in the same slip for combo/mixed parlays`
      : "";

    const systemPrompt = `You are an NBA betting analyst for BetStreaks. You generate structured bet slips using ONLY the pre-scored candidate legs provided below.

CRITICAL RULES:
- You MUST select legs ONLY from the candidate lists below
- Do NOT invent players, stats, or numbers that are not in the candidate data
- Every player_name you use MUST appear exactly as written in the candidates list
- Every stat_type you use MUST match the candidate's "stat" field exactly
- Use the candidate's "line" value as the threshold (e.g. "Over 24.5")
- Copy data_context values DIRECTLY from the candidate data — do NOT invent or modify statistics
- For season_avg, last5_avg, confidence, value: use the EXACT numbers from the candidate
- Never say "lock", "guaranteed", or "sure thing"
- Each slip has a risk_label: "safe", "balanced", or "aggressive"
- For "safe" slips: prefer candidates with higher confidence
- For "aggressive" slips: can use lower confidence candidates with high value
- Do NOT use the same player more than once within a single slip
- Provide reasoning that references the actual data from the candidates
- Generate realistic estimated combined American odds${gameRules}${diversityInstruction}
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
          "player_name": "EXACT name from candidates (or team name for game-level bets)",
          "team_abbr": "string",
          ${statTypeInstruction},
          "line": "Over X.5 (or 'Celtics ML', 'Celtics -4.5', 'Over 220.5' for game-level)",
          "pick": "Over" | "Under" | "team name",
          "odds": "-110",
          "reasoning": "Reference actual candidate data",
          "bet_type": "player_prop" | "moneyline" | "spread" | "total",
          "data_context": {
            "season_avg": number from candidate (null for game-level),
            "last5_avg": number from candidate (null for game-level),
            "last10_hit_rate": "X%" from candidate (null for game-level),
            "line_hit_rate": "X% over Y games" from candidate (null for game-level),
            "vs_opponent": "X% in Y games" or null,
            "vs_opponent_sample": number or null,
            "home_away_split": "X% in Y games" or null,
            "home_away_sample": number or null,
            "confidence_score": number from candidate (null for game-level),
            "value_score": number from candidate (null for game-level),
            "volatility_label": "low" | "medium" | "high" (null for game-level),
            "sample_size": total_games from candidate (null for game-level),
            "tags": array from candidate (empty for game-level),
            "odds_source": sportsbook name (for game-level bets),
            "implied_probability": number (for game-level bets),
            "odds_validated": true
          }
        }
      ]
    }
  ]
}`;

    // Build filter constraints for LLM
    let filterConstraints = "";
    if (filters) {
      const parts: string[] = [];
      if (filters.targetOdds) parts.push(`Target combined odds: ${filters.targetOdds}`);
      if (filters.legCount) parts.push(`Exactly ${filters.legCount} legs per slip`);
      if (filters.riskLevel) parts.push(`All slips must be risk_label: "${filters.riskLevel}"`);
      if (filters.overUnder === "over") parts.push("Use ONLY Over picks");
      if (filters.overUnder === "under") parts.push("Use ONLY Under picks");
      if (filters.sameGameOnly) parts.push("All legs in each slip must be from the SAME game");
      if (filters.crossGameOnly) parts.push("Each leg must be from a DIFFERENT game");
      if (filters.noRepeatPlayers) parts.push("Do NOT use the same player in multiple slips");
      if (filters.maxOnePerPlayer) parts.push("Max one leg per player in each slip");
      if (filters.maxOnePerTeam) parts.push("Max one leg per team in each slip");
      if (filters.diversifySlips) parts.push("Maximize diversity: different players, teams, and stat types across slips");
      if (betType === "moneyline") parts.push("Use ONLY moneyline (ML) bets — no player props, no spreads, no totals");
      if (betType === "spread") parts.push("Use ONLY spread bets — no player props, no moneylines, no totals");
      if (betType === "totals") parts.push("Use ONLY game totals (over/under) bets — no player props, no moneylines, no spreads");
      if (betType === "mixed") parts.push("Mix player props with game-level bets (ML, spread, totals) for combo parlays");
      if (parts.length > 0) {
        filterConstraints = `\n\nUSER FILTER CONSTRAINTS (MUST follow):\n${parts.map(p => `- ${p}`).join("\n")}`;
      }
    }

    const userPrompt = `Generate ${Math.min(slipCount, 5)} NBA bet slip(s) for: "${prompt}"

Use ONLY players/teams and stats from the candidate lists. Copy their statistics directly into data_context. Each slip should have ${filters?.legCount ? filters.legCount : "2-4"} legs.${filterConstraints}`;

    const aiRes = await fetch(AI_GATEWAY, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!aiRes.ok) {
      if (aiRes.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again in a moment.", debug }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiRes.status === 402) {
        return new Response(JSON.stringify({ error: "AI service temporarily unavailable.", debug }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
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

    // ===== PHASE 5: VALIDATE & ENRICH =====
    const playersUsedAcrossSlips = new Map<string, number>();

    for (const slip of parsed.slips) {
      const validLegs: any[] = [];
      const playersInThisSlip = new Set<string>();
      
      for (const leg of slip.legs || []) {
        const legBetType = leg.bet_type || "player_prop";
        const isGameLevel = legBetType === "moneyline" || legBetType === "spread" || legBetType === "total";

        if (isGameLevel) {
          // ===== GAME-LEVEL LEG VALIDATION =====
          const statNorm = normStat(leg.stat_type || "");
          let gameCand: GameLevelCandidate | undefined;

          // Helper: fuzzy match team identifier against candidate keys
          const fuzzyFindGame = (marketType: string): GameLevelCandidate | undefined => {
            // Try team_abbr first, then player_name
            const identifiers = [leg.team_abbr, leg.player_name].filter(Boolean).map(s => s!.toLowerCase());
            for (const id of identifiers) {
              // Exact key lookup
              const exact = gameCandidateByKey.get(`${id}::${marketType}`);
              if (exact) return exact;
              // Fuzzy: check if any key for this market contains the identifier or vice versa
              const lastWord = id.split(" ").pop() || id;
              for (const [k, v] of gameCandidateByKey.entries()) {
                if (!k.includes(marketType)) continue;
                const keyTeam = k.split("::")[0];
                if (keyTeam === id || keyTeam === lastWord || keyTeam.includes(lastWord) || lastWord.includes(keyTeam)) {
                  return v;
                }
              }
            }
            return undefined;
          };

          if (statNorm === "moneyline") {
            gameCand = fuzzyFindGame("moneyline");
          } else if (statNorm === "spread") {
            gameCand = fuzzyFindGame("spread");
          } else if (statNorm === "total") {
            // For totals, match any total candidate (or fuzzy by team)
            gameCand = fuzzyFindGame("total");
            if (!gameCand) {
              // Last resort: grab any total candidate
              for (const [k, v] of gameCandidateByKey.entries()) {
                if (k.includes("total")) {
                  gameCand = v;
                  break;
                }
              }
            }
          }

          if (!gameCand) {
            debug.legs_rejected++;
            debug.rejected_legs.push({
              player: leg.player_name || "unknown",
              stat: leg.stat_type || "unknown",
              reason: `Game-level bet not found in candidates (type: ${legBetType})`,
            });
            console.warn(`[AI-Builder] REJECTED game leg: ${leg.player_name} ${leg.stat_type}`);
            continue;
          }

          debug.legs_validated++;

          // Build data_context for game-level legs
          const realContext: Record<string, any> = {
            odds_source: gameCand.sportsbook,
            implied_probability: gameCand.implied_probability != null ? Math.round(gameCand.implied_probability * 100) : null,
            odds_validated: true,
            tags: [],
            // Matchup info for UI rendering
            home_team: gameCand.home_team,
            away_team: gameCand.away_team,
            opponent: gameCand.opponent || (gameCand.team === gameCand.home_team ? gameCand.away_team : gameCand.home_team),
            is_home: gameCand.team === gameCand.home_team,
            spread: gameCand.spread,
            total_line: gameCand.total_line,
            pick_side: gameCand.pick, // "Over" / "Under" for totals
          };

          leg.data_context = realContext;
          leg.odds = gameCand.odds;
          leg.bet_type = legBetType;
          leg.team_abbr = leg.team_abbr || gameCand.team || gameCand.home_team;

          validLegs.push(leg);
          continue;
        }

        // ===== PLAYER PROP VALIDATION (existing logic) =====
        const playerNorm = normName(leg.player_name || "");
        const statNorm = normStat(leg.stat_type || "");

        // Skip duplicate player within same slip
        if (playersInThisSlip.has(playerNorm)) {
          debug.legs_rejected++;
          debug.rejected_legs.push({
            player: leg.player_name || "unknown",
            stat: leg.stat_type || "unknown",
            reason: "Duplicate player within same slip",
          });
          continue;
        }

        // Try multiple key formats to find the DB candidate
        const key1 = `${playerNorm}::${statNorm}`;
        const statLabel = STAT_LABELS[statNorm] || leg.stat_type || "";
        const key2 = `${playerNorm}::${statLabel.toLowerCase()}`;

        let dbCandidate = candidateByKey.get(key1) || candidateByKey.get(key2);

        // If no exact match, try fuzzy
        if (!dbCandidate) {
          for (const [k, v] of candidateByKey.entries()) {
            if (k.startsWith(playerNorm + "::")) {
              dbCandidate = v;
              console.log(`[AI-Builder] Fuzzy matched ${leg.player_name}/${leg.stat_type} to DB key ${k}`);
              break;
            }
          }
        }

        if (!dbCandidate) {
          debug.legs_rejected++;
          debug.rejected_legs.push({
            player: leg.player_name || "unknown",
            stat: leg.stat_type || "unknown",
            reason: `Not in candidate set. Tried keys: [${key1}], [${key2}]`,
          });
          console.warn(`[AI-Builder] REJECTED: ${leg.player_name} / ${leg.stat_type} — not in candidates`);
          continue;
        }

        debug.legs_validated++;
        playersInThisSlip.add(playerNorm);
        playersUsedAcrossSlips.set(playerNorm, (playersUsedAcrossSlips.get(playerNorm) || 0) + 1);

        // CRITICAL: Override LLM data_context with REAL database values
        const realContext: Record<string, any> = {
          season_avg: dbCandidate.season_avg ?? null,
          last5_avg: dbCandidate.last5_avg ?? null,
          confidence_score: dbCandidate.confidence_score ?? null,
          value_score: dbCandidate.value_score ?? null,
          sample_size: dbCandidate.total_games ?? null,
          tags: dbCandidate.reason_tags || [],
        };

        if (dbCandidate.last10_hit_rate != null) {
          realContext.last10_hit_rate = `${Math.round(dbCandidate.last10_hit_rate * 100)}%`;
        }
        if (dbCandidate.season_hit_rate != null) {
          realContext.line_hit_rate = `${Math.round(dbCandidate.season_hit_rate * 100)}% over ${dbCandidate.total_games || "?"} games`;
        }

        if (dbCandidate.volatility_score != null) {
          realContext.volatility_label = dbCandidate.volatility_score <= 30 ? "low" : dbCandidate.volatility_score <= 60 ? "medium" : "high";
        }

        if (dbCandidate.vs_opponent_games > 0 && dbCandidate.vs_opponent_hit_rate != null) {
          realContext.vs_opponent = `${Math.round(dbCandidate.vs_opponent_hit_rate * 100)}% in ${dbCandidate.vs_opponent_games} games`;
          realContext.vs_opponent_sample = dbCandidate.vs_opponent_games;
        }

        if (dbCandidate.home_away === "home" && dbCandidate.home_hit_rate != null) {
          realContext.home_away_split = `${Math.round(dbCandidate.home_hit_rate * 100)}% at home in ${dbCandidate.home_games || "?"} games`;
          realContext.home_away_sample = dbCandidate.home_games;
        } else if (dbCandidate.away_hit_rate != null) {
          realContext.home_away_split = `${Math.round(dbCandidate.away_hit_rate * 100)}% away in ${dbCandidate.away_games || "?"} games`;
          realContext.home_away_sample = dbCandidate.away_games;
        }

        // ===== BEST LINE & ODDS VALIDATION (with main-line detection) =====
        const legStatLabel = STAT_LABELS[normStat(leg.stat_type)] || leg.stat_type;
        const lineThreshold = dbCandidate.threshold;
        const exactKey = `${normName(leg.player_name)}|${legStatLabel}|${lineThreshold}`;
        let bestLine = bestLines.get(exactKey);
        let marketThreshold: number | null = null;

        if (!bestLine) {
          const psKey = `${normName(leg.player_name)}|${legStatLabel}`;
          const candidates = bestLinesByPlayerStat.get(psKey);
          if (candidates && candidates.length > 0) {
            // Prefer main lines over alt lines when fuzzy matching
            const mainLines = candidates.filter(c => c.is_main_line);
            const searchPool = mainLines.length > 0 ? mainLines : candidates;
            
            let closestDist = Infinity;
            let closestEntry: BestLineEntry | null = null;
            for (const c of searchPool) {
              const dist = Math.abs(c.threshold - lineThreshold);
              if (dist < closestDist) {
                closestDist = dist;
                closestEntry = c;
              }
            }
            if (closestEntry) {
              bestLine = closestEntry;
              marketThreshold = closestEntry.threshold;
              const pick = (leg.pick || "").toLowerCase();
              leg.line = `${pick === "under" ? "Under" : "Over"} ${closestEntry.threshold}`;
              console.log(`[AI-Builder] Fuzzy matched ${leg.player_name} ${legStatLabel}: scoring ${lineThreshold} → market ${closestEntry.threshold} (main: ${closestEntry.is_main_line}, confidence: ${closestEntry.market_confidence})`);
            }
          }
        }

        if (bestLine) {
          const pick = (leg.pick || "").toLowerCase();
          if (pick === "over" && bestLine.best_over_odds) {
            leg.odds = bestLine.best_over_odds;
            realContext.odds_source = bestLine.best_over_book;
            realContext.implied_probability = bestLine.implied_over != null ? Math.round(bestLine.implied_over * 100) : null;
            realContext.best_over_odds = bestLine.best_over_odds;
            realContext.best_under_odds = bestLine.best_under_odds;
          } else if (pick === "under" && bestLine.best_under_odds) {
            leg.odds = bestLine.best_under_odds;
            realContext.odds_source = bestLine.best_under_book;
            realContext.implied_probability = bestLine.implied_under != null ? Math.round(bestLine.implied_under * 100) : null;
            realContext.best_over_odds = bestLine.best_over_odds;
            realContext.best_under_odds = bestLine.best_under_odds;
          }

          realContext.odds_validated = bestLine.odds_validated;
          if (marketThreshold != null && marketThreshold !== lineThreshold) {
            realContext.market_threshold = marketThreshold;
          }

          // === NEW: Market normalization metadata ===
          realContext.market_confidence = bestLine.market_confidence;
          realContext.consensus_line = bestLine.consensus_line;
          realContext.books_count = bestLine.books_with_line;
          realContext.is_main_line = bestLine.is_main_line;

          // Compute edge: difference between scoring hit rate and implied probability
          const implProb = pick === "over" ? bestLine.implied_over : bestLine.implied_under;
          const hitRate = dbCandidate.season_hit_rate;
          if (implProb != null && hitRate != null) {
            const edgePct = Math.round((hitRate - implProb) * 100);
            realContext.edge = edgePct;
          }

          const snapKey = `${normName(leg.player_name)}|${legStatLabel}|${bestLine.threshold}`;
          const propSnapshots = snapshotsByProp.get(snapKey) || [];
          const movementWarning = detectExtremeMovement(
            pick === "over" ? bestLine.best_over_odds : bestLine.best_under_odds,
            propSnapshots,
            pick === "over" ? "over" : "under"
          );
          if (movementWarning) {
            realContext.market_note = movementWarning;
          }

          // Alt line warning (not hard reject, but flag)
          if (bestLine.alt_line_flag) {
            realContext.market_note = (realContext.market_note ? realContext.market_note + " | " : "") +
              `⚠ Possible alt line — consensus main at ${bestLine.consensus_line}`;
          }

          if (!bestLine.odds_validated) {
            debug.legs_rejected++;
            debug.rejected_legs.push({
              player: leg.player_name,
              stat: leg.stat_type,
              reason: `Market normalization failed: ${bestLine.rejection_reason}`,
            });
            debug.legs_validated--;
            playersInThisSlip.delete(playerNorm);
            console.warn(`[AI-Builder] REJECTED (market): ${leg.player_name} ${leg.stat_type} — ${bestLine.rejection_reason}`);
            continue;
          }

          // Soft penalty: if market confidence is very low, reduce the leg's attractiveness
          if (bestLine.market_confidence < 25) {
            debug.legs_rejected++;
            debug.rejected_legs.push({
              player: leg.player_name,
              stat: leg.stat_type,
              reason: `Market confidence too low: ${bestLine.market_confidence}/100 (${bestLine.books_with_line} book(s), alt: ${bestLine.alt_line_flag})`,
            });
            debug.legs_validated--;
            playersInThisSlip.delete(playerNorm);
            console.warn(`[AI-Builder] REJECTED (low market confidence): ${leg.player_name} ${leg.stat_type} — confidence ${bestLine.market_confidence}`);
            continue;
          }
        } else {
          realContext.odds_validated = false;
          realContext.market_confidence = 0;
          realContext.books_count = 0;
        }

        // Replace LLM context entirely with real data
        leg.data_context = realContext;
        leg.team_abbr = leg.team_abbr || dbCandidate.team_abbr;
        leg.bet_type = leg.bet_type || "player_prop";

        validLegs.push(leg);
      }
      
      slip.legs = validLegs;
    }

    // Remove slips with 0 valid legs
    parsed.slips = parsed.slips.filter((s: any) => s.legs && s.legs.length > 0);

    console.log(`[AI-Builder] Validation: ${debug.legs_validated} passed, ${debug.legs_rejected} rejected`);
    if (debug.rejected_legs.length > 0) {
      console.log(`[AI-Builder] Rejected details:`, JSON.stringify(debug.rejected_legs));
    }

    if (parsed.slips.length === 0) {
      return new Response(
        JSON.stringify({ 
          error: "AI could not build valid slips from today's candidates. Try a different prompt.",
          debug,
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ===== PHASE 6: Save to database =====
    const savedSlips = [];
    for (const slip of parsed.slips) {
      const { data: slipRow, error: slipErr } = await supabase
        .from("ai_slips")
        .insert({
          user_id: user?.id || null,
          prompt,
          slip_name: slip.slip_name,
          risk_label: slip.risk_label,
          estimated_odds: slip.estimated_odds,
          reasoning: slip.reasoning,
        })
        .select()
        .single();

      if (slipErr) {
        console.error("[AI-Builder] Error saving slip:", slipErr);
        continue;
      }

      const legs = (slip.legs || []).map((leg: any, idx: number) => ({
        slip_id: slipRow.id,
        player_name: leg.player_name,
        team_abbr: leg.team_abbr,
        stat_type: leg.stat_type,
        line: leg.line,
        pick: leg.pick,
        odds: leg.odds,
        reasoning: leg.reasoning,
        leg_order: idx,
      }));

      const { data: legRows, error: legErr } = await supabase
        .from("ai_slip_legs")
        .insert(legs)
        .select();

      if (legErr) console.error("[AI-Builder] Error saving legs:", legErr);

      const legsWithContext = (legRows || legs).map((lr: any, idx: number) => ({
        ...lr,
        data_context: slip.legs?.[idx]?.data_context || null,
        bet_type: slip.legs?.[idx]?.bet_type || "player_prop",
      }));

      savedSlips.push({ ...slipRow, legs: legsWithContext });
    }

    // Track usage for free users
    if (user && !isPremium) {
      const today = new Date().toISOString().split("T")[0];
      supabase
        .from("ai_usage")
        .upsert({ user_id: user.id, usage_date: today, request_count: 1 }, { onConflict: "user_id,usage_date" })
        .then(() => {});
    }

    return new Response(JSON.stringify({
      slips: savedSlips,
      debug,
      scoring_metadata: {
        candidates_available: scoredProps.length,
        candidates_after_diversity: debug.candidates_after_diversity,
        candidates_sent_to_llm: candidateSummary.length,
        game_candidates_sent_to_llm: gameCandidateSummary.length,
        unique_players: debug.unique_players_in_pool,
        legs_validated: debug.legs_validated,
        legs_rejected: debug.legs_rejected,
        games_today: gamesData.length,
        live_props_found: livePropsCount,
        game_level_candidates: debug.game_level_candidates,
        mode: debug.mode,
        fallback_used: debug.fallback_used,
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
