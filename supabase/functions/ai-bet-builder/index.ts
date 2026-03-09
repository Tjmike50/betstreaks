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

// Normalize name for fuzzy matching (lowercase, no punctuation)
function normName(n: string): string {
  return n.toLowerCase().replace(/[^a-z ]/g, "").trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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

    // ===== PHASE 1: Get pre-scored candidates from player_prop_scores (PRIMARY SOURCE) =====
    console.log("Fetching pre-scored candidates from player_prop_scores...");
    const { data: dbCandidates, error: dbErr } = await serviceClient
      .from("player_prop_scores")
      .select("*")
      .eq("game_date", todayStr)
      .gte("confidence_score", 20)
      .order("confidence_score", { ascending: false })
      .limit(80);

    if (dbErr) console.error("DB candidates error:", dbErr);

    let scoredProps: any[] = dbCandidates || [];
    console.log(`Got ${scoredProps.length} pre-scored candidates from DB for ${todayStr}`);

    // If no DB candidates for today, try yesterday (in case of timezone edge)
    if (scoredProps.length === 0) {
      const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
      const { data: yestCandidates } = await serviceClient
        .from("player_prop_scores")
        .select("*")
        .eq("game_date", yesterday)
        .gte("confidence_score", 20)
        .order("confidence_score", { ascending: false })
        .limit(80);
      if (yestCandidates && yestCandidates.length > 0) {
        scoredProps = yestCandidates;
        console.log(`Fallback: got ${scoredProps.length} candidates from yesterday (${yesterday})`);
      }
    }

    // If still no candidates, call scoring engine as last resort
    if (scoredProps.length === 0) {
      console.log("No DB candidates — calling scoring engine as fallback...");
      try {
        const scoringRes = await fetch(`${SUPABASE_URL}/functions/v1/prop-scoring-engine`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          },
          body: JSON.stringify({ top_n: 50 }),
        });
        if (scoringRes.ok) {
          const scoringData = await scoringRes.json();
          scoredProps = scoringData.scored_props || [];
          console.log(`Scoring engine fallback: ${scoredProps.length} props`);
        } else {
          console.error("Scoring engine error:", scoringRes.status);
        }
      } catch (e) {
        console.error("Scoring engine fallback failed:", e);
      }
    }

    // If we STILL have no candidates, return a clear error
    if (scoredProps.length === 0) {
      return new Response(
        JSON.stringify({ error: "No scored candidates available for today's games. Data may not have been refreshed yet." }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ===== PHASE 2: Fetch live odds for market context + line snapshots =====
    const featuredUrl = `${ODDS_API_BASE}/sports/basketball_nba/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h,spreads,totals&oddsFormat=american&bookmakers=draftkings,fanduel`;
    const featuredRes = await fetch(featuredUrl);
    let gamesData: any[] = [];
    if (featuredRes.ok) {
      gamesData = await featuredRes.json();
    } else {
      console.error("Odds API error:", featuredRes.status);
    }

    // Fetch player props for market lines
    let playerPropsData: any[] = [];
    const lineSnapshotRows: any[] = [];

    for (const game of gamesData.slice(0, 3)) {
      try {
        const propsUrl = `${ODDS_API_BASE}/sports/basketball_nba/events/${game.id}/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=player_points,player_rebounds,player_assists,player_threes&oddsFormat=american&bookmakers=draftkings,fanduel`;
        const propsRes = await fetch(propsUrl);
        if (propsRes.ok) {
          const propsData = await propsRes.json();
          playerPropsData.push(propsData);

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
        console.error("Props fetch error:", e);
      }
    }

    // Save line snapshots (fire-and-forget)
    if (lineSnapshotRows.length > 0) {
      serviceClient
        .from("line_snapshots")
        .insert(lineSnapshotRows)
        .then(({ error }) => { if (error) console.error("Line snapshot insert error:", error); });
    }

    // Build odds summary for market context
    const oddsSummary = gamesData.slice(0, 8).map((game: any) => ({
      home: game.home_team,
      away: game.away_team,
      commence: game.commence_time,
      bookmakers: game.bookmakers?.slice(0, 2).map((bm: any) => ({
        name: bm.key,
        markets: bm.markets?.map((m: any) => ({
          key: m.key,
          outcomes: m.outcomes?.slice(0, 6).map((o: any) => ({
            name: o.name, description: o.description, price: o.price, point: o.point,
          })),
        })),
      })),
    }));

    // ===== PHASE 3: Build candidate summary for LLM =====
    // Build a lookup set for validation later
    const candidateSet = new Set<string>();
    const candidateSummary = scoredProps.slice(0, 40).map((p: any) => {
      const statLabel = STAT_LABELS[p.stat_type] || p.stat_type;
      // Key: normalized player name + stat type
      candidateSet.add(`${normName(p.player_name)}::${statLabel.toLowerCase()}`);
      candidateSet.add(`${normName(p.player_name)}::${(p.stat_type || "").toLowerCase()}`);

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
        rest_days: p.rest_days,
        tags: p.reason_tags,
        total_games: p.total_games,
      };
    });

    // Also build a map from normalized name to the canonical candidate for validation
    const candidateByName = new Map<string, any>();
    for (const p of scoredProps.slice(0, 40)) {
      const statLabel = STAT_LABELS[p.stat_type] || p.stat_type;
      candidateByName.set(`${normName(p.player_name)}::${statLabel.toLowerCase()}`, p);
    }

    // ===== PHASE 4: LLM generation =====
    const systemPrompt = `You are an NBA betting analyst for BetStreaks. You generate structured bet slips using ONLY the pre-scored candidate legs provided below.

CRITICAL RULES:
- You MUST select legs ONLY from the SCORED CANDIDATES list below
- Do NOT invent players, stats, or numbers that are not in the candidate data
- Every player_name you use MUST appear exactly as written in the candidates list
- Every stat_type you use MUST match the candidate's "stat" field
- Use the candidate's "line" value as the threshold (e.g., "Over 24.5")
- Never say "lock", "guaranteed", or "sure thing"
- Use terms like "balanced option", "higher-risk version", "best fit based on current data"
- Each slip has a risk_label: "safe", "balanced", or "aggressive"
- For "safe" slips: prefer candidates with confidence >= 60, low volatility
- For "balanced" slips: mix high-confidence and moderate-value candidates
- For "aggressive" slips: pick higher-value candidates even with more volatility
- Provide reasoning that references the actual data (hit rates, averages, trends)
- Include rich data_context for each leg pulled directly from the candidate data
- Generate realistic estimated combined American odds
- Do NOT over-weight tiny sample sizes (< 3 games)

SCORED CANDIDATES (${candidateSummary.length} candidates ranked by confidence — USE ONLY THESE):
${JSON.stringify(candidateSummary, null, 1)}

CURRENT MARKET ODDS:
${JSON.stringify(oddsSummary)}

Respond with ONLY valid JSON matching this exact structure:
{
  "slips": [
    {
      "slip_name": "string",
      "risk_label": "safe" | "balanced" | "aggressive",
      "estimated_odds": "+150",
      "reasoning": "Brief overall reasoning referencing data",
      "legs": [
        {
          "player_name": "string (MUST match candidate exactly)",
          "team_abbr": "string",
          "stat_type": "Points" | "Rebounds" | "Assists" | "3-Pointers" | "Steals" | "Blocks",
          "line": "Over 24.5",
          "pick": "Over" | "Under",
          "odds": "-110",
          "reasoning": "1-2 sentences referencing actual data from the candidate",
          "data_context": {
            "season_avg": number,
            "last5_avg": number,
            "last10_hit_rate": "80%",
            "line_hit_rate": "70% over 20 games",
            "vs_opponent": "75% in 4 games" | null,
            "vs_opponent_sample": number | null,
            "home_away_split": "85% at home in 10 games" | null,
            "home_away_sample": number | null,
            "confidence_score": number,
            "value_score": number,
            "volatility_label": "low" | "medium" | "high",
            "sample_size": number,
            "tags": ["tag1", "tag2"]
          }
        }
      ]
    }
  ]
}`;

    const userPrompt = `Generate ${Math.min(slipCount, 5)} NBA bet slip(s) for this request: "${prompt}"

Important: Use ONLY players and stats from the scored candidates list. Do not invent any data.`;

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
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiRes.status === 402) {
        return new Response(JSON.stringify({ error: "AI service temporarily unavailable." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await aiRes.text();
      console.error("AI gateway error:", aiRes.status, errText);
      throw new Error("AI generation failed");
    }

    const aiData = await aiRes.json();
    let content = aiData.choices?.[0]?.message?.content || "";
    content = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let parsed: { slips: any[] };
    try {
      parsed = JSON.parse(content);
    } catch {
      console.error("Failed to parse AI response:", content.substring(0, 500));
      throw new Error("AI returned invalid format");
    }

    // ===== PHASE 5: VALIDATE — reject hallucinated legs =====
    let totalLegs = 0;
    let validatedLegs = 0;
    let rejectedLegs = 0;

    for (const slip of parsed.slips) {
      const validLegs: any[] = [];
      for (const leg of slip.legs || []) {
        totalLegs++;
        const playerNorm = normName(leg.player_name || "");
        const statNorm = (leg.stat_type || "").toLowerCase();
        const key = `${playerNorm}::${statNorm}`;

        if (candidateSet.has(key)) {
          // Leg matches a real candidate — enrich with DB data
          const dbCandidate = candidateByName.get(key);
          if (dbCandidate && leg.data_context) {
            // Override LLM data_context with real DB values to prevent fabrication
            leg.data_context.season_avg = dbCandidate.season_avg ?? leg.data_context.season_avg;
            leg.data_context.confidence_score = dbCandidate.confidence_score ?? leg.data_context.confidence_score;
            leg.data_context.value_score = dbCandidate.value_score ?? leg.data_context.value_score;
            leg.data_context.sample_size = dbCandidate.total_games ?? leg.data_context.sample_size;

            if (dbCandidate.last5_avg != null) leg.data_context.last5_avg = dbCandidate.last5_avg;
            if (dbCandidate.last10_hit_rate != null) {
              leg.data_context.last10_hit_rate = `${Math.round(dbCandidate.last10_hit_rate * 100)}%`;
            }
            if (dbCandidate.season_hit_rate != null) {
              leg.data_context.line_hit_rate = `${Math.round(dbCandidate.season_hit_rate * 100)}% over ${dbCandidate.total_games || "?"} games`;
            }

            // Volatility from DB
            if (dbCandidate.volatility_score != null) {
              leg.data_context.volatility_label = dbCandidate.volatility_score <= 30 ? "low" : dbCandidate.volatility_score <= 60 ? "medium" : "high";
            }
          }
          validLegs.push(leg);
          validatedLegs++;
        } else {
          rejectedLegs++;
          console.warn(`REJECTED hallucinated leg: ${leg.player_name} / ${leg.stat_type} — not in candidate set`);
        }
      }
      slip.legs = validLegs;
    }

    // Remove slips with 0 valid legs
    parsed.slips = parsed.slips.filter((s: any) => s.legs && s.legs.length > 0);

    console.log(`Validation: ${validatedLegs}/${totalLegs} legs passed, ${rejectedLegs} rejected`);

    if (parsed.slips.length === 0) {
      return new Response(
        JSON.stringify({ error: "AI could not build valid slips from today's candidates. Try a different prompt." }),
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
        console.error("Error saving slip:", slipErr);
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

      if (legErr) console.error("Error saving legs:", legErr);

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
      scoring_metadata: {
        candidates_available: scoredProps.length,
        candidates_sent_to_llm: candidateSummary.length,
        legs_validated: validatedLegs,
        legs_rejected: rejectedLegs,
        games_today: gamesData.length,
      },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-bet-builder error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
