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

const STAT_LABELS_REVERSE: Record<string, string> = {
  "points": "pts", "rebounds": "reb", "assists": "ast",
  "3-pointers": "fg3m", "steals": "stl", "blocks": "blk",
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

// Normalize name for fuzzy matching
function normName(n: string): string {
  return n.toLowerCase().replace(/[^a-z ]/g, "").trim();
}

// Normalize stat type for matching
function normStat(s: string): string {
  const lower = s.toLowerCase().replace(/[^a-z0-9]/g, "");
  // Handle common variations
  if (lower === "points" || lower === "pts") return "pts";
  if (lower === "rebounds" || lower === "reb") return "reb";
  if (lower === "assists" || lower === "ast") return "ast";
  if (lower === "3pointers" || lower === "3pm" || lower === "fg3m" || lower === "threes") return "fg3m";
  if (lower === "steals" || lower === "stl") return "stl";
  if (lower === "blocks" || lower === "blk") return "blk";
  return lower;
}

interface DebugInfo {
  db_candidates_found: number;
  db_query_date: string;
  fallback_used: boolean;
  fallback_reason: string | null;
  candidates_passed_to_llm: number;
  candidates_excluded: number;
  exclusion_reasons: string[];
  legs_validated: number;
  legs_rejected: number;
  rejected_legs: { player: string; stat: string; reason: string }[];
  scoring_engine_called: boolean;
  mode: "scored_candidates" | "fallback_mode";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const debug: DebugInfo = {
    db_candidates_found: 0,
    db_query_date: "",
    fallback_used: false,
    fallback_reason: null,
    candidates_passed_to_llm: 0,
    candidates_excluded: 0,
    exclusion_reasons: [],
    legs_validated: 0,
    legs_rejected: 0,
    rejected_legs: [],
    scoring_engine_called: false,
    mode: "scored_candidates",
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

    const { prompt, slipCount = 1 } = await req.json();
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
    // NO confidence filter — let all candidates through so LLM can see them
    console.log(`[AI-Builder] Fetching pre-scored candidates from player_prop_scores for ${todayStr}...`);
    
    const { data: dbCandidates, error: dbErr } = await serviceClient
      .from("player_prop_scores")
      .select("*")
      .eq("game_date", todayStr)
      .order("confidence_score", { ascending: false })
      .limit(100);

    if (dbErr) {
      console.error("[AI-Builder] DB candidates error:", dbErr);
      debug.exclusion_reasons.push(`DB error: ${dbErr.message}`);
    }

    let scoredProps: any[] = dbCandidates || [];
    debug.db_candidates_found = scoredProps.length;
    console.log(`[AI-Builder] Found ${scoredProps.length} pre-scored candidates from DB for ${todayStr}`);

    // Log score distribution for debugging
    if (scoredProps.length > 0) {
      const scoreRange = {
        min: Math.min(...scoredProps.map(p => p.confidence_score || 0)),
        max: Math.max(...scoredProps.map(p => p.confidence_score || 0)),
        avg: Math.round(scoredProps.reduce((s, p) => s + (p.confidence_score || 0), 0) / scoredProps.length),
      };
      console.log(`[AI-Builder] Score distribution: min=${scoreRange.min}, max=${scoreRange.max}, avg=${scoreRange.avg}`);
    }

    // If no DB candidates for today, try yesterday
    if (scoredProps.length === 0) {
      const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
      console.log(`[AI-Builder] No candidates for today, trying yesterday (${yesterday})...`);
      
      const { data: yestCandidates, error: yestErr } = await serviceClient
        .from("player_prop_scores")
        .select("*")
        .eq("game_date", yesterday)
        .order("confidence_score", { ascending: false })
        .limit(100);
      
      if (yestErr) {
        console.error("[AI-Builder] Yesterday query error:", yestErr);
      }
      
      if (yestCandidates && yestCandidates.length > 0) {
        scoredProps = yestCandidates;
        debug.fallback_used = true;
        debug.fallback_reason = `No candidates for ${todayStr}, using ${yestCandidates.length} from ${yesterday}`;
        debug.mode = "fallback_mode";
        console.log(`[AI-Builder] Fallback: got ${scoredProps.length} candidates from yesterday`);
      }
    }

    // If still no candidates, call scoring engine as last resort
    if (scoredProps.length === 0) {
      console.log("[AI-Builder] No DB candidates — calling scoring engine as fallback...");
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
          debug.fallback_reason = `No DB candidates, called scoring engine and got ${scoredProps.length} props`;
          debug.mode = "fallback_mode";
          console.log(`[AI-Builder] Scoring engine fallback: ${scoredProps.length} props`);
        } else {
          const errText = await scoringRes.text();
          console.error("[AI-Builder] Scoring engine error:", scoringRes.status, errText);
          debug.exclusion_reasons.push(`Scoring engine returned ${scoringRes.status}`);
        }
      } catch (e) {
        console.error("[AI-Builder] Scoring engine fallback failed:", e);
        debug.exclusion_reasons.push(`Scoring engine call failed: ${e}`);
      }
    }

    // If we STILL have no candidates, return a clear error
    if (scoredProps.length === 0) {
      console.error("[AI-Builder] FATAL: No scored candidates available at all");
      return new Response(
        JSON.stringify({ 
          error: "No scored candidates available for today's games. Data may not have been refreshed yet.",
          debug,
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ===== PHASE 2: Fetch live odds for market context =====
    const featuredUrl = `${ODDS_API_BASE}/sports/basketball_nba/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h,spreads,totals&oddsFormat=american&bookmakers=draftkings,fanduel`;
    const featuredRes = await fetch(featuredUrl);
    let gamesData: any[] = [];
    if (featuredRes.ok) {
      gamesData = await featuredRes.json();
    } else {
      console.error("[AI-Builder] Odds API error:", featuredRes.status);
    }

    // Fetch player props for market lines + snapshots
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

    // Save line snapshots (fire-and-forget)
    if (lineSnapshotRows.length > 0) {
      serviceClient
        .from("line_snapshots")
        .insert(lineSnapshotRows)
        .then(({ error }) => { if (error) console.error("[AI-Builder] Line snapshot insert error:", error); });
    }

    // Build odds summary
    const oddsSummary = gamesData.slice(0, 8).map((game: any) => ({
      home: game.home_team,
      away: game.away_team,
      commence: game.commence_time,
    }));

    // ===== PHASE 3: Build candidate summary and validation maps =====
    // Create lookup maps for validation
    const candidateSet = new Set<string>();
    const candidateByKey = new Map<string, any>();

    const candidateSummary = scoredProps.slice(0, 50).map((p: any) => {
      const statLabel = STAT_LABELS[p.stat_type] || p.stat_type;
      const normPlayer = normName(p.player_name);
      const normStatKey = normStat(p.stat_type);
      
      // Multiple key formats for flexible matching
      const key1 = `${normPlayer}::${normStatKey}`;
      const key2 = `${normPlayer}::${statLabel.toLowerCase()}`;
      candidateSet.add(key1);
      candidateSet.add(key2);
      candidateByKey.set(key1, p);
      candidateByKey.set(key2, p);

      // Also store by player name alone for partial matching
      if (!candidateByKey.has(normPlayer)) {
        candidateByKey.set(normPlayer, p);
      }

      return {
        player: p.player_name,
        team: p.team_abbr,
        opponent: p.opponent_abbr,
        home_away: p.home_away,
        stat: statLabel,
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
        lineup_confidence: p.lineup_confidence,
      };
    });

    debug.candidates_passed_to_llm = candidateSummary.length;
    debug.candidates_excluded = scoredProps.length - candidateSummary.length;
    if (debug.candidates_excluded > 0) {
      debug.exclusion_reasons.push(`Passed top ${candidateSummary.length} of ${scoredProps.length} to LLM (limit 50)`);
    }

    console.log(`[AI-Builder] Passing ${candidateSummary.length} candidates to LLM`);

    // ===== PHASE 4: LLM generation =====
    const systemPrompt = `You are an NBA betting analyst for BetStreaks. You generate structured bet slips using ONLY the pre-scored candidate legs provided below.

CRITICAL RULES:
- You MUST select legs ONLY from the SCORED CANDIDATES list below
- Do NOT invent players, stats, or numbers that are not in the candidate data
- Every player_name you use MUST appear exactly as written in the candidates list
- Every stat_type you use MUST match the candidate's "stat" field exactly
- Use the candidate's "line" value as the threshold (e.g., "Over 24.5")
- Pull ALL data_context values directly from the candidate data — do NOT invent statistics
- Never say "lock", "guaranteed", or "sure thing"
- Use terms like "balanced option", "higher-risk version", "best fit based on current data"
- Each slip has a risk_label: "safe", "balanced", or "aggressive"
- For "safe" slips: prefer candidates with confidence >= 50
- For "balanced" slips: mix confidence levels
- For "aggressive" slips: can use lower confidence candidates with high value
- Provide reasoning that references the actual data from the candidates
- Generate realistic estimated combined American odds

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
            "lineup_confidence": "high" | "medium" | "low" or null,
            "tags": array from candidate
          }
        }
      ]
    }
  ]
}`;

    const userPrompt = `Generate ${Math.min(slipCount, 5)} NBA bet slip(s) for: "${prompt}"

Use ONLY players and stats from the scored candidates. Copy their statistics directly into data_context.`;

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

    // ===== PHASE 5: VALIDATE & ENRICH — reject hallucinated legs, override with real data =====
    for (const slip of parsed.slips) {
      const validLegs: any[] = [];
      
      for (const leg of slip.legs || []) {
        const playerNorm = normName(leg.player_name || "");
        const statNorm = normStat(leg.stat_type || "");
        const key = `${playerNorm}::${statNorm}`;

        // Try multiple key formats
        let dbCandidate = candidateByKey.get(key);
        if (!dbCandidate) {
          // Try with label
          const statLabel = STAT_LABELS[statNorm] || leg.stat_type || "";
          dbCandidate = candidateByKey.get(`${playerNorm}::${statLabel.toLowerCase()}`);
        }

        if (dbCandidate || candidateSet.has(key)) {
          debug.legs_validated++;
          
          // CRITICAL: Override LLM data_context with REAL database values
          if (dbCandidate) {
            const realContext = {
              season_avg: dbCandidate.season_avg,
              last5_avg: dbCandidate.last5_avg,
              last10_hit_rate: dbCandidate.last10_hit_rate != null 
                ? `${Math.round(dbCandidate.last10_hit_rate * 100)}%` 
                : null,
              line_hit_rate: dbCandidate.season_hit_rate != null 
                ? `${Math.round(dbCandidate.season_hit_rate * 100)}% over ${dbCandidate.total_games || "?"} games` 
                : null,
              vs_opponent: dbCandidate.vs_opponent_games > 0 && dbCandidate.vs_opponent_hit_rate != null
                ? `${Math.round(dbCandidate.vs_opponent_hit_rate * 100)}% in ${dbCandidate.vs_opponent_games} games`
                : null,
              vs_opponent_sample: dbCandidate.vs_opponent_games || null,
              home_away_split: dbCandidate.home_away === "home" && dbCandidate.home_hit_rate != null
                ? `${Math.round(dbCandidate.home_hit_rate * 100)}% at home in ${dbCandidate.home_games || "?"} games`
                : dbCandidate.away_hit_rate != null
                ? `${Math.round(dbCandidate.away_hit_rate * 100)}% away in ${dbCandidate.away_games || "?"} games`
                : null,
              home_away_sample: dbCandidate.home_away === "home" ? dbCandidate.home_games : dbCandidate.away_games,
              confidence_score: dbCandidate.confidence_score,
              value_score: dbCandidate.value_score,
              volatility_label: dbCandidate.volatility_score != null
                ? (dbCandidate.volatility_score <= 30 ? "low" : dbCandidate.volatility_score <= 60 ? "medium" : "high")
                : "medium",
              sample_size: dbCandidate.total_games,
              lineup_confidence: dbCandidate.lineup_confidence || null,
              tags: dbCandidate.reason_tags || [],
            };

            // Merge: real data takes precedence
            leg.data_context = { ...leg.data_context, ...realContext };
            leg.team_abbr = leg.team_abbr || dbCandidate.team_abbr;
          }
          
          validLegs.push(leg);
        } else {
          debug.legs_rejected++;
          debug.rejected_legs.push({
            player: leg.player_name || "unknown",
            stat: leg.stat_type || "unknown",
            reason: "Not found in candidate set",
          });
          console.warn(`[AI-Builder] REJECTED: ${leg.player_name} / ${leg.stat_type} — not in candidates`);
        }
      }
      
      slip.legs = validLegs;
    }

    // Remove slips with 0 valid legs
    parsed.slips = parsed.slips.filter((s: any) => s.legs && s.legs.length > 0);

    console.log(`[AI-Builder] Validation: ${debug.legs_validated} passed, ${debug.legs_rejected} rejected`);

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
        candidates_sent_to_llm: candidateSummary.length,
        legs_validated: debug.legs_validated,
        legs_rejected: debug.legs_rejected,
        games_today: gamesData.length,
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
