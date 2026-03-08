import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ODDS_API_BASE = "https://api.the-odds-api.com/v4";
const AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

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

    // Check user auth & usage limits
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

    // ===== PHASE 1: Fetch live odds first (need matchups for scoring) =====
    const featuredUrl = `${ODDS_API_BASE}/sports/basketball_nba/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h,spreads,totals&oddsFormat=american&bookmakers=draftkings,fanduel`;
    const featuredRes = await fetch(featuredUrl);
    let gamesData: any[] = [];
    if (featuredRes.ok) {
      gamesData = await featuredRes.json();
    } else {
      console.error("Odds API error:", featuredRes.status);
    }

    // Extract matchups for scoring engine (map full names to abbreviations)
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

    const matchups = gamesData.map((g: any) => ({
      home_team: NBA_TEAM_ABBRS[g.home_team] || g.home_team,
      away_team: NBA_TEAM_ABBRS[g.away_team] || g.away_team,
    }));

    // ===== PHASE 2: Call Prop Scoring Engine with matchup context =====
    console.log(`Calling prop scoring engine with ${matchups.length} matchups...`);
    let scoredProps: any[] = [];
    try {
      const scoringRes = await fetch(`${SUPABASE_URL}/functions/v1/prop-scoring-engine`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
        body: JSON.stringify({ top_n: 50, matchups }),
      });

      if (scoringRes.ok) {
        const scoringData = await scoringRes.json();
        scoredProps = scoringData.scored_props || [];
        console.log(`Got ${scoredProps.length} scored props from ${scoringData.players_analyzed || 0} players`);
      } else {
        console.error("Scoring engine error:", scoringRes.status, await scoringRes.text());
      }
    } catch (e) {
      console.error("Scoring engine call failed:", e);
    }

    // Fetch player props from odds API for market lines + snapshot storage
    let playerPropsData: any[] = [];
    const lineSnapshotRows: any[] = [];
    const todayStr = new Date().toISOString().split("T")[0];

    for (const game of gamesData.slice(0, 3)) {
      try {
        const propsUrl = `${ODDS_API_BASE}/sports/basketball_nba/events/${game.id}/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=player_points,player_rebounds,player_assists,player_threes&oddsFormat=american&bookmakers=draftkings,fanduel`;
        const propsRes = await fetch(propsUrl);
        if (propsRes.ok) {
          const propsData = await propsRes.json();
          playerPropsData.push(propsData);

          // Extract line snapshots for market movement tracking
          for (const bm of propsData.bookmakers || []) {
            for (const market of bm.markets || []) {
              const statMap: Record<string, string> = {
                player_points: "Points", player_rebounds: "Rebounds",
                player_assists: "Assists", player_threes: "3-Pointers",
              };
              const statType = statMap[market.key];
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
      console.log(`Saved ${lineSnapshotRows.length} line snapshots`);
    }

    // Build odds summary
    const oddsSummary = gamesData.slice(0, 8).map((game: any) => ({
      home: game.home_team,
      away: game.away_team,
      commence: game.commence_time,
      bookmakers: game.bookmakers?.slice(0, 2).map((bm: any) => ({
        name: bm.key,
        markets: bm.markets?.map((m: any) => ({
          key: m.key,
          outcomes: m.outcomes?.slice(0, 6).map((o: any) => ({
            name: o.name,
            description: o.description,
            price: o.price,
            point: o.point,
          })),
        })),
      })),
    }));

    // ===== PHASE 3: Build data-driven AI context =====
    const STAT_LABELS: Record<string, string> = {
      pts: "Points", reb: "Rebounds", ast: "Assists",
      fg3m: "3-Pointers", stl: "Steals", blk: "Blocks",
    };

    // Format scored props as structured candidate data for the AI
    const candidateSummary = scoredProps.slice(0, 30).map((p: any) => ({
      player: p.player_name,
      team: p.team_abbr,
      opponent: p.opponent_abbr,
      home_away: p.home_away,
      stat: STAT_LABELS[p.stat_type] || p.stat_type,
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
      line_hit_rate_l10: p.line_hit_rate_l10 != null ? `${Math.round(p.line_hit_rate_l10 * 100)}%` : null,
      line_hit_rate_season: p.line_hit_rate_season != null ? `${Math.round(p.line_hit_rate_season * 100)}%` : null,
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
      back_to_back: p.back_to_back,
      games_last_7: p.games_last_7,
      rest_hit_rate: p.rest_hit_rate != null ? `${Math.round(p.rest_hit_rate * 100)}%` : null,
      rest_sample: p.rest_sample,
      opp_def_avg_allowed: p.opp_stat_avg_allowed,
      opp_def_games: p.opp_stat_games,
      // Teammate/lineup context
      minutes_trend: p.minutes_trend,
      minutes_trend_note: p.minutes_trend_note,
      role_label: p.role_label,
      key_teammates_out: p.key_teammates_out || [],
      teammate_notes: p.teammate_notes || [],
      // Availability context
      player_status: p.player_status,
      availability_notes: p.availability_notes || [],
      lineup_confidence: p.lineup_confidence,
      // Market movement context
      market_movement: p.market_movement || null,
      tags: p.reason_tags,
      total_games: p.total_games,
    }));

    const systemPrompt = `You are an NBA betting analyst for BetStreaks. You generate structured bet slips using ONLY the pre-scored candidate legs provided below.

CRITICAL RULES:
- You MUST select legs from the SCORED CANDIDATES list below. Do NOT invent players, stats, or numbers not in the data.
- Never say "lock", "guaranteed", or "sure thing"
- Use terms like "balanced option", "higher-risk version", "best fit based on current data"
- Each slip has a risk_label: "safe", "balanced", or "aggressive"
- For "safe" slips: prefer candidates with confidence >= 60, consistency >= 60, low volatility
- For "balanced" slips: mix high-confidence and moderate-value candidates
- For "aggressive" slips: pick higher-value candidates even with more volatility
- Provide reasoning that references the actual data (hit rates, averages, trends, matchup data)
- Include rich data_context for each leg with hit rates, sample sizes, rest notes, and defensive context
- Generate realistic estimated combined American odds
- Always note sample size when citing matchup-specific data
- Do NOT over-weight tiny sample sizes (< 3 games)
- Reference rest/fatigue when it's meaningful (back-to-back, 3+ days rest)
- Reference opponent defensive context when sample size >= 5 games
- Use line-specific hit rates (not just averages) in reasoning
- When teammate context is available (key_teammates_out, minutes_trend, role_label), reference it in reasoning
- Do NOT draw teammate conclusions from fewer than 3 games without noting sample size
- Include teammate_note in data_context when meaningful
- When player_status is "questionable" or "doubtful", note the uncertainty in reasoning
- Do NOT include players with status "out"
- Prefer players with lineup_confidence "high" for safe slips
- Note availability uncertainty in data_context when it affects the pick
- When market_movement data is available, reference it in reasoning (e.g., "value improved since open", "line moved against us")
- Do NOT let market movement override strong statistical evidence — it's one factor among many
- Include market_note in data_context when movement is meaningful

SCORED CANDIDATES (ranked by confidence):
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
          "player_name": "string (must match candidate exactly)",
          "team_abbr": "string (3-letter NBA abbreviation)",
          "stat_type": "Points" | "Rebounds" | "Assists" | "3-Pointers" | "Steals" | "Blocks",
          "line": "Over 24.5",
          "pick": "Over" | "Under",
          "odds": "-110",
          "reasoning": "1-2 sentences referencing actual hit rates, averages, and trends from the data",
           "data_context": {
            "season_avg": number,
            "last5_avg": number,
            "last10_hit_rate": "80%",
            "line_hit_rate": "70% over 20 games",
            "vs_opponent": "75% in 4 games" | null,
            "vs_opponent_sample": number | null,
            "home_away_split": "85% at home in 10 games" | null,
            "home_away_sample": number | null,
            "rest_note": "2 days rest" | "back-to-back" | null,
            "opp_defense_note": "OPP allows 26.3 avg (15g)" | null,
            "confidence_score": number,
            "value_score": number,
            "volatility_label": "low" | "medium" | "high",
            "sample_size": number,
            "teammate_note": "Key out: Player X — +20% without (5g)" | null,
            "minutes_trend": "up" | "down" | "stable" | null,
            "role_label": "starter" | "bench" | null,
            "availability_note": "Key teammate X questionable" | "Player PROBABLE" | null,
            "lineup_confidence": "high" | "medium" | "low" | null,
            "tags": ["Hit 24.5+ in 7/10 last games", "consistent", "Strong home split (80% in 12g)", "minutes_trending_up"]
          }
        }
      ]
    }
  ]
}`;

    const userPrompt = `Generate ${Math.min(slipCount, 5)} NBA bet slip(s) for this request: "${prompt}"

Important: Use ONLY the scored candidates provided. Reference their actual statistics in your reasoning.`;

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
      console.error("Failed to parse AI response:", content);
      throw new Error("AI returned invalid format");
    }

    // Save slips to database
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

      // Attach data_context to returned legs (not stored in DB, sent to client)
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
        candidates_analyzed: scoredProps.length,
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
