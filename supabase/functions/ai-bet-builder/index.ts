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
const MAX_CANDIDATES_TO_LLM = 40;

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

  // Reject extreme juice: odds < -800 are likely alt lines mislabeled as main lines
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

  // Cross-book divergence check: if both sides have same-direction heavy juice, something is off
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
}

/** Aggregate live props across books, select best line, run sanity checks */
function aggregateBestLines(liveProps: { player_name: string; stat_type: string; threshold: number; over_odds: string | null; under_odds: string | null; sportsbook: string }[]): Map<string, BestLineEntry> {
  const grouped = new Map<string, typeof liveProps>();

  for (const prop of liveProps) {
    const key = `${prop.player_name.toLowerCase()}|${prop.stat_type}|${prop.threshold}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(prop);
  }

  const bestLines = new Map<string, BestLineEntry>();

  for (const [key, entries] of grouped) {
    let bestOverOdds: number | null = null;
    let bestOverBook: string | null = null;
    let bestUnderOdds: number | null = null;
    let bestUnderBook: string | null = null;
    const booksSeen = new Set<string>();

    for (const e of entries) {
      booksSeen.add(e.sportsbook);
      const overNum = e.over_odds ? parseInt(e.over_odds, 10) : null;
      const underNum = e.under_odds ? parseInt(e.under_odds, 10) : null;

      // Best over = highest (least negative / most positive)
      if (overNum != null && (bestOverOdds == null || overNum > bestOverOdds)) {
        bestOverOdds = overNum;
        bestOverBook = e.sportsbook;
      }
      // Best under = highest
      if (underNum != null && (bestUnderOdds == null || underNum > bestUnderOdds)) {
        bestUnderOdds = underNum;
        bestUnderBook = e.sportsbook;
      }
    }

    const sanity = isOddsSane(
      bestOverOdds != null ? String(bestOverOdds) : null,
      bestUnderOdds != null ? String(bestUnderOdds) : null,
      entries[0].threshold,
      entries[0].stat_type
    );

    bestLines.set(key, {
      player_name: entries[0].player_name,
      stat_type: entries[0].stat_type,
      threshold: entries[0].threshold,
      best_over_odds: bestOverOdds != null ? String(bestOverOdds) : null,
      best_over_book: bestOverBook,
      best_under_odds: bestUnderOdds != null ? String(bestUnderOdds) : null,
      best_under_book: bestUnderBook,
      books_seen: [...booksSeen],
      implied_over: americanToImplied(bestOverOdds),
      implied_under: americanToImplied(bestUnderOdds),
      odds_validated: sanity.valid,
      rejection_reason: sanity.reason,
    });
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

  // Get oldest snapshot for comparison
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
  return lower;
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

    // ===== PHASE 1: Get pre-scored candidates from player_prop_scores =====
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

    let scoredProps: any[] = dbCandidates || [];
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

    if (scoredProps.length === 0) {
      return new Response(
        JSON.stringify({ 
          error: "No scored candidates available for today's games. Data may not have been refreshed yet.",
          debug,
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ===== PHASE 1b: APPLY USER FILTERS before diversity cap =====
    let filteredProps = [...scoredProps];

    if (filters) {
      const f = filters;

      // Stat type filter
      if (f.statTypes && f.statTypes.length > 0) {
        const allowedStats = new Set(f.statTypes.map((s: string) => normStat(s)));
        filteredProps = filteredProps.filter((p: any) => allowedStats.has(normStat(p.stat_type)));
        console.log(`[AI-Builder] After stat filter: ${filteredProps.length}`);
      }

      // Team filters
      if (f.includeTeams && f.includeTeams.length > 0) {
        const teams = new Set(f.includeTeams.map((t: string) => t.toUpperCase()));
        filteredProps = filteredProps.filter((p: any) => teams.has((p.team_abbr || "").toUpperCase()));
      }
      if (f.excludeTeams && f.excludeTeams.length > 0) {
        const teams = new Set(f.excludeTeams.map((t: string) => t.toUpperCase()));
        filteredProps = filteredProps.filter((p: any) => !teams.has((p.team_abbr || "").toUpperCase()));
      }

      // Player filters
      if (f.includePlayers && f.includePlayers.length > 0) {
        const players = new Set(f.includePlayers.map((n: string) => normName(n)));
        filteredProps = filteredProps.filter((p: any) => players.has(normName(p.player_name)));
      }
      if (f.excludePlayers && f.excludePlayers.length > 0) {
        const players = new Set(f.excludePlayers.map((n: string) => normName(n)));
        filteredProps = filteredProps.filter((p: any) => !players.has(normName(p.player_name)));
      }

      // Data quality filters
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
        // Filter by reason_tags containing "starter" or high minutes
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

    // ===== PHASE 2: Fetch live odds for market context =====
    const featuredUrl = `${ODDS_API_BASE}/sports/basketball_nba/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h,spreads,totals&oddsFormat=american&bookmakers=draftkings,fanduel`;
    const featuredRes = await fetch(featuredUrl);
    let gamesData: any[] = [];
    if (featuredRes.ok) {
      gamesData = await featuredRes.json();
    } else {
      console.error("[AI-Builder] Odds API error:", featuredRes.status);
    }

    // Fetch player props for line snapshots
    let livePropsCount = 0;
    const lineSnapshotRows: any[] = [];
    for (const game of gamesData.slice(0, 3)) {
      try {
        const propsUrl = `${ODDS_API_BASE}/sports/basketball_nba/events/${game.id}/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=player_points,player_rebounds,player_assists,player_threes&oddsFormat=american&bookmakers=draftkings,fanduel`;
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
                  lineSnapshotRows.push({
                    player_name: entry.player,
                    stat_type: statType,
                    threshold: entry.point,
                    over_odds: entry.over || null,
                    under_odds: entry.under || null,
                    sportsbook: bm.key,
                    game_date: todayStr,
                  });
                }
              }
            }
          }
        }
      } catch (e) {
        console.error("[AI-Builder] Props fetch error:", e);
      }
    }

    debug.live_props_found = livePropsCount;
    console.log(`[AI-Builder] Live props found: ${livePropsCount}`);

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
    // Use diversified pool, take top N
    const candidatesToSend = diversifiedProps.slice(0, MAX_CANDIDATES_TO_LLM);

    // Build validation lookup keyed on normalized player+stat
    const candidateByKey = new Map<string, any>();

    const candidateSummary = candidatesToSend.map((p: any) => {
      const statLabel = STAT_LABELS[p.stat_type] || p.stat_type;
      const normPlayer = normName(p.player_name);
      const normStatKey = normStat(p.stat_type);
      
      // Store under multiple key formats for matching
      const key1 = `${normPlayer}::${normStatKey}`;
      const key2 = `${normPlayer}::${statLabel.toLowerCase()}`;
      // Store specific threshold key for exact matching
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

    debug.candidates_passed_to_llm = candidateSummary.length;
    debug.top_candidates = candidateSummary.slice(0, 20).map(c => ({
      player: c.player,
      stat: `${c.stat} ${c.line}`,
      confidence: c.confidence ?? 0,
      value: c.value ?? 0,
    }));

    console.log(`[AI-Builder] Passing ${candidateSummary.length} candidates to LLM from ${debug.unique_players_in_pool} players`);

    // ===== PHASE 4: LLM generation =====
    const diversityInstruction = slipCount > 1
      ? `\n\nIMPORTANT DIVERSITY RULE: Each slip MUST use a DIFFERENT set of players. Do NOT repeat the same player across multiple slips unless the candidate pool has fewer than ${slipCount * 3} unique players. Maximize player variety across slips.`
      : "";

    const systemPrompt = `You are an NBA betting analyst for BetStreaks. You generate structured bet slips using ONLY the pre-scored candidate legs provided below.

CRITICAL RULES:
- You MUST select legs ONLY from the SCORED CANDIDATES list below
- Do NOT invent players, stats, or numbers that are not in the candidate data
- Every player_name you use MUST appear exactly as written in the candidates list
- Every stat_type you use MUST match the candidate's "stat" field exactly (e.g. "Points", "Rebounds", "Assists", "3-Pointers", "Steals", "Blocks")
- Use the candidate's "line" value as the threshold (e.g. "Over 24.5")
- Copy data_context values DIRECTLY from the candidate data — do NOT invent or modify statistics
- For season_avg, last5_avg, confidence, value: use the EXACT numbers from the candidate
- Never say "lock", "guaranteed", or "sure thing"
- Each slip has a risk_label: "safe", "balanced", or "aggressive"
- For "safe" slips: prefer candidates with higher confidence
- For "aggressive" slips: can use lower confidence candidates with high value
- Do NOT use the same player more than once within a single slip
- Provide reasoning that references the actual data from the candidates
- Generate realistic estimated combined American odds${diversityInstruction}

SCORED CANDIDATES (${candidateSummary.length} candidates — USE ONLY THESE):
${JSON.stringify(candidateSummary, null, 1)}

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
          "player_name": "EXACT name from candidates",
          "team_abbr": "string",
          "stat_type": "Points" | "Rebounds" | "Assists" | "3-Pointers" | "Steals" | "Blocks",
          "line": "Over X.5",
          "pick": "Over" | "Under",
          "odds": "-110",
          "reasoning": "Reference actual candidate data",
          "data_context": {
            "season_avg": number from candidate,
            "last5_avg": number from candidate,
            "last10_hit_rate": "X%" from candidate,
            "line_hit_rate": "X% over Y games" from candidate,
            "vs_opponent": "X% in Y games" or null,
            "vs_opponent_sample": number or null,
            "home_away_split": "X% in Y games" or null,
            "home_away_sample": number or null,
            "confidence_score": number from candidate,
            "value_score": number from candidate,
            "volatility_label": "low" | "medium" | "high",
            "sample_size": total_games from candidate,
            "tags": array from candidate
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
      if (parts.length > 0) {
        filterConstraints = `\n\nUSER FILTER CONSTRAINTS (MUST follow):\n${parts.map(p => `- ${p}`).join("\n")}`;
      }
    }

    const userPrompt = `Generate ${Math.min(slipCount, 5)} NBA bet slip(s) for: "${prompt}"

Use ONLY players and stats from the scored candidates. Copy their statistics directly into data_context. Each slip should have ${filters?.legCount ? filters.legCount : "2-4"} legs.${filterConstraints}`;

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
    // Track players used across slips for multi-slip dedup
    const playersUsedAcrossSlips = new Map<string, number>();

    for (const slip of parsed.slips) {
      const validLegs: any[] = [];
      const playersInThisSlip = new Set<string>();
      
      for (const leg of slip.legs || []) {
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

        // If no exact match, try fuzzy: find any candidate for this player
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
        // Only set values from DB — never pass 0 when the real data is null
        const realContext: Record<string, any> = {
          season_avg: dbCandidate.season_avg ?? null,
          last5_avg: dbCandidate.last5_avg ?? null,
          confidence_score: dbCandidate.confidence_score ?? null,
          value_score: dbCandidate.value_score ?? null,
          sample_size: dbCandidate.total_games ?? null,
          tags: dbCandidate.reason_tags || [],
        };

        // Hit rates — only include if non-null
        if (dbCandidate.last10_hit_rate != null) {
          realContext.last10_hit_rate = `${Math.round(dbCandidate.last10_hit_rate * 100)}%`;
        }
        if (dbCandidate.season_hit_rate != null) {
          realContext.line_hit_rate = `${Math.round(dbCandidate.season_hit_rate * 100)}% over ${dbCandidate.total_games || "?"} games`;
        }

        // Volatility
        if (dbCandidate.volatility_score != null) {
          realContext.volatility_label = dbCandidate.volatility_score <= 30 ? "low" : dbCandidate.volatility_score <= 60 ? "medium" : "high";
        }

        // vs opponent
        if (dbCandidate.vs_opponent_games > 0 && dbCandidate.vs_opponent_hit_rate != null) {
          realContext.vs_opponent = `${Math.round(dbCandidate.vs_opponent_hit_rate * 100)}% in ${dbCandidate.vs_opponent_games} games`;
          realContext.vs_opponent_sample = dbCandidate.vs_opponent_games;
        }

        // Home/away split
        if (dbCandidate.home_away === "home" && dbCandidate.home_hit_rate != null) {
          realContext.home_away_split = `${Math.round(dbCandidate.home_hit_rate * 100)}% at home in ${dbCandidate.home_games || "?"} games`;
          realContext.home_away_sample = dbCandidate.home_games;
        } else if (dbCandidate.away_hit_rate != null) {
          realContext.home_away_split = `${Math.round(dbCandidate.away_hit_rate * 100)}% away in ${dbCandidate.away_games || "?"} games`;
          realContext.home_away_sample = dbCandidate.away_games;
        }

        // Replace LLM context entirely with real data
        leg.data_context = realContext;
        leg.team_abbr = leg.team_abbr || dbCandidate.team_abbr;

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
        unique_players: debug.unique_players_in_pool,
        legs_validated: debug.legs_validated,
        legs_rejected: debug.legs_rejected,
        games_today: gamesData.length,
        live_props_found: livePropsCount,
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
