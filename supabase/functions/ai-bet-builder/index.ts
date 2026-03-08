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

    // Get auth token from request
    const authHeader = req.headers.get("Authorization");
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: authHeader ? { Authorization: authHeader } : {} },
    });

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
        // Check daily usage for free users (limit: 1/day)
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

    // Fetch current NBA odds from The Odds API
    const oddsUrl = `${ODDS_API_BASE}/sports/basketball_nba/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=player_points,player_rebounds,player_assists,h2h,spreads,totals&oddsFormat=american&bookmakers=draftkings,fanduel`;
    const oddsRes = await fetch(oddsUrl);
    
    let oddsData: any[] = [];
    if (oddsRes.ok) {
      oddsData = await oddsRes.json();
    } else {
      console.error("Odds API error:", oddsRes.status, await oddsRes.text());
      // Continue with AI even if odds API fails - AI will use general knowledge
    }

    // Summarize odds for AI context (keep it concise)
    const oddsSummary = oddsData.slice(0, 10).map((game: any) => ({
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

    const systemPrompt = `You are an NBA betting analyst for BetStreaks. Generate structured bet slips based on user prompts and current odds data.

RULES:
- Never say "lock", "guaranteed", or "sure thing"
- Use terms like "balanced option", "higher-risk version", "best fit based on current data"
- Each slip has a risk_label: "safe", "balanced", or "aggressive"
- Provide short reasoning for each leg (1-2 sentences)
- Generate realistic estimated combined American odds

CURRENT ODDS DATA:
${JSON.stringify(oddsSummary)}

Respond with ONLY valid JSON matching this exact structure:
{
  "slips": [
    {
      "slip_name": "string",
      "risk_label": "safe" | "balanced" | "aggressive",
      "estimated_odds": "+150",
      "reasoning": "Brief overall reasoning",
      "legs": [
        {
          "player_name": "string",
          "team_abbr": "string (3-letter NBA abbreviation)",
          "stat_type": "Points" | "Rebounds" | "Assists" | "3-Pointers" | "Spread" | "Total" | "Moneyline",
          "line": "Over 24.5" | "Under 10.5" | "-3.5" | etc,
          "pick": "Over" | "Under" | team name,
          "odds": "-110",
          "reasoning": "1-2 sentence explanation"
        }
      ]
    }
  ]
}`;

    const userPrompt = `Generate ${Math.min(slipCount, 5)} NBA bet slip(s) for this request: "${prompt}"`;

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

    // Clean markdown code fences if present
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

      savedSlips.push({ ...slipRow, legs: legRows || legs });
    }

    // Track usage for free users
    if (user && !isPremium) {
      const today = new Date().toISOString().split("T")[0];
      await supabase.rpc("increment_ai_usage" as any, { p_user_id: user.id, p_date: today }).catch(() => {
        // Fallback: upsert directly
        supabase
          .from("ai_usage")
          .upsert({ user_id: user.id, usage_date: today, request_count: 1 }, { onConflict: "user_id,usage_date" })
          .then(() => {});
      });
    }

    return new Response(JSON.stringify({ slips: savedSlips }), {
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
